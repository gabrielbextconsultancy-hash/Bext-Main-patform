#!/usr/bin/env node
/**
 * GO/NO-GO gate for Power Automate work. Read-only, no new Graph permission.
 *
 *   node graph/discover-power-platform.js
 *   node graph/discover-power-platform.js --owner someone@bextconsultancy.com.au
 *
 * A flow created into a tenant with no licence or no environment fails late, in a
 * place that looks like a code problem. This checks the three things that decide
 * it up front, and names the account it examined — because the usual mistake is
 * checking the wrong one.
 *
 *   1. licence      — the flow OWNER holds a provisioned Power Automate plan
 *   2. environment  — the tenant has at least one Power Platform environment
 *   3. membership   — reported, not tested: app-only cannot see what the owner sees
 *
 * Exit code is 0 for GO and 1 for NO-GO, so this can gate another script.
 */
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;

// The flow owner is not the report sender. Defaulting to the automation account
// rather than MS_SENDER_UPN is deliberate: the lapsed licence in docs/HANDOFF.md
// belongs to the sender mailbox, and checking it here would report a blocker that
// has nothing to do with Power Automate.
const argIdx = process.argv.indexOf('--owner');
const OWNER = argIdx > -1
  ? process.argv[argIdx + 1]
  : (process.env.FLOW_OWNER_UPN || 'Admin.bext-automation@bextconsultancy.com.au');

const TEAM = 'bext_transcripts records';
const GRAPH = 'https://graph.microsoft.com/v1.0';
// The user-scoped collection, not /scopes/admin/. The admin variant needs a Power
// Platform Administrator role and, without it, returns an empty list rather than a
// 403 — which reads as "the tenant has no environments" and is wrong. Verified on
// 17 Aug 2026: admin scope returned [], user scope returned the default environment.
// What matters here is what the flow OWNER can build in, so ask as the owner.
const BAP = 'https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform'
  + '/environments?api-version=2020-10-01';

// Any of these, provisioned, means the owner can own a flow.
const FLOW_PLAN = /^(FLOW_O365|POWERAUTOMATE|FLOW_P|DYN365_)/i;

const missing = Object.entries({ MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Not configured yet — missing ${missing.join(', ')} in .env`);
  process.exit(1);
}

// az ships as az.cmd on Windows, and Node refuses to execFile a .cmd directly
// since the argument-injection hardening. Going through cmd.exe with each argument
// quoted is the one form that works on both platforms.
const az = args => {
  const win = process.platform === 'win32';
  const quote = s => (/[\s&?^|<>()"]/.test(s) ? `"${s}"` : s);
  return execFileSync(
    win ? 'cmd.exe' : 'az',
    win ? ['/d', '/s', '/c', ['az', ...args].map(quote).join(' ')] : args,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
};

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description?.split('\n')[0] || j.error);
  return j.access_token;
}

async function graph(tok, pathname) {
  const r = await fetch(GRAPH + pathname, { headers: { Authorization: `Bearer ${tok}` } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${body.error?.code || ''} ${body.error?.message || ''}`.trim());
  return body;
}

(async () => {
  console.log('Power Platform readiness\n');
  console.log(`  flow owner examined: ${OWNER}\n`);
  const blockers = [];

  // ── 1. licence ────────────────────────────────────────────────────────────
  console.log('[1] LICENCE');
  try {
    const tok = await token();
    const lic = await graph(tok, `/users/${encodeURIComponent(OWNER)}/licenseDetails`);
    const plans = [];
    for (const sku of lic.value || []) {
      for (const p of sku.servicePlans || []) {
        if (FLOW_PLAN.test(p.servicePlanName)) {
          plans.push({ name: p.servicePlanName, sku: sku.skuPartNumber, status: p.provisioningStatus });
        }
      }
    }
    const live = plans.filter(p => p.status === 'Success');
    plans.forEach(p => console.log(`  ${p.status === 'Success' ? 'ok  ' : 'NO  '}  ${p.name.padEnd(20)} ${p.sku} — ${p.status}`));
    if (!plans.length) console.log('  none found');
    if (live.length) console.log(`  → ${live.length} provisioned Power Automate plan(s)`);
    else blockers.push('licence — no provisioned Power Automate plan on the flow owner (docs/BRENT-TEAMS-ADMIN.md item 2)');
  } catch (e) {
    console.log(`  FAIL  ${e.message}`);
    blockers.push(`licence — could not read licenseDetails: ${e.message}`);
  }

  // ── 2. environment ────────────────────────────────────────────────────────
  // Power Platform is not on Graph, and app-only client credentials are not
  // accepted here — this leg rides on the user's own az login.
  console.log('\n[2] ENVIRONMENT');
  try {
    // Ask az only for a token and make the call from here. `az rest` would put the
    // URL through a Windows shell, where its & splits the command in two.
    const bapTok = az(['account', 'get-access-token',
      '--resource', 'https://api.bap.microsoft.com/', '--query', 'accessToken', '-o', 'tsv']).trim();
    const r = await fetch(BAP, { headers: { Authorization: `Bearer ${bapTok}` } });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
    const envs = ((await r.json()).value || []);
    envs.forEach(e => console.log(
      `  ok    ${e.properties?.displayName || e.name}${e.properties?.isDefault ? '  (default)' : ''}`));
    if (envs.length) console.log(`  → ${envs.length} environment(s)`);
    else blockers.push('environment — the tenant has none; this is a tenant-level fix, not a code change');
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/az login|not logged in|No subscription/i.test(msg)) {
      console.log('  FAIL  not signed in to az');
      console.log(`        run: az login --tenant ${MS_TENANT_ID} --allow-no-subscriptions`);
      console.log('        --allow-no-subscriptions is required, not cosmetic: on a');
      console.log('        subscription-less tenant a plain az login reports a misleading');
      console.log('        authentication failure.');
      blockers.push('az not signed in — the USER runs az login, never the agent');
    } else {
      console.log(`  FAIL  ${msg.split('\n')[0]}`);
      blockers.push(`environment — ${msg.split('\n')[0]}`);
    }
  }

  // ── 3. membership ─────────────────────────────────────────────────────────
  // Reported rather than tested. App-only cannot see what the flow owner can see,
  // and this script cannot reach the delegated MCP server.
  console.log('\n[3] MEMBERSHIP — check by hand');
  console.log(`  mcp__teams__list_teams must include "${TEAM}"`);
  console.log('  If it does not, the owner is not a member and the flow cannot post,');
  console.log('  whichever auth path is used. docs/BRENT-TEAMS-ADMIN.md item 3.');

  console.log('');
  if (blockers.length) {
    console.log('NO-GO');
    blockers.forEach(b => console.log(`  · ${b}`));
    console.log('\nA NO-GO here blocks Power Automate only. The app-only pipeline, the');
    console.log('n8n port and the delegated channel post are all still available.');
    process.exitCode = 1;
  } else {
    console.log('GO — licence provisioned and at least one environment present.');
    console.log('Confirm membership on the delegated path, then create the flow.');
  }
})().catch(e => { console.error('\nFAILED:', e.message); process.exitCode = 1; });
