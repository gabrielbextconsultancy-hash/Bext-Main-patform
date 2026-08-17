#!/usr/bin/env node
/**
 * Runs the meeting pipeline once, by hand, printing each stage.
 *
 *   node graph/run-meeting-once.js                 most recent transcript
 *   node graph/run-meeting-once.js --dry           extract only, file nothing
 *   node graph/run-meeting-once.js --file x.vtt    a transcript from disk
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

const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_UPN, GEMINI_API_KEY } = process.env;
const DRY = process.argv.includes('--dry');
const G = 'https://graph.microsoft.com/v1.0';
const SITE = 'bextconsultancy.sharepoint.com:/sites/BEXTHQ';
const BASE = 'API Automation Folder';
const MODEL = 'gemini-3.6-flash';

// The Teams channel is the record: one folder per meeting holding the transcript,
// the minutes and the summary, so the whole history reads chronologically in the
// channel's Files tab without anyone opening SharePoint.
const CHANNEL_SITE = 'bextconsultancy.sharepoint.com:/sites/bext_transcriptsrecords';
const CHANNEL_BASE = 'Bext Transcripts';

/** A plain Word document, assembled directly. Used for the summary, which has no
 *  client template to fill — a .docx is a zip of XML and one flat document needs
 *  no more than that. */
function simpleDocx(title, blocks) {
  const PizZip = require('pizzip');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const p = (text, { bold = false, size = 22, after = 140 } = {}) =>
    `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr><w:r><w:rPr>${bold ? '<w:b/>' : ''}` +
    `<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

  const body = [p(title, { bold: true, size: 32, after: 240 })]
    .concat(blocks.map(b => b.heading
      ? p(b.heading, { bold: true, size: 24, after: 120 })
      : p(b.text, { size: 22, after: b.tight ? 60 : 160 })))
    .join('');

  const zip = new PizZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');
  zip.folder('_rels').file('.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');
  zip.folder('word').file('document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + body
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
    + '</w:body></w:document>');
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

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

async function token() {
  const r = await retry(() => fetch(
    `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
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
  const events = await graph(`/users/${me.id}/calendar/events`
    + '?$top=10&$orderby=start/dateTime desc'
    + '&$select=subject,start,end,organizer,isOnlineMeeting,onlineMeeting');

  let found = null;

  // A transcript from disk, for replaying against a changed prompt or for
  // exercising the fill with content the test meetings did not contain.
  const fileArg = process.argv.indexOf('--file');
  if (fileArg > -1 && process.argv[fileArg + 1]) {
    const ev = events.value.find(e => e.isOnlineMeeting) || {
      subject: 'Weekly Program Check-in',
      start: { dateTime: new Date().toISOString().slice(0, -1) },
      end: { dateTime: new Date().toISOString().slice(0, -1) },
    };
    found = { ev, meeting: { id: 'local' }, tr: { createdDateTime: 'from file' },
              vtt: fs.readFileSync(process.argv[fileArg + 1], 'utf8') };
  }

  for (const ev of found ? [] : events.value.filter(e => e.isOnlineMeeting && e.onlineMeeting?.joinUrl)) {
    let meeting;
    try {
      const r = await graph(`/users/${me.id}/onlineMeetings?$filter=`
        + encodeURIComponent(`JoinWebUrl eq '${ev.onlineMeeting.joinUrl}'`));
      meeting = r.value?.[0];
    } catch { continue; }
    if (!meeting) continue;
    const list = await graph(`/users/${me.id}/onlineMeetings/${meeting.id}/transcripts`);
    if (!(list.value || []).length) continue;
    // Newest transcript on the newest meeting that has one.
    const tr = list.value[list.value.length - 1];
    const r = await retry(() => fetch(
      `${G}/users/${me.id}/onlineMeetings/${meeting.id}/transcripts/${tr.id}/content?$format=text/vtt`,
      { headers: H }));
    found = { ev, meeting, tr, vtt: await r.text() };
    break;
  }
  if (!found) { console.log('  no transcript found on any recent meeting'); return; }

  // Two Teams clients in one call each produce their own stream, so the same
  // utterance arrives twice with slightly different wording — "rate cards" and
  // "read cards". Left in, the model sees every action twice. Compared on the
  // first sixty characters, which is enough to catch the pair without merging
  // two people who genuinely said similar things.
  const before = (found.vtt.match(/<v /g) || []).length;
  const seen = new Set();
  found.vtt = found.vtt.split('\n').filter(line => {
    if (!line.includes('<v ')) return true;
    const key = line.replace(/<\/?v[^>]*>/g, '').trim().slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('\n');
  const after = (found.vtt.match(/<v /g) || []).length;
  if (before !== after) console.log(`  deduped  ${before} -> ${after} lines`);

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
  const put = async (driveId, p, body, type) => {
    const r = await retry(() => fetch(`${G}/drives/${driveId}/root:/${encodeURI(p)}:/content`, {
      method: 'PUT', headers: { ...H, 'Content-Type': type }, body,
    }));
    const j = await r.json();
    console.log(`  ${r.ok ? 'filed' : 'FAILED'}  ${p}${r.ok ? '' : ' — ' + JSON.stringify(j).slice(0, 120)}`);
    return j;
  };

  // The working library keeps a flat archive; the channel keeps the readable record.
  await put(drive, `${BASE}/Meeting Transcripts/${stamp} ${safe}.vtt`, found.vtt, 'text/vtt');
  const filed = await put(drive, `${BASE}/Meeting Minutes/${stamp} ${safe} — Minutes.docx`, docx, DOCX);

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

  await put(chDrive, `${folder}/Transcript.vtt`, found.vtt, 'text/vtt');
  const chMin = await put(chDrive, `${folder}/Minutes.docx`, docx, DOCX);
  await put(chDrive, `${folder}/Summary.docx`, summary, DOCX);
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

  const draft = await graph(`/users/${me.id}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: `${found.ev.subject} — draft minutes and actions`,
      body: { contentType: 'Text', content: body },
      toRecipients: found.ev.organizer?.emailAddress?.address
        ? [{ emailAddress: { address: found.ev.organizer.emailAddress.address } }] : [],
    }),
  });
  console.log(`  draft created  ${draft.id.slice(0, 24)}...  isDraft=${draft.isDraft}`);
  console.log(`\nchannel minutes: ${chMin.webUrl || '(see the channel)'}`);
  console.log(`archive minutes: ${filed.webUrl || '(see SharePoint)'}`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exitCode = 1; });
