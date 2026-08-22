#!/usr/bin/env node
/**
 * Show what is sitting in the automation mailbox.
 *
 * Exists mainly for confirmation codes. Services that verify an address — Gmail
 * forwarding, newsletter double opt-ins — send to a mailbox no person reads, so
 * this prints recent subjects and pulls out any code or confirmation link.
 *
 *   node graph/read-mailbox.js            the fifteen most recent
 *   node graph/read-mailbox.js reuters    only subjects or senders matching a word
 *
 * On reading IMAP properly: a response is finished when its TAGGED line arrives
 * ("a3 OK ..."), not when a chunk happens to end in CRLF. An earlier version used
 * the latter and silently truncated — it showed three of five messages and then
 * dropped the connection, which looked like the mailbox only had three.
 */
'use strict';
require('dotenv').config();
const tls = require('tls');

const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const HOST = (process.env.SMTP_HOST || '').replace(/^smtp\./, 'mail.');
const FILTER = (process.argv[2] || '').toLowerCase();
const LIMIT = 15;

if (!USER || !PASS || !HOST) { console.error('SMTP_USER / SMTP_PASS / SMTP_HOST missing from .env'); process.exit(1); }

/** Decode the RFC 2047 words Gmail and friends use in subjects. */
const decodeHeader = (s) => String(s).replace(
  /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
  (_, charset, enc, text) => {
    try {
      if (/^b$/i.test(enc)) return Buffer.from(text, 'base64').toString('utf8');
      return text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
    } catch (e) { return text; }
  }
).replace(/\s+/g, ' ').trim();

const run = () => new Promise((resolve, reject) => {
  const sock = tls.connect({ host: HOST, port: 993, servername: HOST, rejectUnauthorized: false });
  let buf = '';
  let tag = 0;
  let pending = null;

  // Send a command and resolve only once its tagged completion line appears.
  const cmd = (line) => new Promise((res, rej) => {
    const t = 'a' + (++tag);
    pending = { tag: t, res, rej };
    buf = '';
    sock.write(t + ' ' + line + '\r\n');
  });

  sock.on('data', (d) => {
    buf += d.toString('utf8');
    if (!pending) return;
    const done = new RegExp('^' + pending.tag + ' (OK|NO|BAD)[^\\r\\n]*\\r\\n', 'm');
    const m = buf.match(done);
    if (!m) return;                       // still streaming — wait for the tag
    const body = buf;
    const p = pending; pending = null; buf = '';
    if (/^OK$/i.test(m[1])) p.res(body); else p.rej(new Error(m[0].trim()));
  });

  sock.on('error', reject);
  sock.setTimeout(45000, () => { sock.destroy(); reject(new Error('timed out')); });

  sock.once('secureConnect', async () => {
    try {
      // Wait for the server greeting before issuing anything.
      await new Promise(r => setTimeout(r, 300));
      buf = '';
      await cmd('LOGIN "' + USER + '" "' + PASS.replace(/(["\\])/g, '\\$1') + '"');
      const sel = await cmd('SELECT INBOX');
      const total = Number((sel.match(/\* (\d+) EXISTS/) || [])[1] || 0);
      console.log(USER + ' — ' + total + ' message' + (total === 1 ? '' : 's') + ' in INBOX\n');
      if (!total) { sock.end(); return resolve(); }

      const first = Math.max(1, total - LIMIT + 1);
      let shown = 0;
      // One message per FETCH. Slower, but a single oversized response cannot
      // truncate the whole listing, which is exactly what went wrong before.
      for (let id = total; id >= first; id--) {
        let r;
        try {
          r = await cmd('FETCH ' + id + ' (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.2500>)');
        } catch (e) { continue; }

        const subject = decodeHeader((r.match(/^Subject:\s*(.+)$/mi) || [])[1] || '(no subject)');
        const from = decodeHeader((r.match(/^From:\s*(.+)$/mi) || [])[1] || '');
        const date = ((r.match(/^Date:\s*(.+)$/mi) || [])[1] || '').trim();
        if (FILTER && !(subject + ' ' + from).toLowerCase().includes(FILTER)) continue;

        console.log('  ' + subject.slice(0, 78));
        console.log('    from ' + from.slice(0, 68));
        console.log('    ' + date.slice(0, 40));

        const text = r.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
        // A confirmation code, if the sender uses one. Dates and years are not codes.
        const code = (text.match(/(?:confirmation|verification|security)\s+code[^\d]{0,60}(\d{4,12})/i) || [])[1];
        if (code) console.log('    CODE: ' + code);
        const link = (text.match(/https?:\/\/[^\s"'<>]*(?:confirm|verify|activate|subscription|optin|opt-in)[^\s"'<>]*/i) || [])[0];
        if (link) console.log('    LINK: ' + link.slice(0, 160));
        console.log('');
        shown++;
      }
      if (!shown) console.log('  nothing matching "' + FILTER + '" in the last ' + LIMIT + '.');
      try { await cmd('LOGOUT'); } catch (e) { /* server may close first */ }
      sock.end();
      resolve();
    } catch (e) { sock.end(); reject(e); }
  });
});

run().catch(e => { console.error('FAILED ' + (e.message || e)); process.exitCode = 1; });
