#!/usr/bin/env node
/**
 * Send a report that was rendered but held, and close its record properly.
 *
 * The 1 Sep sheet was blocked before send by a validator reading a field the
 * query never supplied. The articles were never marked sent, so they stayed
 * queued — but a day's news is worth more today than tomorrow, and the sheet
 * itself was complete and correct.
 *
 *   node n8n/resend-held-report.js --date 2026-09-01 --dry
 *   node n8n/resend-held-report.js --date 2026-09-01
 *
 * Sends the STORED html — the artefact the workflow built — never a re-render,
 * and refuses outright if the report is already 'sent', so it cannot double-send.
 * On success it marks the row sent, which is what closes the exactly-once
 * ledger, then builds and stores that day's fetch audit exactly as the 05:00
 * run would have.
 */
'use strict';
require('dotenv').config();
const { Client } = require('pg');
const { buildSourceReport } = require('./lib/source-report.js');

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const DATE = arg('--date');
const DRY = process.argv.includes('--dry');
if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error('need --date YYYY-MM-DD'); process.exit(1);
}

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
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
};

(async () => {
  const c = new Client({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  await c.connect();

  const { rows } = await c.query(
    'SELECT id, status::text, item_count, html FROM reports WHERE report_date = $1::date', [DATE]);
  if (!rows.length) { console.log('no report for ' + DATE); await c.end(); return; }
  const rep = rows[0];
  if (rep.status === 'sent') { console.log('already sent — refusing'); await c.end(); return; }
  if (!rep.html) { console.log('no stored html — refusing'); await c.end(); return; }

  const to = (process.env.REPORT_RECIPIENT || '').split(',').map(s => s.trim()).filter(Boolean);
  console.log(`${DATE}: ${rep.item_count} items, ${Math.round(rep.html.length / 1024)} KB`);
  console.log('recipients: ' + to.join(', '));
  if (DRY) { console.log('--dry: nothing sent'); await c.end(); return; }

  const subject = 'BEXT Industry Daily — ' + DATE;
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MS_SENDER_UPN)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: rep.html },
          toRecipients: to.map(a => ({ emailAddress: { address: a } })),
        },
        saveToSentItems: true,
      }),
    });
  if (!r.ok) { console.error('sendMail ' + r.status + ' ' + (await r.text()).slice(0, 300)); process.exitCode = 1; await c.end(); return; }
  console.log('sent via Graph');

  // Only now: marking sent is what makes the ledger exactly-once, so it must
  // never happen before delivery is confirmed.
  await c.query("UPDATE reports SET status='sent', sent_at=now() WHERE id=$1", [rep.id]);
  await c.query(
    "INSERT INTO integration_health (service,status,detail) VALUES ('daily_report','up',$1)",
    [`Sent ${rep.item_count} items to ${to.join('; ')} (recovered after a false pre-send block)`]);
  console.log('marked sent, health recorded');

  // The fetch audit the 05:00 run would have produced, now that a send exists.
  const wf = require('./workflows/BEXT-Daily-News-5-Daily-Report.json');
  const loadSql = wf.nodes.find(n => n.name === 'Load verification data').parameters.query;
  const d = (await c.query(loadSql)).rows[0];
  const out = buildSourceReport(String(d.day), d.sources || [], d.articles || []);
  let pdf = null;
  try {
    const pr = await fetch('http://127.0.0.1:8080/pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: out.html }),
    });
    if (pr.ok) pdf = Buffer.from(await pr.arrayBuffer());
  } catch { /* html-only day */ }
  await c.query(
    `INSERT INTO source_reports (day, html, pdf, tally) VALUES ($1::date,$2,$3,$4::jsonb)
     ON CONFLICT (day) DO UPDATE SET html=EXCLUDED.html, pdf=EXCLUDED.pdf, tally=EXCLUDED.tally, created_at=now()`,
    [d.day, out.html, pdf, JSON.stringify(out.tally)]);
  console.log(`fetch audit stored for ${d.day}` + (pdf ? ` (${Math.round(pdf.length / 1024)} KB pdf)` : ' (html only)'));
  await c.end();
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
