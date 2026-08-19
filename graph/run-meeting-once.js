#!/usr/bin/env node
/**
 * Runs the meeting pipeline once, by hand, printing each stage.
 *
 *   node graph/run-meeting-once.js                 most recent transcript
 *   node graph/run-meeting-once.js --dry           extract only, file nothing
 *   node graph/run-meeting-once.js --file x.vtt    a transcript from disk
 *   node graph/run-meeting-once.js --no-post       file everything, skip the Teams card
 *   node graph/run-meeting-once.js --print-card    write the card payload to scratch/card.json
 *
 * The n8n workflow does this on a schedule with no one watching. This is the
 * same sequence run deliberately so each stage can be inspected before the next,
 * which is how the extraction gets tuned: a poor result at stage 2 means there is
 * no point looking at stages 3 to 5, and the fix is the prompt rather than the
 * plumbing.
 *
 * Kept in the repo rather than thrown away — a transcript can be replayed
 * through it as often as needed while the prompt changes, without holding
 * another meeting.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { buildMeetingCard } = require('../n8n/lib/meeting-card');
// One implementation of both, shared with the Meeting Intake Code node, which
// cannot require anything and gets them inlined at build time instead.
const { simpleDocx, vttToBlocks, dedupeVtt } = require('../n8n/lib/docx');

const {
  MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_UPN, GEMINI_API_KEY,
  TEAMS_MEETING_WEBHOOK_URL,
} = process.env;
const DRY = process.argv.includes('--dry');
const NO_POST = process.argv.includes('--no-post');
const PRINT_CARD = process.argv.includes('--print-card');
const G = 'https://graph.microsoft.com/v1.0';
const SITE = 'bextconsultancy.sharepoint.com:/sites/BEXTHQ';
const BASE = 'API Automation Folder';
const MODEL = 'gemini-3.6-flash';

// The Teams channel is the record: one folder per meeting holding the transcript,
// the minutes and the summary, so the whole history reads chronologically in the
// channel's Files tab without anyone opening SharePoint.
const CHANNEL_SITE = 'bextconsultancy.sharepoint.com:/sites/bext_transcriptsrecords';
const CHANNEL_BASE = 'Bext Transcripts';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// The tenant drops connections often enough that a single attempt regularly
// fails on an otherwise healthy call.
async function retry(fn, n = 4) {
  let last;
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}

const PROMPT = `You are writing the minutes of a recurring weekly program check-in for an
Australian energy and sustainability consultancy, from the Teams transcript below.

Return a JSON object with exactly these keys:

  attendees   array of { name, initials, company }. One entry per distinct speaker. Derive
              initials from the name. Leave company "" unless stated.
  safety      array of { item, detail, owner, due, status }
              status here MUST be exactly Open or Closed — not the project vocabulary below
  projects    array of { project, phase, status, update, next_action, owner, due, network_note }
              status MUST be exactly one of: On Track, Monitor, At Risk, On Hold, Complete
              network_note is the DNSP or network position if one was mentioned, else ""
  finance     array of { item, detail, owner, due, status } — commercial and other business
              status here MUST also be exactly Open or Closed
  actions     array of { title, detail, owner, due, status, closed }
              owner is a person named in the transcript, or "Unassigned" — never guess
              closed is true only if the transcript says it is done
  decisions   array of strings — decisions actually made, not options discussed
  title       a short specific title for this meeting, 4 to 8 words, describing what was
              actually discussed. The calendar subject is often a placeholder like
              "reset test" — do not echo it. Example: "Torquay DNSP delay and switchboard order"
  summary     3-5 sentences of prose for the follow-up email
  next_meeting string, or ""

Rules that matter more than completeness:
  - Do not invent. An empty array is a correct answer for a section not discussed.
  - Never assign an owner who was not named. "Unassigned" is the honest answer.
  - Ignore small talk, greetings and side conversation entirely.
  - Australian English. Keep the speakers' own terms for projects and schemes.

Return ONLY the JSON object, no markdown fence.

TRANSCRIPT:
`;

// The channel webhook is a second audience, not a second credential: the Teams
// webhook trigger is tenant-restricted, so the POST carries an app-only token for
// the Flow service rather than relying on a signed URL that anyone could replay.
async function token(scope = 'https://graph.microsoft.com/.default') {
  const r = await retry(() => fetch(
    `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
        scope, grant_type: 'client_credentials',
      }),
    }));
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description?.split('\n')[0] || j.error);
  return j.access_token;
}

(async () => {
  const t = await token();
  const H = { Authorization: `Bearer ${t}` };
  const graph = async (p, init = {}) => {
    const r = await retry(() => fetch(G + p, { ...init, headers: { ...H, ...(init.headers || {}) } }));
    const body = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${body.error?.code || ''} ${body.error?.message || ''}`);
    return body;
  };

  // ── 1. transcript ─────────────────────────────────────────────────────────
  console.log('\n[1] TRANSCRIPT');
  const me = await graph(`/users/${encodeURIComponent(MS_SENDER_UPN)}?$select=id,displayName`);
  // Whoever hosts the meeting owns its transcript, and that is not always the
  // automation account — Brent runs the client check-ins from his own calendar.
  // Each host is polled in turn, newest first, so it does not matter who booked it.
  const HOSTS = (process.env.MEETING_HOSTS || MS_SENDER_UPN)
    .split(',').map(s => s.trim()).filter(Boolean);

  let found = null;

  // A transcript from disk, for replaying against a changed prompt or for
  // exercising the fill with content the test meetings did not contain.
  const fileArg = process.argv.indexOf('--file');
  if (fileArg > -1 && process.argv[fileArg + 1]) {
    const now = new Date().toISOString().slice(0, -1);
    found = {
      ev: { subject: 'Weekly Program Check-in', start: { dateTime: now }, end: { dateTime: now } },
      host: me, meeting: { id: 'local' }, tr: { createdDateTime: 'from file' },
      vtt: fs.readFileSync(process.argv[fileArg + 1], 'utf8'),
    };
  }

  for (const upn of found ? [] : HOSTS) {
    let host;
    try { host = await graph(`/users/${encodeURIComponent(upn)}?$select=id,displayName`); }
    catch (e) { console.log(`  ${upn}: no such user — ${e.message.slice(0, 60)}`); continue; }

    let events;
    try {
      events = await graph(`/users/${host.id}/calendar/events`
        + '?$top=10&$orderby=start/dateTime desc'
        + '&$select=subject,start,end,organizer,attendees,isOnlineMeeting,onlineMeeting');
    } catch (e) { console.log(`  ${upn}: calendar unreadable — ${e.message.slice(0, 60)}`); continue; }

    const online = (events.value || []).filter(e => e.isOnlineMeeting && e.onlineMeeting?.joinUrl);
    console.log(`  ${upn}: ${online.length} online meeting(s)`);

    for (const ev of online) {
      let meeting;
      try {
        const r = await graph(`/users/${host.id}/onlineMeetings?$filter=`
          + encodeURIComponent(`JoinWebUrl eq '${ev.onlineMeeting.joinUrl}'`));
        meeting = r.value?.[0];
      } catch (e) {
        // 403 here is the application access policy, not a missing permission.
        // Grant-CsApplicationAccessPolicy must cover this host — see
        // graph/teams-access-policy.ps1, which grants it -Global.
        if (/403/.test(e.message)) {
          console.log(`  ${upn}: 403 on onlineMeetings — access policy does not cover this host`);
          break;
        }
        continue;
      }
      if (!meeting) continue;

      let list;
      try { list = await graph(`/users/${host.id}/onlineMeetings/${meeting.id}/transcripts`); }
      catch { continue; }
      if (!(list.value || []).length) continue;

      // Newest transcript on the newest meeting that has one.
      const tr = list.value[list.value.length - 1];
      const r = await retry(() => fetch(
        `${G}/users/${host.id}/onlineMeetings/${meeting.id}/transcripts/${tr.id}/content?$format=text/vtt`,
        { headers: H }));
      found = { ev, host, meeting, tr, vtt: await r.text() };
      break;
    }
    if (found) break;
  }
  if (!found) { console.log('  no transcript found on any recent meeting'); return; }


  // Two Teams clients in one call each produce their own stream, so the same
  // utterance arrives twice with slightly different wording. Left in, the model
  // sees every action twice. Matched on similarity within a time window rather
  // than on an exact key, because the two streams never word it identically.
  const ded = dedupeVtt(found.vtt);
  if (ded.dropped) console.log(`  deduped  ${ded.dropped} duplicate line(s) removed`);
  found.vtt = ded.vtt;
  const speakers = [...new Set((found.vtt.match(/<v ([^>]+)>/g) || []).map(s => s.slice(3, -1)))];
  console.log(`  meeting   ${found.ev.subject}`);
  console.log(`  created   ${found.tr.createdDateTime}`);
  console.log(`  bytes     ${found.vtt.length}`);
  console.log(`  speakers  ${speakers.join(', ') || 'NONE'}`);

  // ── 2. extraction ─────────────────────────────────────────────────────────
  console.log('\n[2] EXTRACTION');
  const res = await retry(() => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT + found.vtt.slice(0, 200000) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    })).then(r => r.json());
  const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  let x;
  try { x = JSON.parse(raw); }
  catch { console.log('  unparseable:', raw.slice(0, 300)); return; }

  const counts = ['attendees', 'safety', 'projects', 'finance', 'actions', 'decisions']
    .map(k => `${k}=${(x[k] || []).length}`).join('  ');
  console.log('  ' + counts);
  console.log('  summary: ' + String(x.summary || '(none)').slice(0, 240));
  const scratch = process.env.SCRATCH || __dirname;
  fs.writeFileSync(path.join(scratch, 'extracted.json'), JSON.stringify(x, null, 2));

  if (DRY) { console.log('\n--dry: stopping before filing.'); return; }

  // ── 3. document ───────────────────────────────────────────────────────────
  console.log('\n[3] MINUTES DOCUMENT');
  const site = await graph(`/sites/${SITE}`);
  const drives = await graph(`/sites/${site.id}/drives`);
  const drive = (drives.value.find(d => d.name === 'Documents') || drives.value[0]).id;

  const tplRes = await retry(() => fetch(
    `${G}/drives/${drive}/root:/${encodeURI(`${BASE}/Templates/Minutes Template.docx`)}:/content`,
    { headers: H }));
  const tpl = Buffer.from(await tplRes.arrayBuffer());

  const when = new Date(found.ev.end?.dateTime + 'Z');
  const fmt = d => d.toLocaleDateString('en-AU',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Melbourne' });

  const data = {
    program: 'RACV Property Electrification — Weekly Program Check-in',
    date: fmt(when),
    time: `${new Date(found.ev.start.dateTime + 'Z').toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })} – ${when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })}`,
    venue: 'Microsoft Teams',
    meeting_no: '1',
    minutes_by: 'BEXT Automation',
    attendees: (x.attendees || []).map(a => ({
      name: a.name || '', initials: a.initials || '', company: a.company || '', email: '',
    })),
    safety: x.safety || [],
    // The template writes the network position inside the update cell, the way
    // the client's own minutes read.
    projects: (x.projects || []).map(p => ({
      ...p,
      update: p.network_note ? `${p.update}\nNetwork / DNSP: ${p.network_note}` : p.update,
    })),
    finance: x.finance || [],
    actions: (x.actions || []).map(a => ({
      item: a.title || '', detail: a.detail || '', owner: a.owner || 'Unassigned',
      due: a.due || '',
      // Stored Open/Closed, rendered Done — the two documents word it
      // differently and both should keep reading as they do.
      status: a.closed ? 'Done' : 'Open',
    })),
  };

  const rendered = await retry(() => fetch('http://127.0.0.1:8080/render-docx', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template: tpl.toString('base64'), data }),
  }));
  if (!rendered.ok) { console.log('  render failed', rendered.status, (await rendered.text()).slice(0, 300)); return; }
  const docx = Buffer.from(await rendered.arrayBuffer());
  console.log(`  rendered  ${docx.length} bytes`);

  // ── 4. filing ─────────────────────────────────────────────────────────────
  console.log('\n[4] FILING');
  const stamp = when.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
  const safe = (found.ev.subject || 'Meeting').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // Failures are collected rather than thrown: a bad archive write should not cost
  // the draft email. The channel card is the one thing gated on a clean run.
  const failures = [];
  const put = async (driveId, p, body, type) => {
    const r = await retry(() => fetch(`${G}/drives/${driveId}/root:/${encodeURI(p)}:/content`, {
      method: 'PUT', headers: { ...H, 'Content-Type': type }, body,
    }));
    const j = await r.json();
    if (!r.ok) failures.push(p);
    console.log(`  ${r.ok ? 'filed' : 'FAILED'}  ${p}${r.ok ? '' : ' — ' + JSON.stringify(j).slice(0, 120)}`);
    return j;
  };

  // ── channel record ────────────────────────────────────────────────────────
  const chSite = await graph(`/sites/${CHANNEL_SITE}`);
  const chDrives = await graph(`/sites/${chSite.id}/drives`);
  const chDrive = (chDrives.value.find(d => d.name === 'Documents') || chDrives.value[0]).id;
  const folder = `${CHANNEL_BASE}/${stamp} ${safe}`;

  const summary = simpleDocx(`${data.program} — Meeting Summary`, [
    { text: `${data.date}  ·  ${data.venue}` },
    { heading: 'Summary' },
    { text: String(x.summary || '') },
    ...((x.decisions || []).length ? [{ heading: 'Decisions' }] : []),
    ...(x.decisions || []).map(d => ({ text: '•  ' + d, tight: true })),
    ...((x.actions || []).length ? [{ heading: 'Actions' }] : []),
    ...(x.actions || []).map(a => ({
      text: `•  ${a.title} — ${a.owner || 'Unassigned'}${a.due ? ', due ' + a.due : ''}`
            + (a.closed ? '  [closed]' : ''),
      tight: true,
    })),
    { heading: 'Attendees' },
    { text: (x.attendees || []).map(a => a.name).join(', ') },
  ]);

  // Minutes.docx is written last, in both places, so that the channel card — which
  // fires once everything below has landed — never announces a half-filed record.
  // The working library keeps a flat archive; the channel keeps the readable record.
  await put(drive, `${BASE}/Meeting Transcripts/${stamp} ${safe}.vtt`, found.vtt, 'text/vtt');
  const chTr = await put(chDrive, `${folder}/Transcript.vtt`, found.vtt, 'text/vtt');
  const chSum = await put(chDrive, `${folder}/Summary.docx`, summary, DOCX);
  const filed = await put(drive, `${BASE}/Meeting Minutes/${stamp} ${safe} — Minutes.docx`, docx, DOCX);
  const chMin = await put(chDrive, `${folder}/Minutes.docx`, docx, DOCX);

  // ── readable renditions ───────────────────────────────────────────────────
  // SharePoint has no preview handler for .vtt, so that button downloads a file
  // most people cannot read. Word's export service turns a rendered document into
  // a PDF that opens inline on desktop and mobile. The originals stay put — BEXT
  // still edits Minutes.docx at step 9.
  const transcriptDocx = simpleDocx(`${data.program} — Transcript`, [
    { text: `${data.date}  ·  ${data.venue}` },
    ...vttToBlocks(found.vtt),
  ]);
  await put(chDrive, `${folder}/Transcript.docx`, transcriptDocx, DOCX);

  const toPdf = async (src, dst) => {
    try {
      const r = await retry(() => fetch(
        `${G}/drives/${chDrive}/root:/${encodeURI(src)}:/content?format=pdf`,
        { headers: H, redirect: 'follow' }));
      if (!r.ok) { console.log(`  no pdf  ${dst} — ${r.status}`); return {}; }
      const buf = Buffer.from(await r.arrayBuffer());
      // The conversion service answers 200 with a JSON error body on some inputs,
      // so trust the magic bytes rather than the status code.
      if (buf.slice(0, 5).toString('latin1') !== '%PDF-') {
        console.log(`  no pdf  ${dst} — not a PDF`); return {};
      }
      return await put(chDrive, dst, buf, 'application/pdf');
    } catch (e) { console.log(`  no pdf  ${dst} — ${e.message}`); return {}; }
  };

  const pdfMin = await toPdf(`${folder}/Minutes.docx`, `${folder}/Minutes.pdf`);
  const pdfSum = await toPdf(`${folder}/Summary.docx`, `${folder}/Summary.pdf`);
  const pdfTr = await toPdf(`${folder}/Transcript.docx`, `${folder}/Transcript.pdf`);

  const chFolder = await graph(`/drives/${chDrive}/root:/${encodeURI(folder)}`);
  console.log(`  channel  ${chFolder.webUrl}`);

  // ── 5. draft ──────────────────────────────────────────────────────────────
  console.log('\n[5] DRAFT EMAIL');
  const body = [
    `Thanks all for today's ${data.program}.`, '', String(x.summary || ''), '',
    (x.decisions || []).length ? 'Decisions:' : '',
    ...(x.decisions || []).map(d => `  - ${d}`),
    (x.actions || []).length ? '\nActions:' : '',
    ...(x.actions || []).map(a => `  - ${a.title} (${a.owner || 'Unassigned'}${a.due ? ', due ' + a.due : ''})`),
    '', 'Minutes attached to the meeting record in SharePoint.', '', 'Regards',
  ].filter(l => l !== '').join('\n');

  const invited = (found.ev.attendees || []).map(a => a.emailAddress?.address).filter(Boolean);
  const organiser = found.ev.organizer?.emailAddress?.address;
  const recipients = [...new Set(invited.concat(organiser ? [organiser] : []))]
    .filter(a => a.toLowerCase() !== String(MS_SENDER_UPN).toLowerCase())
    .map(a => ({ emailAddress: { address: a } }));
  console.log(`  to        ${recipients.length
    ? recipients.map(r => r.emailAddress.address).join(', ')
    : '(nobody invited — draft left unaddressed for review)'}`);

  const draft = await graph(`/users/${me.id}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: `${x.title || found.ev.subject} — draft minutes and actions`,
      body: { contentType: 'Text', content: body },
      // Everyone invited, not just the organiser: the next run will be Brent's
      // meeting with a different set of people, and a draft addressed to one of
      // them would have to be re-addressed by hand every time.
      toRecipients: recipients,
    }),
  });
  console.log(`  draft created  ${draft.id.slice(0, 24)}...  isDraft=${draft.isDraft}`);

  // Attach an Entra id to every attendee whose name matches an account, so the
  // card can @mention them. A transcript yields display names only, so most
  // external attendees will not resolve — that is expected, and they simply
  // appear as plain text rather than as a mention.
  const withIds = async list => {
    const out = [];
    for (const a of list) {
      const name = (a && a.name || '').trim();
      if (!name) continue;
      try {
        const q = `/users?$select=id,displayName&$filter=${encodeURIComponent(`displayName eq '${name.replace(/'/g, "''")}'`)}`;
        const hit = (await graph(q))?.value?.[0];
        out.push(hit ? { ...a, id: hit.id } : a);
      } catch { out.push(a); }
    }
    const n = out.filter(a => a.id).length;
    console.log(`  attendees  ${n}/${out.length} resolved to accounts, will be @mentioned`);
    return out;
  };

  // ── 6. channel card ───────────────────────────────────────────────────────
  // Graph publishes no application permission for posting a channel message, so
  // the announcement goes through a Teams Workflows webhook the tenant owns.
  // See docs/TEAMS-WEBHOOK-SETUP.md.
  console.log('\n[6] CHANNEL CARD');
  const card = buildMeetingCard({
    subject: x.title || found.ev.subject,
    program: data.program,
    meetingNo: data.meeting_no,
    date: data.date,
    time: data.time,
    venue: data.venue,
    organiser: found.ev.organizer?.emailAddress?.name
      || found.ev.organizer?.emailAddress?.address || '',
    attendees: await withIds(x.attendees || []),
    summary: x.summary || '',
    decisions: x.decisions || [],
    actions: x.actions || [],
    projects: x.projects || [],
    safety: x.safety || [],
    // Prefer the PDF: it opens inline in Teams on any device. Falls back to the
    // original whenever a conversion did not produce one, so a button is never lost.
    urls: {
      folder: chFolder.webUrl,
      minutes: pdfMin.webUrl || chMin.webUrl,
      summary: pdfSum.webUrl || chSum.webUrl,
      transcript: pdfTr.webUrl || chTr.webUrl,
    },
  });

  if (PRINT_CARD) {
    fs.writeFileSync(path.join(scratch, 'card.json'), JSON.stringify(card, null, 2));
    console.log(`  card written  ${path.join(scratch, 'card.json')}  ${JSON.stringify(card).length} bytes`);
  }

  if (failures.length) {
    console.log(`  not posting — ${failures.length} file(s) failed to land: ${failures.join(', ')}`);
  } else if (NO_POST) {
    console.log('  --no-post: card built, not sent.');
  } else if (!TEAMS_MEETING_WEBHOOK_URL) {
    console.log('  no TEAMS_MEETING_WEBHOOK_URL set — skipping channel post.');
  } else {
    // A missing announcement is recoverable; a duplicate one is not, so this
    // retries once and then gives up rather than failing the run.
    try {
      // A URL carrying its own ?sig= is self-authenticating. Without one the flow
      // is tenant-restricted and wants a bearer token instead — decided by the
      // URL rather than a second setting that could drift out of step with it.
      const hdrs = { 'Content-Type': 'application/json' };
      if (!/[?&]sig=/.test(TEAMS_MEETING_WEBHOOK_URL)) {
        hdrs.Authorization = `Bearer ${await token('https://service.flow.microsoft.com/.default')}`;
        console.log('  tenant-restricted webhook — attaching an app-only token');
      }
      const r = await retry(() => fetch(TEAMS_MEETING_WEBHOOK_URL, {
        method: 'POST', headers: hdrs, body: JSON.stringify(card),
      }), 2);
      // Power Automate answers 202 Accepted, not 200.
      if (r.ok) console.log(`  posted  ${r.status}`);
      else console.log(`  post FAILED  ${r.status} — ${(await r.text()).slice(0, 300)}`);
    } catch (e) {
      console.log(`  post FAILED  ${e.message}`);
    }
  }

  console.log(`\nchannel minutes: ${chMin.webUrl || '(see the channel)'}`);
  console.log(`archive minutes: ${filed.webUrl || '(see SharePoint)'}`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exitCode = 1; });
