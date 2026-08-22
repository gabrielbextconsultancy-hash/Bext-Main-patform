#!/usr/bin/env node
/**
 * Sends the most recent stored report again, using the current envelope settings.
 *
 *   node graph/send-test-report.js --to me           only MS_SENDER_UPN
 *   node graph/send-test-report.js                   the real REPORT_RECIPIENT list
 *
 * The daily report is schedule-triggered, so there is no way to ask n8n to run it
 * on demand through the public API. This sends the same content the same way, so
 * a change to the From, Reply-To or the plain-text part can be seen in a real
 * inbox rather than waiting for 05:00 and hoping.
 *
 * It reads the rendered HTML out of the reports table rather than regenerating
 * it, so what arrives is exactly what the workflow produced.
 *
 * Speaks SMTP directly: nodemailer is not a dependency of this repo and one
 * diagnostic does not justify adding one.
 */
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, REPORT_SENDER, REPORT_RECIPIENT,
  MS_SENDER_UPN, REPORT_REPLY_TO,
  PG_HOST, PG_PORT, PG_DB, PG_USER, PG_PASSWORD,
} = process.env;

const ONLY_ME = process.argv.includes('--to') && process.argv[process.argv.indexOf('--to') + 1] === 'me';
const FROM_NAME = 'BEXT Consultancy';
const REPLY_TO = REPORT_REPLY_TO || MS_SENDER_UPN;

const missing = Object.entries({ SMTP_HOST, SMTP_USER, SMTP_PASS, REPORT_SENDER })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error('Missing in .env: ' + missing.join(', ')); process.exit(1); }

/** The plain-text alternative, matching what the workflow now builds. */
const toText = (html, subject) => {
  const body = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(h1|h2|div|p|tr)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2\n  $1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return subject + '\n\n' + body;
};

const send = ({ from, to, subject, html, text }) => new Promise((resolve, reject) => {
  const boundary = 'bext-' + crypto.randomBytes(12).toString('hex');
  const rcpts = to.split(',').map(s => s.trim()).filter(Boolean);

  // multipart/alternative: a message carrying only text/html is a bulk-mail
  // signal, and some clients show the text part instead.
  const message = [
    'From: ' + FROM_NAME + ' <' + from + '>',
    'To: ' + rcpts.map(r => '<' + r + '>').join(', '),
    'Reply-To: <' + REPLY_TO + '>',
    'Subject: ' + subject,
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@' + from.split('@')[1] + '>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    '--' + boundary,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    '--' + boundary + '--',
    '.',
  ].join('\r\n');

  const sock = tls.connect({ host: SMTP_HOST, port: Number(SMTP_PORT || 465),
    servername: SMTP_HOST, rejectUnauthorized: false }, () => {});
  const script = [
    'EHLO ' + SMTP_HOST,
    'AUTH LOGIN',
    Buffer.from(SMTP_USER).toString('base64'),
    Buffer.from(SMTP_PASS).toString('base64'),
    'MAIL FROM:<' + from + '>',
    ...rcpts.map(r => 'RCPT TO:<' + r + '>'),
    'DATA',
    message,
    'QUIT',
  ];
  let step = 0, buf = '';
  sock.setTimeout(45000, () => { sock.destroy(); reject(new Error('SMTP timeout')); });
  sock.on('data', d => {
    buf += d.toString();
    if (!/\r\n$/.test(buf)) return;
    const line = buf.trim().split('\r\n').pop();
    buf = '';
    if (/^[45]/.test(line)) { sock.end(); return reject(new Error('SMTP said: ' + line)); }
    if (step < script.length) sock.write(script[step++] + '\r\n');
    else { sock.end(); resolve(rcpts); }
  });
  sock.on('error', reject);
  sock.on('end', () => resolve(rcpts));
});

(async () => {
  const { Client } = require('pg');
  const db = new Client({ host: PG_HOST, port: Number(PG_PORT), database: PG_DB,
    user: PG_USER, password: PG_PASSWORD, connectionTimeoutMillis: 8000 });
  try { await db.connect(); }
  catch (e) {
    console.error('Postgres unreachable — open the tunnel first:');
    console.error('  ssh -i ~/.ssh/pf-nfac-hostinger -L 5433:127.0.0.1:5432 root@187.127.213.243 -N');
    process.exit(1);
  }
  const r = await db.query(
    'select report_date::text, html, item_count from reports where html is not null '
    + 'order by report_date desc limit 1');
  await db.end();
  if (!r.rowCount) { console.error('No stored report to send.'); process.exit(1); }

  const row = r.rows[0];
  const subject = 'BEXT Industry Daily — ' + new Date(row.report_date)
    .toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const to = ONLY_ME ? MS_SENDER_UPN : (REPORT_RECIPIENT || MS_SENDER_UPN);

  console.log('report   ' + row.report_date + ', ' + row.item_count + ' items');
  console.log('from     ' + FROM_NAME + ' <' + REPORT_SENDER + '>');
  console.log('reply-to ' + REPLY_TO);
  console.log('to       ' + to);
  console.log('parts    text + html');

  const sent = await send({
    from: REPORT_SENDER, to, subject,
    html: row.html, text: toText(row.html, subject),
  });
  console.log('\naccepted by ' + SMTP_HOST + ' for ' + sent.length + ' recipient(s).');
  console.log('Check the inbox — and if it is in spam, mark it Not spam once.');
})().catch(e => { console.error('FAILED: ' + String(e.message).slice(0, 300)); process.exitCode = 1; });
