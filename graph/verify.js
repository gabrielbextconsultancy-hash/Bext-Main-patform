#!/usr/bin/env node
/**
 * Verifies the Azure App Registration end to end and records the result.
 *
 *   node graph/verify.js
 *
 * Checks, in dependency order, so the first failure tells you which step of
 * graph/app-registration.md went wrong:
 *   1. token           — client secret is valid
 *   2. user lookup     — User.Read.All consent landed
 *   3. sendMail        — the daily report can actually be delivered
 *   4. sites search    — Sites.ReadWrite.All for the Brief B document work
 *
 * Results are written to integration_health when a database is reachable.
 * Needs the SSH tunnel for that; without it the checks still run and print.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_UPN } = process.env;

const missing = Object.entries({ MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_UPN })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Not configured yet — missing ${missing.join(', ')} in .env`);
  console.error('See docs/SETUP-CHECKLIST.md step 3.');
  process.exit(1);
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
const results = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  ok    ${name}${detail ? ' — ' + detail : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`  FAIL  ${name} — ${e.message}`);
    throw e;
  }
}

async function graph(token, pathname, init = {}) {
  const r = await fetch(GRAPH + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (r.status === 204) return {};
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${body.error?.code || ''} ${body.error?.message || ''}`.trim());
  return body;
}

(async () => {
  console.log('Verifying Microsoft Graph app registration\n');
  let token;

  await step('token', async () => {
    const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description?.split('\n')[0] || j.error);
    token = j.access_token;
    return `expires in ${Math.round(j.expires_in / 60)} min`;
  });

  await step('user lookup (User.Read.All)', async () => {
    const u = await graph(token, `/users/${encodeURIComponent(MS_SENDER_UPN)}`);
    return u.displayName;
  });

  await step('sendMail (Mail.Send)', async () => {
    await graph(token, `/users/${encodeURIComponent(MS_SENDER_UPN)}/sendMail`, {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject: 'BEXT automation — Graph connectivity test',
          body: { contentType: 'Text', content: 'If you are reading this, n8n can send the 05:00 daily report.' },
          toRecipients: [{ emailAddress: { address: MS_SENDER_UPN } }],
        },
        saveToSentItems: true,
      }),
    });
    return `test message sent to ${MS_SENDER_UPN}`;
  });

  await step('sites search (Sites.ReadWrite.All)', async () => {
    const s = await graph(token, '/sites?search=');
    return `${s.value?.length ?? 0} site(s) visible`;
  });

  console.log('\nAll checks passed. Graph is wired.');
})()
  .catch(() => {
    console.log('\nStopped at the first failure. See the troubleshooting table in');
    console.log('graph/app-registration.md.');
    process.exitCode = 1;
  })
  .finally(async () => {
    // Best effort — the checks are the point, recording them is a bonus.
    try {
      const { Client } = require('pg');
      const db = new Client({
        host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
        database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
        connectionTimeoutMillis: 3000,
      });
      await db.connect();
      const allOk = results.every(r => r.ok);
      await db.query(
        `INSERT INTO integration_health (service, status, detail) VALUES ($1, $2, $3)`,
        ['microsoft_graph', allOk ? 'up' : 'down',
         results.map(r => `${r.ok ? 'ok' : 'FAIL'} ${r.name}: ${r.detail}`).join(' | ')]
      );
      await db.end();
      console.log('Recorded to integration_health.');
    } catch {
      console.log('(Database not reachable — result not recorded. Open the SSH tunnel to store it.)');
    }
  });
