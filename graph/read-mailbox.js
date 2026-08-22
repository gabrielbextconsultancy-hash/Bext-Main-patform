#!/usr/bin/env node
/**
 * Show what is sitting in the automation mailbox.
 *
 * Exists mainly for confirmation codes. Services that verify an address — Gmail
 * forwarding, newsletter double opt-ins — send a code to a mailbox no person
 * reads, so this prints the recent subjects and, where one is present, the code
 * itself.
 *
 *   node graph/read-mailbox.js          the ten most recent
 *   node graph/read-mailbox.js gmail    only subjects matching a word
 */
'use strict';
require('dotenv').config();
const tls = require('tls');

const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const HOST = (process.env.SMTP_HOST || '').replace(/^smtp\./, 'mail.');
const FILTER = (process.argv[2] || '').toLowerCase();
const LIMIT = 10;

if (!USER || !PASS || !HOST) { console.error('SMTP_USER / SMTP_PASS / SMTP_HOST missing from .env'); process.exit(1); }

const sock = tls.connect({ host: HOST, port: 993, servername: HOST, rejectUnauthorized: false }, () => {
  let step = 0, buf = '', total = 0;
  const w = (l) => sock.write(l + '\r\n');

  sock.on('data', (d) => {
    buf += d.toString();
    // Wait for a complete tagged response before acting on it.
    if (!/\r\n$/.test(buf)) return;
    const chunk = buf; buf = '';

    if (step === 0) {
      step = 1;
      w('a1 LOGIN "' + USER + '" "' + PASS.replace(/(["\\])/g, '\\$1') + '"');
      return;
    }
    if (step === 1) {
      if (!/^a1 OK/mi.test(chunk)) { console.error('login failed'); sock.end(); process.exitCode = 1; return; }
      step = 2; w('a2 SELECT INBOX'); return;
    }
    if (step === 2) {
      total = Number((chunk.match(/\* (\d+) EXISTS/) || [])[1] || 0);
      console.log(USER + ' — ' + total + ' message' + (total === 1 ? '' : 's') + ' in INBOX\n');
      if (!total) { sock.end(); return; }
      step = 3;
      const from = Math.max(1, total - LIMIT + 1);
      // Headers plus a slice of the body: verification codes live in both.
      w('a3 FETCH ' + from + ':' + total + ' (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.1200>)');
      return;
    }
    if (step === 3) {
      const blocks = chunk.split(/^\* \d+ FETCH /m).slice(1);
      let shown = 0;
      for (const b of blocks) {
        const subject = ((b.match(/^Subject:\s*(.+)$/mi) || [])[1] || '(no subject)').trim();
        const from = ((b.match(/^From:\s*(.+)$/mi) || [])[1] || '').trim();
        const date = ((b.match(/^Date:\s*(.+)$/mi) || [])[1] || '').trim();
        if (FILTER && !(subject + ' ' + from).toLowerCase().includes(FILTER)) continue;

        console.log('  ' + subject.slice(0, 76));
        console.log('    from ' + from.slice(0, 66));
        console.log('    ' + date.slice(0, 40));

        // Gmail's forwarding confirmation is a 9-digit code; most others are 6-8.
        const codes = [...new Set(
          (b.match(/\b\d{6,9}\b/g) || []).filter(c => !/^20\d{6}$/.test(c))
        )];
        if (codes.length) console.log('    CODE: ' + codes.slice(0, 3).join('  '));
        const link = (b.match(/https?:\/\/[^\s"'<>]*(?:confirm|verify|activate)[^\s"'<>]*/i) || [])[0];
        if (link) console.log('    LINK: ' + link.replace(/=\r?\n/g, '').slice(0, 150));
        console.log('');
        shown++;
      }
      if (!shown) console.log('  nothing matching "' + FILTER + '" in the last ' + LIMIT + '.');
      step = 4; w('a4 LOGOUT'); return;
    }
    sock.end();
  });
});
sock.on('error', e => { console.error('connect failed: ' + e.message); process.exitCode = 1; });
sock.setTimeout(30000, () => { console.error('timed out'); sock.destroy(); process.exitCode = 1; });
