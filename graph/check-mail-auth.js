#!/usr/bin/env node
/**
 * Proves what a receiving mail system makes of our SPF and DKIM.
 *
 *   node graph/check-mail-auth.js
 *
 * Publishing a correct SPF record is not the same as passing SPF, and a published
 * DKIM key is not the same as mail being signed. The only honest test is to send a
 * real message and read the receiver's verdict.
 *
 * So: send through the same SMTP the daily report uses, to the automation mailbox
 * on Microsoft 365, then read the Authentication-Results header Microsoft stamped
 * on it. Nobody else is copied — this is a diagnostic, not a report.
 *
 * Speaks SMTP directly because nodemailer is not a dependency of this repo and one
 * diagnostic does not justify adding one.
 */
const path = require('path');
const tls = require('tls');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, REPORT_SENDER,
  MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_UPN,
} = process.env;

const TO = process.env.MAIL_AUTH_PROBE_TO || MS_SENDER_UPN;
const SUBJECT = 'BEXT mail authentication probe';

const missing = Object.entries({ SMTP_HOST, SMTP_USER, SMTP_PASS, MS_TENANT_ID, MS_CLIENT_ID })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error(`Missing in .env: ${missing.join(', ')}`); process.exit(1); }

/** Minimal SMTP-over-TLS conversation. Enough for one message, not a mail library. */
const send = () => new Promise((resolve, reject) => {
  const sock = tls.connect({ host: SMTP_HOST, port: Number(SMTP_PORT || 465),
    servername: SMTP_HOST, rejectUnauthorized: false }, () => {});
  let step = 0;
  const from = REPORT_SENDER || SMTP_USER;
  const stamp = new Date().toISOString();
  const body = [
    `From: BEXT Automation <${from}>`,
    `To: <${TO}>`,
    `Subject: ${SUBJECT}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Authentication probe sent ${stamp}.`,
    'If you are reading this in a mailbox, check the Authentication-Results header.',
    '.',
  ].join('\r\n');

  const script = [
    `EHLO ${SMTP_HOST}`,
    'AUTH LOGIN',
    Buffer.from(SMTP_USER).toString('base64'),
    Buffer.from(SMTP_PASS).toString('base64'),
    `MAIL FROM:<${from}>`,
    `RCPT TO:<${TO}>`,
    'DATA',
    body,
    'QUIT',
  ];

  let buf = '';
  sock.setTimeout(30000, () => { sock.destroy(); reject(new Error('SMTP timeout')); });
  sock.on('data', d => {
    buf += d.toString();
    if (!/\r\n$/.test(buf)) return;
    const line = buf.trim().split('\r\n').pop();
    buf = '';
    if (/^[45]/.test(line)) { sock.end(); return reject(new Error('SMTP said: ' + line)); }
    if (step < script.length) sock.write(script[step++] + '\r\n');
    else { sock.end(); resolve('sent'); }
  });
  sock.on('error', reject);
  sock.on('end', () => resolve('sent'));
});

const graph = async (tok, p) => {
  const r = await fetch('https://graph.microsoft.com/v1.0' + p, { headers: { Authorization: `Bearer ${tok}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error?.code || ''} ${j.error?.message || ''}`);
  return j;
};

(async () => {
  console.log(`sending probe  ${REPORT_SENDER || SMTP_USER}  ->  ${TO}`);
  await send();
  console.log('  accepted by ' + SMTP_HOST);

  const tr = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const tok = (await tr.json()).access_token;

  // Delivery is not instant; poll rather than sleep-and-hope.
  let msg = null;
  for (let i = 0; i < 20 && !msg; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const q = await graph(tok, `/users/${encodeURIComponent(TO)}/messages`
      + `?$top=5&$select=subject,receivedDateTime,internetMessageHeaders`
      + `&$orderby=receivedDateTime desc`);
    msg = (q.value || []).find(m => m.subject === SUBJECT);
    process.stdout.write(msg ? '\n' : '.');
  }
  if (!msg) {
    console.log('\nNot delivered within two minutes. Check the mailbox and the SMTP logs.');
    process.exitCode = 1;
    return;
  }

  console.log(`  delivered ${msg.receivedDateTime}\n`);
  const hdr = n => (msg.internetMessageHeaders || [])
    .filter(h => h.name.toLowerCase() === n).map(h => h.value).join(' | ');

  const auth = hdr('authentication-results');
  console.log('Authentication-Results as stamped by the receiver:');
  console.log('  ' + (auth || '(none — the receiver did not stamp one)'));

  const verdict = k => new RegExp(k + '=(pass|fail|softfail|none|neutral|temperror|permerror)', 'i').exec(auth || '');
  for (const k of ['spf', 'dkim', 'dmarc']) {
    const m = verdict(k);
    const v = m ? m[1].toLowerCase() : 'not reported';
    console.log(`  ${k.toUpperCase().padEnd(6)} ${v === 'pass' ? 'PASS' : v.toUpperCase()}`);
  }
  const scl = hdr('x-microsoft-antispam') || hdr('x-forefront-antispam-report');
  if (scl) console.log('\nspam report: ' + scl.slice(0, 200));
})().catch(e => { console.error('FAILED:', e.message.slice(0, 300)); process.exitCode = 1; });
