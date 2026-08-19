#!/usr/bin/env node
/**
 * Can the app read each meeting host's online meetings?
 *
 *   node graph/verify-meeting-access.js
 *
 * The permission (OnlineMeetingTranscript.Read.All) is only half of it. Microsoft
 * additionally requires an application access policy naming whose meetings the app
 * may read. Granted per-user, it covers only that user; every other host answers
 *
 *   403  3003: User does not have access to lookup meeting
 *
 * which reads exactly like a missing permission and is not. This tells the two
 * apart, per host, so the next person does not spend an afternoon on it.
 *
 * Run graph/teams-access-policy.ps1 to grant it -Global. Allow up to 30 minutes.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_UPN } = process.env;
const HOSTS = (process.env.MEETING_HOSTS || MS_SENDER_UPN || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const G = 'https://graph.microsoft.com/v1.0';

const missing = Object.entries({ MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Not configured — missing ${missing.join(', ')} in .env`);
  process.exit(1);
}

(async () => {
  const tr = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }),
  });
  const tj = await tr.json();
  if (!tr.ok) throw new Error(tj.error_description?.split('\n')[0] || tj.error);
  const H = { Authorization: `Bearer ${tj.access_token}` };
  const get = async u => {
    const r = await fetch(G + u, { headers: H });
    return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
  };

  // A real join URL is needed: a malformed one is rejected at validation, before
  // authorisation, and answers 400 for everyone — which proves nothing.
  let probe = null;
  for (const upn of HOSTS) {
    const u = await get(`/users/${encodeURIComponent(upn)}?$select=id`);
    if (!u.ok) continue;
    const ev = await get(`/users/${u.j.id}/calendar/events`
      + '?$top=10&$orderby=start/dateTime desc&$select=isOnlineMeeting,onlineMeeting');
    probe = (ev.j.value || []).find(e => e.isOnlineMeeting && e.onlineMeeting?.joinUrl)
      ?.onlineMeeting?.joinUrl;
    if (probe) break;
  }
  if (!probe) {
    console.log('No online meeting found on any host to probe with.');
    console.log('Hold one Teams meeting, then re-run.');
    process.exitCode = 1;
    return;
  }

  console.log('Application access policy, per host\n');
  let blocked = 0;
  for (const upn of HOSTS) {
    const u = await get(`/users/${encodeURIComponent(upn)}?$select=id,displayName`);
    if (!u.ok) { console.log(`  ${upn.padEnd(46)} no such user`); continue; }
    const r = await get(`/users/${u.j.id}/onlineMeetings?$filter=`
      + encodeURIComponent(`JoinWebUrl eq '${probe}'`));
    if (r.ok) {
      console.log(`  ok    ${upn.padEnd(46)} covered by the policy`);
    } else if (r.status === 403) {
      blocked++;
      console.log(`  FAIL  ${upn.padEnd(46)} 403 — not covered by the policy`);
    } else {
      console.log(`  ?     ${upn.padEnd(46)} ${r.status} ${r.j.error?.code || ''}`);
    }
  }

  console.log('');
  if (blocked) {
    console.log(`${blocked} host(s) blocked. Their meetings cannot be transcribed.`);
    console.log('Fix:  pwsh -File graph/teams-access-policy.ps1   (grants -Global)');
    console.log('Then wait up to 30 minutes and re-run this.');
    process.exitCode = 1;
  } else {
    console.log('All hosts covered. Any of them can host a meeting the pipeline will pick up.');
  }
})().catch(e => { console.error('FAILED:', e.message.slice(0, 200)); process.exitCode = 1; });
