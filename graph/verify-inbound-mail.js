#!/usr/bin/env node
/**
 * Prove that mail addressed to the automation mailbox actually arrives.
 *
 * Worth doing properly, because the cheap version of this check misled us once
 * already: an IMAP login succeeded and the INBOX had messages, which was read as
 * "the mailbox works". It only proved the mailbox could be READ. Nothing could
 * reach it — bext.dev-environment.site had an MX pointing at the Hostinger VPS,
 * which runs no mail server, so every inbound message was routed to a host that
 * could not accept it. Outbound was fine throughout, which is why it went unseen.
 *
 * So this sends a real message from outside the hosting account, through
 * Microsoft Graph, and then waits for it to appear over IMAP. Delivery is only
 * proven when a message we sent turns up in the mailbox we poll.
 *
 *   node graph/verify-inbound-mail.js
 *
 * With --to, sends somewhere else and still waits on our mailbox — which is how
 * you prove a FORWARDING rule rather than direct delivery. Confirming the rule in
 * Gmail's interface only proves Gmail accepted the address; it says nothing about
 * whether mail traverses the hop.
 *
 *   node graph/verify-inbound-mail.js --to gabriel.bextconsultancy@gmail.com
 */
'use strict';
require('dotenv').config();
const tls = require('tls');

const MAILBOX = process.env.SMTP_USER;            // the mailbox the pipeline polls
// Where the probe is addressed. Defaults to the mailbox itself; point it
// elsewhere to prove a forwarding hop instead of direct delivery.
const argTo = process.argv.indexOf('--to');
const TO = argTo > -1 ? process.argv[argTo + 1] : MAILBOX;
const HOST = (process.env.SMTP_HOST || '').replace(/^smtp\./, 'mail.');
const PASS = process.env.SMTP_PASS;
const TAG = 'bext-inbound-probe-' + Date.now();
const WAIT_MS = 240000;                            // mail is not instant; give it four minutes

const token = async () => {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token failed: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
};

const send = async () => {
  const t = await token();
  const from = process.env.MS_SENDER_UPN;
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: 'Inbound delivery probe ' + TAG,
        body: { contentType: 'Text', content: 'Delivery probe. Marker: ' + TAG },
        toRecipients: [{ emailAddress: { address: TO } }],
      },
      saveToSentItems: false,
    }),
  });
  if (r.status !== 202) throw new Error('sendMail ' + r.status + ' ' + (await r.text()).slice(0, 200));
  console.log('sent    : from ' + from + ' -> ' + TO);
  console.log('marker  : ' + TAG);
};

/** One IMAP session: search the INBOX for our marker. */
const look = () => new Promise((resolve) => {
  const sock = tls.connect({ host: HOST, port: 993, servername: HOST, rejectUnauthorized: false }, () => {
    let step = 0, buf = '';
    const w = (l) => sock.write(l + '\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      if (!/\r\n$/.test(buf)) return;
      const chunk = buf; buf = '';
      if (step === 0) { step = 1; w('a1 LOGIN "' + MAILBOX + '" "' + PASS.replace(/(["\\])/g, '\\$1') + '"'); return; }
      if (step === 1) {
        if (!/^a1 OK/mi.test(chunk)) { sock.end(); return resolve({ ok: false, why: 'login failed' }); }
        step = 2; w('a2 SELECT INBOX'); return;
      }
      if (step === 2) { step = 3; w('a3 SEARCH SUBJECT "' + TAG + '"'); return; }
      if (step === 3) {
        const hit = /\* SEARCH\s+(\d+)/.test(chunk);
        sock.end();
        return resolve({ ok: hit });
      }
      sock.end();
    });
  });
  sock.on('error', () => resolve({ ok: false, why: 'connect error' }));
  sock.setTimeout(15000, () => { sock.destroy(); resolve({ ok: false, why: 'timeout' }); });
});

(async () => {
  if (!MAILBOX || !PASS || !HOST) { console.error('SMTP_USER / SMTP_PASS / SMTP_HOST missing'); process.exit(1); }
  console.log('mailbox : ' + MAILBOX + '  (IMAP ' + HOST + ':993)');
  if (TO !== MAILBOX) console.log('probing : forwarding hop via ' + TO);
  console.log('');
  await send();

  const deadline = Date.now() + WAIT_MS;
  process.stdout.write('waiting ');
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 15000));
    process.stdout.write('.');
    const res = await look();
    if (res.ok) {
      console.log('\n\nDELIVERED — the probe arrived and is readable over IMAP.');
      console.log('Inbound mail to this address works. The newsletter tier has a mailbox it can actually receive into.');
      return;
    }
  }
  console.log('\n\nNOT DELIVERED within ' + (WAIT_MS / 1000) + 's.');
  console.log('DNS may still be propagating, or the mail server is not accepting for this subdomain.');
  console.log('Check the MX with: node graph/fix-mail-mx.js');
  process.exitCode = 1;
})().catch(e => { console.error('FAILED ' + e.message); process.exit(1); });
