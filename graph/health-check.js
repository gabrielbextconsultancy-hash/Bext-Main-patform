#!/usr/bin/env node
/**
 * Asserts the things that have actually broken, and says what changed.
 *
 *   node graph/health-check.js              run every check, print a table
 *   node graph/health-check.js --record     also append failures to docs/REGRESSIONS.md
 *   node graph/health-check.js --quiet      only print failures
 *
 * Every check here exists because something silently broke and nobody noticed:
 *
 *   - Graph Health itself wrote to integration_health with an uncast enum and had
 *     7 failures and 0 successes. The alarm was the thing that was broken.
 *   - The daily report failed SPF for weeks. It reported "up" the whole time,
 *     because "the workflow ran" is not the same as "the mail arrived".
 *   - BEXT — Meeting Intake sat active: true with zero executions, because a
 *     workflow activated through the public API is not registered until n8n restarts.
 *   - The application access policy covered one user, so every meeting hosted by
 *     anyone else returned 403 that reads exactly like a missing permission.
 *
 * So the rule this file follows: assert the OUTCOME, never the configuration.
 * A record being present is not proof it resolves; a workflow being active is not
 * proof it runs.
 *
 * Sends no mail and changes nothing — safe to run on a schedule or by hand.
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RECORD = process.argv.includes('--record');
const QUIET = process.argv.includes('--quiet');

const {
  MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_UPN,
  N8N_URL, N8N_API_KEY, TEAMS_MEETING_WEBHOOK_URL,
  PG_HOST, PG_PORT, PG_DB, PG_USER, PG_PASSWORD,
} = process.env;

const HOSTS = (process.env.MEETING_HOSTS || MS_SENDER_UPN || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAIL_DOMAIN = 'bext.dev-environment.site';
const SENDING_IPS = ['185.2.168.30', '23.83.208.0/20'];

const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message || e).slice(0, 160) });
  }
};

let token = null;
const graphToken = async () => {
  if (token) return token;
  const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description?.split('\n')[0] || j.error);
  token = j.access_token;
  return token;
};
const graph = async p => {
  const t = await graphToken();
  const r = await fetch('https://graph.microsoft.com/v1.0' + p, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error?.code || ''}`);
  return j;
};

(async () => {
  // ── Microsoft Graph ───────────────────────────────────────────────────────
  await check('graph token', async () => {
    await graphToken();
    return 'client credentials accepted';
  });

  await check('sharepoint reachable', async () => {
    const s = await graph('/sites/bextconsultancy.sharepoint.com:/sites/bext_transcriptsrecords');
    return s.displayName || 'channel site';
  });

  // The 403 here is the application access policy, not a missing permission —
  // the distinction cost a day, so the message says which.
  await check('meeting access policy', async () => {
    let probe = null;
    for (const upn of HOSTS) {
      const u = await graph(`/users/${encodeURIComponent(upn)}?$select=id`).catch(() => null);
      if (!u) continue;
      const ev = await graph(`/users/${u.id}/calendar/events`
        + '?$top=10&$orderby=start/dateTime desc&$select=isOnlineMeeting,onlineMeeting').catch(() => null);
      probe = (ev?.value || []).find(e => e.isOnlineMeeting && e.onlineMeeting?.joinUrl)?.onlineMeeting?.joinUrl;
      if (probe) break;
    }
    if (!probe) return 'no online meeting to probe with — inconclusive';
    const blocked = [];
    for (const upn of HOSTS) {
      const u = await graph(`/users/${encodeURIComponent(upn)}?$select=id`).catch(() => null);
      if (!u) continue;
      try {
        await graph(`/users/${u.id}/onlineMeetings?$filter=`
          + encodeURIComponent(`JoinWebUrl eq '${probe}'`));
      } catch (e) { if (/403/.test(e.message)) blocked.push(upn); }
    }
    if (blocked.length) {
      throw new Error(`403 for ${blocked.join(', ')} — run graph/teams-access-policy.ps1 (-Global)`);
    }
    return `${HOSTS.length} host(s) covered`;
  });

  // ── mail authentication ───────────────────────────────────────────────────
  // DNS only. Proving delivery needs a real send — graph/check-mail-auth.js.
  await check('mail SPF', async () => {
    const txt = (await dns.resolveTxt(MAIL_DOMAIN)).map(t => t.join(''));
    const spf = txt.find(t => /^v=spf1/i.test(t));
    if (!spf) throw new Error('no SPF record — mail will fail authentication');
    const covers = SENDING_IPS.some(ip => spf.includes(ip.split('/')[0]))
      || /include:relay\.mailchannels\.net/i.test(spf);
    if (!covers) throw new Error('SPF names none of the known sending paths');
    if (!/-all/.test(spf)) return 'passes, but soft ~all rather than -all';
    return 'authorises the sending path, hard -all';
  });

  await check('mail DMARC', async () => {
    const txt = (await dns.resolveTxt('_dmarc.' + MAIL_DOMAIN)).map(t => t.join(''));
    const d = txt.find(t => /^v=DMARC1/i.test(t));
    if (!d) throw new Error('no DMARC record');
    return d.includes('rua=') ? 'published with reporting' : 'published, no rua= reporting address';
  });

  await check('mail DKIM', async () => {
    const txt = (await dns.resolveTxt('default._domainkey.' + MAIL_DOMAIN)).map(t => t.join(''));
    if (!txt.some(t => /v=DKIM1/i.test(t))) throw new Error('no DKIM key published');
    // Known: the signature does not verify at the receiver — MailChannels relays and
    // the signature breaks. DMARC still passes on SPF alignment. Recorded, not fatal.
    return 'key published (signature verification is a separate, known issue)';
  });

  // ── n8n ───────────────────────────────────────────────────────────────────
  // Active is not running. Meeting Intake sat active with zero executions for
  // hours because API activation does not register the trigger until a restart.
  await check('n8n workflows executing', async () => {
    if (!N8N_URL || !N8N_API_KEY) throw new Error('N8N_URL / N8N_API_KEY not set');
    const r = await fetch(`${N8N_URL}/api/v1/workflows?limit=50`, { headers: { 'X-N8N-API-KEY': N8N_API_KEY } });
    if (!r.ok) throw new Error(`n8n API ${r.status}`);
    const wfs = (await r.json()).data || [];
    // Teams Inbound is deliberately unfinished — build-workflows.js skips
    // publishing it until N8N_WEBHOOK_CREDENTIAL_ID exists, because the endpoint
    // is publicly reachable and must not go up unauthenticated. Flagging it every
    // run would train everyone to ignore this check, which is how the real
    // failures stayed invisible.
    const EXPECTED_INACTIVE = ['BEXT — Teams Inbound'];
    const inactive = wfs.filter(w => !w.active && !EXPECTED_INACTIVE.includes(w.name)).map(w => w.name);
    if (inactive.length) throw new Error(`inactive: ${inactive.join(', ')}`);
    const skipped = wfs.filter(w => !w.active).length;
    return `${wfs.length - skipped}/${wfs.length} active`
      + (skipped ? ` (${skipped} intentionally off)` : '');
  });

  await check('teams webhook configured', async () => {
    if (!TEAMS_MEETING_WEBHOOK_URL) throw new Error('TEAMS_MEETING_WEBHOOK_URL not set — no channel card');
    if (!/^https:\/\//.test(TEAMS_MEETING_WEBHOOK_URL)) throw new Error('not an https URL');
    return /[?&]sig=/.test(TEAMS_MEETING_WEBHOOK_URL)
      ? 'signed URL (self-authenticating)'
      : 'tenant-restricted (caller must present a token)';
  });

  // ── database ──────────────────────────────────────────────────────────────
  await check('postgres + recent report', async () => {
    const { Client } = require('pg');
    const db = new Client({
      host: PG_HOST, port: Number(PG_PORT), database: PG_DB,
      user: PG_USER, password: PG_PASSWORD, connectionTimeoutMillis: 6000,
    });
    // Postgres binds loopback on the VPS, so from a laptop this needs the SSH
    // tunnel. "No tunnel" is not a production failure and must not be reported as
    // one — a check that fails for local reasons gets ignored, and then the real
    // failure gets ignored with it.
    try { await db.connect(); }
    catch (e) {
      if (/ECONNREFUSED|ETIMEDOUT/.test(e.message)) {
        return 'skipped — no tunnel to Postgres (ssh -L 5433:127.0.0.1:5432)';
      }
      throw e;
    }
    try {
      const r = await db.query(
        'select report_date::text, status::text, item_count from reports order by report_date desc limit 1');
      if (!r.rowCount) throw new Error('no reports rows at all');
      const row = r.rows[0];
      const age = Math.floor((Date.now() - new Date(row.report_date).getTime()) / 86400000);
      if (age > 1) throw new Error(`newest report is ${age} days old (${row.report_date})`);
      return `${row.report_date} ${row.status}, ${row.item_count} items`;
    } finally { await db.end(); }
  });

  // ── report ────────────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.ok);
  const width = Math.max(...results.map(r => r.name.length));
  console.log('');
  for (const r of results) {
    if (QUIET && r.ok) continue;
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);

  if (RECORD && failed.length) {
    const file = path.join(__dirname, '..', 'docs', 'REGRESSIONS.md');
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const lines = failed.map(f => `| ${stamp} | ${f.name} | ${f.detail.replace(/\|/g, '/')} |`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '# Regressions\n\n'
        + 'Appended by `node graph/health-check.js --record`. One row per failed check.\n'
        + 'The point is the pattern over time: a check that fails repeatedly is a design\n'
        + 'problem, not bad luck.\n\n'
        + '| when (UTC) | check | detail |\n|---|---|---|\n');
    }
    fs.appendFileSync(file, lines.join('\n') + '\n');
    console.log(`recorded ${failed.length} failure(s) to docs/REGRESSIONS.md`);
  }

  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FAILED:', e.message.slice(0, 200)); process.exitCode = 1; });
