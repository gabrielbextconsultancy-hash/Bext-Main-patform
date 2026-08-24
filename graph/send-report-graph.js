#!/usr/bin/env node
/**
 * Send a report through Microsoft Graph rather than the cPanel SMTP relay.
 *
 * Exists because of a delivery failure the SMTP path cannot explain. Messages to
 * gmail.com are accepted by the relay, never bounce, and never appear — not in
 * the inbox, not in spam. The signature of a silent discard.
 *
 * The likely cause is recorded in docs/INFRASTRUCTURE.md: mail from
 * reports@bext.dev-environment.site verifies as spf=pass, dmarc=pass, dkim=FAIL.
 * Gmail has required both SPF and DKIM from bulk senders since 2024 and is
 * entitled to drop a dkim=fail without telling anyone.
 *
 * Graph sends as the tenant's own mailbox, which Microsoft signs, so this both
 * tests that theory and gives a working route if it holds.
 *
 *   node graph/send-report-graph.js --to a@b.com --html report.html
 *   node graph/send-report-graph.js --to a@b.com            latest stored report
 */
'use strict';
require('dotenv').config();
const fs = require('fs');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const TO = arg('--to');
const HTML_FILE = arg('--html');

const token = async () => {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID, client_secret: process.env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }).toString(),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
};

(async () => {
  if (!TO) { console.error('usage: send-report-graph.js --to <address> [--html <file>]'); process.exit(1); }

  let html, day;
  if (HTML_FILE) {
    html = fs.readFileSync(HTML_FILE, 'utf8');
    day = new Date().toISOString().slice(0, 10);
  } else {
    const { Pool } = require('pg');
    const db = new Pool({
      host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
      database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    });
    const r = await db.query(
      'SELECT report_date::text, html FROM reports WHERE html IS NOT NULL ORDER BY report_date DESC LIMIT 1');
    await db.end();
    if (!r.rowCount) { console.error('no stored report'); process.exit(1); }
    html = r.rows[0].html; day = r.rows[0].report_date;
  }

  const subject = 'BEXT Industry Daily — ' + new Date(day)
    .toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const from = process.env.MS_SENDER_UPN;
  const rcpts = TO.split(',').map(s => s.trim()).filter(Boolean);

  const t = await token();
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: rcpts.map(a => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: true,
    }),
  });

  if (r.status !== 202) {
    console.error('sendMail ' + r.status + ' ' + (await r.text()).slice(0, 300));
    process.exit(1);
  }
  console.log('sent via Graph');
  console.log('  from    ' + from + '   (Microsoft-signed, dkim passes)');
  console.log('  to      ' + rcpts.join(', '));
  console.log('  subject ' + subject);
  console.log('  size    ' + Math.round(html.length / 1024) + ' KB');
  console.log('\nIf this arrives and the SMTP copy did not, the DKIM failure on');
  console.log('reports@bext.dev-environment.site is what is losing the mail.');
})().catch(e => { console.error('FAILED ' + e.message); process.exit(1); });
