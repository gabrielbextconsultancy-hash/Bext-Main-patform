#!/usr/bin/env node
/**
 * Backfill meeting_minutes.transcript_id for rows written before migration 013.
 *
 * Emits UPDATE statements on stdout; pipe them into psql. It does not connect to
 * Postgres itself, because Postgres is loopback-only on the VPS and this has to
 * run from either side.
 *
 * Mapping rule: a row's meeting_id may match SEVERAL transcripts once a series
 * recurs. The existing row was written by the FIRST occurrence the pipeline saw,
 * so it takes the OLDEST transcript for that meetingId. Getting this right is
 * what stops the 18 Aug weekly being re-minuted and re-emailed to the client
 * after the dedupe key moves.
 *
 *   node graph/backfill-transcript-ids.js > /tmp/backfill.sql
 */
const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');

const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

(async () => {
  const tok = await (await fetch(
    `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
      }),
    })).json();
  if (!tok.access_token) throw new Error('token: ' + (tok.error_description || tok.error));
  const H = { Authorization: `Bearer ${tok.access_token}` };

  // meetingId -> [transcripts], oldest first
  const byMeeting = new Map();
  for (const upn of (env.MEETING_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const u = await (await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id`, { headers: H })).json();
    if (!u.id) continue;
    const r = await (await fetch(
      `https://graph.microsoft.com/v1.0/users/${u.id}/onlineMeetings/getAllTranscripts(`
      + `meetingOrganizerUserId='${u.id}')`, { headers: H })).json();
    for (const t of (r.value || [])) {
      if (!byMeeting.has(t.meetingId)) byMeeting.set(t.meetingId, []);
      byMeeting.get(t.meetingId).push(t);
    }
  }

  console.log('BEGIN;');
  let n = 0;
  for (const [meetingId, list] of byMeeting) {
    list.sort((a, b) => a.createdDateTime.localeCompare(b.createdDateTime));
    const oldest = list[0];
    console.log(
      `UPDATE meeting_minutes SET transcript_id = ${q(oldest.id)}\n`
      + ` WHERE meeting_id = ${q(meetingId)} AND transcript_id IS NULL;`);
    n++;
    if (list.length > 1) {
      console.log(`-- ${meetingId.slice(-18)} has ${list.length} occurrences; `
        + `the ${list.length - 1} newer one(s) are left for the pipeline to process.`);
    }
  }
  // Anything the pipeline wrote that Graph no longer lists (a deleted meeting)
  // still needs a non-null key, or it is rediscovered as unprocessed forever.
  console.log(
    `UPDATE meeting_minutes SET transcript_id = 'legacy:' || meeting_id\n`
    + ` WHERE transcript_id IS NULL AND meeting_id IS NOT NULL;`);
  console.log('COMMIT;');
  console.error(`mapped ${n} meeting id(s)`);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
