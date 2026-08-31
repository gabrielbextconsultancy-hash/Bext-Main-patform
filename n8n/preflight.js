#!/usr/bin/env node
/**
 * Every bug we have already paid for, as an assertion.
 *
 *   node n8n/preflight.js            local + n8n checks
 *   node n8n/preflight.js --vps      also SSH the VPS and check the live container
 *   node n8n/preflight.js --json     machine-readable, for a loop agent
 *
 * The rule: when a failure is diagnosed, it gets a check here in the same change
 * as the fix. A bug that cost an hour once should cost seconds forever after.
 * docs/REGRESSIONS.md carries the story; this file carries the guard.
 *
 * Exit code 0 = clean, 1 = at least one regression. Safe to run any time — it
 * reads, it never writes.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const VPS = process.argv.includes('--vps');
const JSON_OUT = process.argv.includes('--json');
const results = [];

const check = (id, title, fn) => {
  let ok = false, detail = '';
  try { const r = fn(); ok = r === true || (r && r.ok); detail = (r && r.detail) || ''; }
  catch (e) { ok = false; detail = e.message; }
  results.push({ id, title, ok, detail });
};
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const workflow = n => JSON.parse(read(`n8n/workflows/${n}.json`));
const codeNodes = wf => (wf.nodes || []).filter(n => n.parameters && n.parameters.jsCode);

// ── R001 ─ the Code sandbox has no URLSearchParams ──────────────────────────
// Cost: every Graph Health run since 15 Aug, and every Meeting Intake run ever.
// The error names the symbol, never the sandbox, so it reads like a typo.
check('R001', 'Code nodes using URLSearchParams require it from url', () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'n8n/workflows'))) {
    if (!f.endsWith('.json')) continue;
    const wf = JSON.parse(read(`n8n/workflows/${f}`));
    for (const n of codeNodes(wf)) {
      const c = n.parameters.jsCode;
      if (/URLSearchParams/.test(c) && !/require\(['"]url['"]\)/.test(c)) bad.push(`${f}:${n.name}`);
    }
  }
  return bad.length ? { ok: false, detail: bad.join(', ') } : { ok: true, detail: 'all guarded' };
});

// Same class of trap: URL is also withheld.
// The symbol must be DESTRUCTURED, not merely required. `require('url')` for
// URLSearchParams alone satisfied the old version of this check while `new URL()`
// still threw ReferenceError at runtime — every upload failed, put() swallowed it
// into `failures`, and the visible symptom was a 404 on a folder that nothing had
// created. Check the binding, not the import.
check('R002', 'Code nodes destructure every url symbol they use', () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'n8n/workflows'))) {
    if (!f.endsWith('.json')) continue;
    const wf = JSON.parse(read(`n8n/workflows/${f}`));
    for (const n of codeNodes(wf)) {
      const c = n.parameters.jsCode;
      const destructured = [...c.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\(['"]url['"]\)/g)]
        .flatMap(m => m[1].split(',').map(s => s.trim()));
      if (/new URL\(/.test(c) && !destructured.includes('URL')) bad.push(`${f}:${n.name} uses URL`);
      if (/new URLSearchParams\(/.test(c) && !destructured.includes('URLSearchParams'))
        bad.push(`${f}:${n.name} uses URLSearchParams`);
    }
  }
  return bad.length ? { ok: false, detail: bad.join(', ') } : { ok: true, detail: 'all bound' };
});

// ── R003 ─ integration_health.status is an enum, json_to_recordset yields text ──
check('R003', 'integration_health inserts cast to health_status', () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'n8n/workflows'))) {
    if (!f.endsWith('.json')) continue;
    const wf = JSON.parse(read(`n8n/workflows/${f}`));
    for (const n of (wf.nodes || [])) {
      const q = n.parameters && n.parameters.query;
      if (!q || !/integration_health/.test(q)) continue;
      // A literal 'up'/'down' is fine; a column reference needs the cast.
      if (/x\.status(?!::health_status)/.test(q)) bad.push(`${f}:${n.name}`);
    }
  }
  return bad.length ? { ok: false, detail: bad.join(', ') } : { ok: true, detail: 'cast present' };
});

// ── R004 ─ generated Code must actually parse ───────────────────────────────
check('R004', 'every generated Code node parses as async', () => {
  const AF = Object.getPrototypeOf(async function () {}).constructor;
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'n8n/workflows'))) {
    if (!f.endsWith('.json')) continue;
    const wf = JSON.parse(read(`n8n/workflows/${f}`));
    for (const n of codeNodes(wf)) {
      try { new AF('$env', '$input', 'require', n.parameters.jsCode); }
      catch (e) { bad.push(`${f}:${n.name} — ${e.message}`); }
    }
  }
  return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: 'all parse' };
});

// ── R005 ─ inlined libs actually reach the generated code ───────────────────
// NOT a backtick check. n8n/lib/meeting-card.js warns that a backtick or ${ in an
// inlined file is "evaluated at build time and silently corrupts" the copy. That
// is not what happens: these files are interpolated as ${INGEST_SRC} / ${CARD_SRC},
// and a template literal inserts the VALUE — it does not re-evaluate it. Proof:
// ingest.js carries backticks on lines 36 and 203, and the built Source Ingest
// node contains them intact and parses. Only code written directly inside the
// template literal in build-workflows.js needs escaping.
// What is worth guarding is the thing that would actually break: the export line
// stripping, and the library reaching the node at all.
check('R005', 'inlined libs are embedded and stripped of their exports', () => {
  const want = [
    ['BEXT-Daily-News-1-Source-Ingest', 'n8n/lib/ingest.js', 'parseFeed'],
    ['BEXT-Meeting-Intake', 'n8n/lib/meeting-card.js', 'buildMeetingCard'],
    ['BEXT-Meeting-Intake', 'n8n/lib/docx.js', 'dedupeVtt'],
  ];
  const bad = [];
  for (const [wfName, lib, marker] of want) {
    if (!fs.existsSync(path.join(ROOT, lib))) continue;
    if (!fs.existsSync(path.join(ROOT, `n8n/workflows/${wfName}.json`))) continue;
    const code = codeNodes(workflow(wfName)).map(n => n.parameters.jsCode).join('\n');
    if (!new RegExp(marker).test(code)) bad.push(`${lib} not embedded in ${wfName}`);
    if (/^module\.exports\s*=/m.test(code)) bad.push(`${wfName}: module.exports survived the strip`);
  }
  return bad.length ? { ok: false, detail: bad.join(', ') } : { ok: true, detail: 'embedded, exports stripped' };
});

// ── R006 ─ transcripts resolve under the ORGANISER, not the invitee ─────────
// Walking one mailbox's calendar missed every meeting Brent booked.
check('R006', 'meeting discovery uses getAllTranscripts over MEETING_HOSTS', () => {
  const wf = workflow('BEXT-Meeting-Intake');
  const c = codeNodes(wf).map(n => n.parameters.jsCode).join('\n');
  if (!/getAllTranscripts/.test(c)) return { ok: false, detail: 'still discovering some other way' };
  if (!/MEETING_HOSTS/.test(c)) return { ok: false, detail: 'not reading MEETING_HOSTS' };
  if (/calendar\/events/.test(c)) return { ok: false, detail: 'calendar walk is back' };
  return { ok: true, detail: 'organiser-based' };
});

// meetingOrganizerUserId is a FUNCTION parameter; omitting it returns 400.
check('R007', 'getAllTranscripts passes meetingOrganizerUserId', () => {
  const c = codeNodes(workflow('BEXT-Meeting-Intake')).map(n => n.parameters.jsCode).join('\n');
  return /getAllTranscripts\(/.test(c) && /meetingOrganizerUserId/.test(c)
    ? { ok: true, detail: 'present' }
    : { ok: false, detail: 'missing — Graph answers 400' };
});

// $filter=createdDateTime is ACCEPTED AND IGNORED by getAllTranscripts.
check('R008', 'no reliance on $filter for transcript recency', () => {
  const c = codeNodes(workflow('BEXT-Meeting-Intake')).map(n => n.parameters.jsCode).join('\n');
  const m = c.match(/getAllTranscripts[^\n]*\$filter=createdDateTime/);
  return m ? { ok: false, detail: 'server-side filter is silently ignored' }
           : { ok: true, detail: 'filtered client-side' };
});

// ── R009 ─ the inbound webhook URL must survive a redeploy ──────────────────
check('R009', 'Teams Inbound webhookId is pinned', () => {
  if (!fs.existsSync(path.join(ROOT, 'n8n/workflows/BEXT-Teams-Inbound.json')))
    return { ok: false, detail: 'not built — is N8N_WEBHOOK_CREDENTIAL_ID set?' };
  const hook = (workflow('BEXT-Teams-Inbound').nodes || [])
    .find(n => n.type === 'n8n-nodes-base.webhook');
  if (!hook) return { ok: false, detail: 'no webhook node' };
  if (!hook.webhookId) return { ok: false, detail: 'webhookId not pinned — URL moves on redeploy' };
  if (hook.parameters.authentication !== 'headerAuth')
    return { ok: false, detail: 'public endpoint without header auth' };
  return { ok: true, detail: hook.webhookId };
});

// ── R010 ─ project conventions ──────────────────────────────────────────────
// Two shapes are legitimate. Standalone work is "BEXT — ...". The six workflows
// that produce the morning sheet are "BEXT Daily News — N ...", named for the
// pipeline and numbered for their place in it so n8n's alphabetical list - there
// are no folders on Community - shows the run in running order. Everything still
// begins with BEXT, which is what keeps this client's work distinguishable from
// the other tenant on the same instance.
check('R010', 'every workflow is named "BEXT — ..." or "BEXT Daily News — N ..."', () => {
  const bad = fs.readdirSync(path.join(ROOT, 'n8n/workflows'))
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(read(`n8n/workflows/${f}`)).name)
    .filter(n => !/^BEXT — /.test(n) && !/^BEXT Daily News — [1-9] /.test(n));
  return bad.length ? { ok: false, detail: bad.join(', ') } : { ok: true, detail: 'all named' };
});

// ── R011 ─ secrets never reach a committed file ─────────────────────────────
check('R011', 'no live webhook URL or secret in committed files', () => {
  const hits = [];
  const scan = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (/node_modules|\.git$/.test(rel)) continue;
      if (e.isDirectory()) { scan(rel); continue; }
      if (!/\.(json|md|js|yml|yaml)$/.test(e.name)) continue;
      const s = read(rel);
      if (/logic-apis[^"'\s]*sig=/.test(s)) hits.push(rel);
    }
  };
  for (const d of ['flows', 'n8n/workflows', '.claude']) {
    if (fs.existsSync(path.join(ROOT, d))) scan(d);
  }
  return hits.length ? { ok: false, detail: hits.join(', ') } : { ok: true, detail: 'clean' };
});

// ── R012 ─ configuration that must exist for the pipeline to do anything ────
// ── R015 ─ a node that emits nothing stops the workflow dead ────────────────
// meeting_minutes starts empty, so the exclusion-list query returns no rows and
// every downstream node is skipped. The run "succeeds" having done nothing, and
// with EXECUTIONS_DATA_SAVE_ON_SUCCESS=none it leaves no trace at all.
check('R015', 'lookup nodes feeding a Code node set alwaysOutputData', () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'n8n/workflows'))) {
    if (!f.endsWith('.json')) continue;
    const wf = JSON.parse(read(`n8n/workflows/${f}`));
    for (const n of (wf.nodes || [])) {
      if (n.type !== 'n8n-nodes-base.postgres') continue;
      const q = (n.parameters && n.parameters.query) || '';
      if (!/^\s*SELECT/i.test(q)) continue;          // inserts always emit
      const feeds = (wf.connections[n.name]?.main || []).flat().map(c => c.node);
      if (!feeds.length) continue;                    // terminal node, fine
      if (!n.alwaysOutputData) bad.push(`${f}:${n.name} -> ${feeds.join('/')}`);
    }
  }
  return bad.length ? { ok: false, detail: bad.join(', ') } : { ok: true, detail: 'guarded' };
});

// ── R016 ─ a failed row must not retire the meeting ─────────────────────────
// The exclusion list is what stops re-filing the same minutes every tick. If it
// also matches failed rows, the first failure is permanent: the row lands, the
// next run treats the meeting as done, and it is never retried. Observed live —
// exec 1881 discovered nothing because two failed rows excluded both meetings.
check('R016', 'meeting exclusion list ignores failed rows', () => {
  const wf = workflow('BEXT-Meeting-Intake');
  const n = (wf.nodes || []).find(x => /processed meetings/i.test(x.name || ''));
  if (!n) return { ok: false, detail: 'exclusion node not found' };
  const q = (n.parameters && n.parameters.query) || '';
  return /status\s*<>\s*'failed'|status\s*!=\s*'failed'|status\s+NOT\s+IN/i.test(q)
    ? { ok: true, detail: 'failed rows retried' }
    : { ok: false, detail: 'failed rows treated as done — meeting never retried' };
});

// ── R017 ─ an object spread must not clobber the auth header ────────────────
// `{ headers, ...opts }` drops Authorization for any caller that passes headers
// of its own. Every GET kept working (no headers), the draft POST did not, and
// Graph answered 401 — which read as a permissions problem and cost most of a
// day. The auth header must be applied LAST.
check('R017', 'Graph helper applies Authorization after the opts spread', () => {
  const c = codeNodes(workflow('BEXT-Meeting-Intake')).map(n => n.parameters.jsCode).join('\n');
  // find the http({...}) that carries both a spread and a headers key
  const m = c.match(/http\(\{[^}]*\.\.\.opts[^}]*\}\)/s) || c.match(/http\(\{[\s\S]{0,400}?\}\)/);
  if (!m) return { ok: true, detail: 'no opts-spread call found' };
  const block = m[0];
  if (!/\.\.\.opts/.test(block)) return { ok: true, detail: 'no spread' };
  const spreadAt = block.indexOf('...opts');
  const headersAt = block.lastIndexOf('headers');
  return headersAt > spreadAt
    ? { ok: true, detail: 'headers applied after spread' }
    : { ok: false, detail: 'spread overwrites headers — Authorization is dropped' };
});

// ── R020 ─ a binary response must not be JSON-parsed ────────────────────────
// json:true turns a rendered .docx into { type: 'Buffer', data: [...] }.
// Buffer.from() on that object does not throw — it yields the TEXT of the
// envelope, which was uploaded as Minutes.docx. Word then reports "unreadable
// content", which reads as a broken template or a SharePoint permission problem.
check('R020', 'binary fetches are not JSON-parsed', () => {
  const c = codeNodes(workflow('BEXT-Meeting-Intake')).map(n => n.parameters.jsCode).join('\n');
  const bad = [];
  const re = /await call\('([^']+)',\s*\{([\s\S]{0,320}?)\}\);/g;
  let m;
  while ((m = re.exec(c))) {
    const [, label, body] = m;
    if (/encoding:\s*'arraybuffer'/.test(body) && /json:\s*true/.test(body)) bad.push(label);
  }
  if (bad.length) return { ok: false, detail: bad.join(', ') + ' parse a binary body as JSON' };
  if (!/const toBuf =/.test(c)) return { ok: false, detail: 'no toBuf normaliser' };
  if (/Buffer\.from\(docx\)|Buffer\.from\(raw\)/.test(c))
    return { ok: false, detail: 'a binary buffer bypasses toBuf' };
  return { ok: true, detail: 'normalised' };
});

// ── R021 ─ a Buffer body must not be handed to the HTTP helper ──────────────
// A Buffer is an object, and the helper JSON.stringify()s an object body even
// with json:false. Every .docx written through it was the text
// {"type":"Buffer","data":[...]} instead of the file — stored happily, opened by
// Word as "unreadable content". Uploads use https.request, which writes bytes.
check('R021', 'binary uploads bypass the n8n HTTP helper', () => {
  const c = codeNodes(workflow('BEXT-Meeting-Intake')).map(n => n.parameters.jsCode).join('\n');
  if (/call\('file-upload'/.test(c))
    return { ok: false, detail: 'uploads still go through the helper — Buffers will be stringified' };
  if (!/https\.request/.test(c)) return { ok: false, detail: 'no https.request upload path' };
  if (!/504b0304/.test(c)) return { ok: false, detail: 'no zip-magic guard before writing a .docx' };
  return { ok: true, detail: 'https.request + zip guard' };
});

// ── R022 ─ a require() in a Code node needs the sandbox to allow it ─────────
// The Code sandbox only exposes builtins listed in NODE_FUNCTION_ALLOW_BUILTIN.
// Uploads use https.request, and with the container set to "crypto,url" every
// meeting failed at runtime with "Module 'https' is disallowed" — deployed
// cleanly, broke only when it ran.
check('R022', 'every require() in a Code node is allowed by the sandbox', () => {
  // Mirrors NODE_FUNCTION_ALLOW_BUILTIN in infra/docker-compose.yml. Keep the two
  // in step: this check is only as good as the list it compares against.
  const allowed = (process.env.NODE_FUNCTION_ALLOW_BUILTIN || 'crypto,url,https,dns')
    .split(',').map(s => s.trim()).filter(Boolean);
  const missing = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'n8n/workflows'))) {
    if (!f.endsWith('.json')) continue;
    const wf = JSON.parse(read(`n8n/workflows/${f}`));
    for (const n of codeNodes(wf)) {
      for (const m of n.parameters.jsCode.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
        if (!allowed.includes(m[1])) missing.add(`${f}:${n.name} needs ${m[1]}`);
      }
    }
  }
  return missing.size
    ? { ok: false, detail: [...missing].join('; ') + ` (allowed: ${allowed.join(',')})` }
    : { ok: true, detail: `allowed: ${allowed.join(',')}` };
});

// ── R023 ─ the exclusion window must outlast the discovery window ───────────
// Discovery looks back MEETING_LOOKBACK_HOURS; the "already done" list looked
// back 3 days. Anything older than the exclusion window but newer than the
// discovery window was reprocessed on every tick — and with sending enabled that
// mailed the client the same minutes every fifteen minutes. Eight went out.
check('R023', 'exclusion window outlasts discovery, and sends are deduped', () => {
  const wf = workflow('BEXT-Meeting-Intake');
  const n = (wf.nodes || []).find(x => /processed meetings/i.test(x.name || ''));
  const q = (n && n.parameters && n.parameters.query) || '';
  const m = q.match(/created_at\s*>\s*now\(\)\s*-\s*interval\s*'(\d+)\s*days?'/i);
  if (!m) return { ok: false, detail: 'no exclusion window found' };
  const exclusionDays = Number(m[1]);

  const code = codeNodes(wf).map(x => x.parameters.jsCode).join('\n');
  const lk = code.match(/MEETING_LOOKBACK_HOURS\s*\|\|\s*(\d+)/);
  const discoveryDays = lk ? Number(lk[1]) / 24 : 1;

  if (exclusionDays < discoveryDays)
    return { ok: false, detail: `exclusion ${exclusionDays}d < discovery ${discoveryDays}d — meetings reprocess forever` };
  if (!/ALREADY_SENT/.test(code))
    return { ok: false, detail: 'no duplicate-send guard' };
  if (!/COALESCE\(EXCLUDED\.sent_at/i.test(code + q + JSON.stringify(wf)))
    return { ok: false, detail: 'sent_at can be cleared by a reprocess' };
  return { ok: true, detail: `exclusion ${exclusionDays}d ≥ discovery ${discoveryDays}d, sends deduped` };
});

// ── R030 ─ a recurring meeting is many meetings ─────────────────────────────
// A recurring Teams series reuses ONE meetingId across every occurrence. Keying
// the exclusion list on meeting_id therefore retired the whole series the moment
// its first occurrence was minuted: the 25 Aug weekly carried byte-for-byte the
// same meetingId as the 18 Aug one and was skipped, while every run still
// reported success — a skipped candidate is not an error, so nothing went red.
//
// transcriptId is unique per occurrence. This asserts the dedupe key never
// drifts back to the meeting, at all four places it is read or written.
check('R030', 'meetings are deduped by transcript, not by meeting', () => {
  const wf = workflow('BEXT-Meeting-Intake');
  const code = codeNodes(wf).map(x => x.parameters.jsCode).join('\n');

  if (/done\.has\(\s*t\.meetingId\s*\)/.test(code))
    return { ok: false, detail: 'discovery excludes on t.meetingId — a recurring series stops after occurrence 1' };
  if (!/done\.has\(\s*t\.id\s*\)/.test(code))
    return { ok: false, detail: 'discovery has no transcript-keyed exclusion' };
  if (/ALREADY_SENT\.has\(\s*cand\.meetingId\s*\)/.test(code))
    return { ok: false, detail: 'send guard keys on meetingId — occurrence 2 would never be emailed' };

  const seen = (wf.nodes || []).find(x => /processed meetings/i.test(x.name || ''));
  const q = (seen && seen.parameters && seen.parameters.query) || '';
  if (!/'done'\s+AS\s+kind,\s*transcript_id/i.test(q))
    return { ok: false, detail: "the 'done' list still selects meeting_id" };
  if (!/'sent',\s*transcript_id/i.test(q))
    return { ok: false, detail: "the 'sent' list still selects meeting_id" };

  const rec = (wf.nodes || []).find(x => /Record minutes/i.test(x.name || ''));
  const ins = (rec && rec.parameters && rec.parameters.query) || '';
  if (!/ON CONFLICT \(transcript_id\)\s+WHERE transcript_id IS NOT NULL/i.test(ins))
    return { ok: false, detail: 'upsert does not conflict on the partial transcript_id index' };
  if (!/transcript_id text/.test(ins))
    return { ok: false, detail: 'transcript_id missing from the json_to_recordset column list' };

  return { ok: true, detail: 'dedupe keyed on transcriptId end to end' };
});

// ── R031 ─ a host we cannot read must not look like a host with no meetings ──
// Discovery took a bare `continue` on an unreadable mailbox, so a lapsed Teams
// application access policy retired that person's meetings while every run
// reported success. Nothing anywhere compared "transcripts Graph can see"
// against "minutes actually written" — which is why R030 survived a week.
//
// Two halves, and both are load-bearing:
//   Meeting Intake  — total discovery failure throws instead of returning [].
//   Graph Health    — per-host readability, plus the reconciliation.
check('R031', 'an unreadable meeting host cannot pass as an empty one', () => {
  const mi = codeNodes(workflow('BEXT-Meeting-Intake'))
    .map(x => x.parameters.jsCode).join('\n');
  if (!/hostErrors/.test(mi))
    return { ok: false, detail: 'Meeting Intake still swallows a host failure silently' };
  if (!/hostErrors\.length === ORGANISERS\.length/.test(mi))
    return { ok: false, detail: 'Meeting Intake does not fail when every host is unreadable' };

  const gh = workflow('BEXT-Graph-Health');
  const code = codeNodes(gh).map(x => x.parameters.jsCode).join('\n');
  if (!/transcripts readable: /.test(code))
    return { ok: false, detail: 'Graph Health does not probe each MEETING_HOSTS mailbox' };
  if (!/every transcript is minuted/.test(code))
    return { ok: false, detail: 'Graph Health does not reconcile transcripts against minutes' };

  // The reconciliation is only meaningful if it is actually fed the ids.
  const seen = (gh.nodes || []).find(x => /Load minuted transcripts/i.test(x.name || ''));
  if (!seen)
    return { ok: false, detail: 'Graph Health has no node loading minuted transcript ids' };
  if (seen.alwaysOutputData !== true)
    return { ok: false, detail: 'Load minuted transcripts lacks alwaysOutputData — an empty table would stop the workflow (R015)' };
  const wired = ((gh.connections || {})['Load minuted transcripts'] || {}).main;
  if (!wired || !JSON.stringify(wired).includes('Check Graph'))
    return { ok: false, detail: 'Load minuted transcripts is not wired into Check Graph' };

  return { ok: true, detail: 'host failures surface; transcripts reconciled against minutes' };
});

// ── R024 ─ active is not the same as running ────────────────────────────────
// Every workflow read ACTIVE while nothing had executed for fifteen hours. One
// flapping IMAP trigger on BEXT — Newsletter Intake reactivated in a loop, and
// each cycle logged "Deregistered all crons" without re-registering them — so
// the scheduler was dead for the meeting pipeline, the daily report and the
// ingest, all of which still reported themselves healthy.
//
// The readiness check passed too, because it asked "would this work?" rather
// than "is it running?". This asks the second question: the newest execution
// must be younger than one schedule interval plus a margin.
check('R024', 'the scheduler is firing (by evidence, not by log)', () => {
  // Deliberately NOT the execution list.
  //
  // EXECUTIONS_DATA_SAVE_ON_SUCCESS is `none` by default on this instance, so a
  // healthy run leaves no record at all. An earlier version of this check read
  // the execution list, saw a fifteen-hour gap, and reported an outage that had
  // never happened — while every workflow was running perfectly. That is the same
  // trap as R015, walked into twice.
  //
  // Ask the data the workflows write. Source Ingest runs hourly and inserts
  // articles; if the newest row is recent, the scheduler is alive whatever the
  // execution log says.
  const host = process.env.VPS_HOST;
  const keyPath = (process.env.VPS_SSH_KEY || '').replace(/^~/, process.env.HOME || process.env.USERPROFILE);
  if (!host || !keyPath) return { ok: true, detail: 'skipped — no VPS credentials in env' };

  const sql = "SELECT round(extract(epoch from (now()-max(fetched_at)))/60)::int FROM articles;";
  let out;
  try {
    out = execFileSync('ssh', ['-i', keyPath, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
      `root@${host}`,
      `cd /docker/bext && docker compose exec -T postgres psql -U bext -d bext -tAc ${JSON.stringify(sql)}`],
      { encoding: 'utf8', timeout: 45000 });
  } catch (e) {
    return { ok: false, detail: 'could not reach the database: ' + String(e.message).slice(0, 80) };
  }

  const mins = parseInt(String(out).trim().split('\n').filter(Boolean).pop(), 10);
  if (!Number.isFinite(mins)) return { ok: false, detail: 'no articles at all' };
  // Source Ingest is hourly; 150 minutes tolerates one missed run without
  // tolerating a genuinely stopped scheduler.
  return mins <= 150
    ? { ok: true, detail: `newest article ${mins} min ago — ingest is running` }
    : { ok: false, detail: `newest article ${mins} min ago — the scheduler has stalled` };
});

// ── R025 ─ the healer may not quietly grow new powers ───────────────────────
// n8n/lib/heal-rules.js is meant to be appended to often — that is the whole
// point of ring 3. The danger is that appending a rule is also how someone
// accidentally grants the healer an action nobody reviewed, or points a restart
// at the wrong container. So three things are asserted together: every action
// named by a rule exists, every auto action has an implementation, and the
// restart allowlist still excludes the containers that must never be restarted.
check('R025', 'the heal allowlist matches what self-heal.js implements', () => {
  const { RULES, AUTO_ACTIONS } = require('./lib/heal-rules.js');
  const src = read('n8n/self-heal.js');

  // Whatever ACTIONS actually defines, read from the source rather than trusted.
  const implemented = new Set([...src.matchAll(/^\s{2}async (\w+)\(inc\)/gm)].map(m => m[1]));
  const missing = [...AUTO_ACTIONS].filter(a => !implemented.has(a));
  if (missing.length) return { ok: false, detail: 'no implementation for ' + missing.join(', ') };

  const ungoverned = RULES.filter(r => r.action !== 'escalate' && !AUTO_ACTIONS.has(r.action));
  if (ungoverned.length) {
    return { ok: false, detail: ungoverned.map(r => r.id).join(', ') + ' name an action that is not on the allowlist' };
  }

  // The three exclusions and why, in one place, so a future edit that "tidies"
  // them has to argue with this check first. Restarting n8n kills the healer
  // mid-run; restarting postgres destroys the incident log that says why.
  const banned = ['bext-n8n', 'bext-postgres', 'bext-ollama'];
  const listed = (src.match(/const RESTARTABLE = new Set\(\[([^\]]*)\]/) || [])[1] || '';
  const leaked = banned.filter(b => listed.includes(b));
  if (leaked.length) return { ok: false, detail: leaked.join(', ') + ' must never be on the restart allowlist' };

  // Both gates, not one. The prefix test alone passes bext-n8n.
  if (!/\^bext-\[a-z0-9-\]\+\$/.test(src) || !src.includes('RESTARTABLE.has(name)')) {
    return { ok: false, detail: 'the container guard lost its prefix test or its allowlist test' };
  }

  const auto = RULES.filter(r => AUTO_ACTIONS.has(r.action)).length;
  return { ok: true, detail: `${RULES.length} rules, ${auto} auto, ${implemented.size} actions implemented` };
});

// ── R026 ─ one failure, one id, three files ─────────────────────────────────
// A heal rule, its preflight check and its REGRESSIONS.md section are the same
// fact seen three ways. They drift the moment one is renamed, and a healer that
// posts "R017" for a section that no longer exists is worse than one that says
// nothing. Rules numbered R1xx are the healer's own operational classes and have
// no regression entry by design; only the R0xx ids are cross-checked.
check('R026', 'every heal rule that cites a regression cites a real one', () => {
  const { RULES } = require('./lib/heal-rules.js');
  const regressions = read('docs/REGRESSIONS.md');
  // R002b and R005b exist — the suffix marks a variant of the same failure, and
  // dropping it silently points the healer at a section that is not there.
  const cited = RULES.map(r => r.id).filter(id => /^R0\d\d[a-z]?$/.test(id));
  const orphans = cited.filter(id => !new RegExp(`^## ${id}\\b`, 'm').test(regressions));
  return orphans.length
    ? { ok: false, detail: orphans.join(', ') + ' have no section in docs/REGRESSIONS.md' }
    : { ok: true, detail: `${cited.length} rules cite a documented regression` };
});

// ── R027 ─ a push token is a secret that lies ───────────────────────────────
// Worse than an ordinary leaked secret. Anyone holding a Kuma push URL can send
// a heartbeat, and a faked heartbeat makes the deadman report all-clear during
// an outage — it does not merely fail open, it actively covers the failure up.
// Same class as R011, kept separate because the consequence is different.
check('R027', 'no Kuma push token reaches a committed file', () => {
  const suspects = ['n8n/workflows', 'flows', 'infra', 'docs'];
  const hits = [];
  const walk = dir => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/\.(json|ya?ml|md|js)$/.test(e.name)) continue;
      // A push URL carries a token in the path: /api/push/<token>. The env
      // reference ${KUMA_PUSH_*} is what SHOULD be there, so it is not a hit.
      const body = read(rel);
      if (/\/api\/push\/(?!\$)[A-Za-z0-9]{6,}/.test(body)) hits.push(rel);
    }
  };
  suspects.forEach(walk);
  return hits.length
    ? { ok: false, detail: 'push token in ' + hits.join(', ') }
    : { ok: true, detail: 'push tokens stay in .env' };
});

// ── R032 ─ the VPS builds the source we shipped, not a stale copy ───────────
// The repo nests services under infra/ with `build: ../dashboard`; the VPS layout
// is flat, so .github/workflows/deploy.yml rewrites `build: ../` to `build: ./`
// on the way over. Copy the repo compose up by hand and you skip the rewrite:
// `../dashboard` then resolves to /docker/dashboard — a stale directory that
// still exists — and every rebuild silently compiles old source.
//
// Cost: the mind-map slide in 055ea12 built successfully, deployed, and never
// appeared. The build was green the whole time, which is what made it expensive:
// nothing failed, the page simply did not change. R014's shape exactly — correct
// everywhere except where it runs.
//
// Any script that ships compose to the VPS must carry the rewrite.
check('R032', 'deploy scripts rewrite the compose build paths', () => {
  const shippers = ['infra/deploy-self-healing.sh'];
  const bad = [];
  for (const f of shippers) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const body = read(f);
    // Only scripts that actually copy the compose file need the rewrite.
    if (!/docker-compose\.yml/.test(body)) continue;
    if (!/build:\s*\\?\.\\?\.\//.test(body) && !/sed .*build/.test(body)) {
      bad.push(`${f} ships compose without the build-path rewrite`);
    }
  }
  // The VPS itself is the other half; --vps checks the live file.
  return bad.length ? { ok: false, detail: bad.join(', ') }
                    : { ok: true, detail: 'shippers rewrite ../ to ./' };
});

if (VPS) {
  check('R032b', 'the live compose builds from /docker/bext', () => {
    const host = process.env.VPS_HOST;
    const key = (process.env.VPS_SSH_KEY || '').replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    if (!host || !key) return { ok: false, detail: 'VPS_HOST / VPS_SSH_KEY not set' };
    const out = execFileSync('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12',
      `root@${host}`, 'grep -E "^\\s+build:" /docker/bext/docker-compose.yml || true'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const stale = out.split('\n').filter(l => /build:\s*\.\.\//.test(l));
    return stale.length
      ? { ok: false, detail: `${stale.length} service(s) build from ../ — they compile /docker/<name>, not /docker/bext/<name>` }
      : { ok: true, detail: 'all services build from /docker/bext' };
  });
}

// ── R029 ─ the Kuma key and Grafana password never reach a committed file ───
// Prometheus scrapes Kuma with the API key, but the key belongs in a mounted
// password_file (written on deploy from .env), never in the committed
// prometheus.yml. Same class as R027 — a metrics key is lower stakes than a push
// token, but a Grafana admin password in git is not, so both are checked here.
check('R029', 'no Kuma key or Grafana secret in committed infra files', () => {
  const hits = [];
  const scan = dir => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.name === 'kuma_key') continue;             // gitignored, written on deploy
      if (e.isDirectory()) { scan(rel); continue; }
      if (!/\.(ya?ml|json|env|conf)$/.test(e.name)) continue;
      const body = read(rel);
      if (/uk[0-9]_[A-Za-z0-9_-]{10,}/.test(body)) hits.push(`${rel} (kuma key)`);
      // a literal admin password on a GF_SECURITY_ADMIN_PASSWORD line
      if (/GF_SECURITY_ADMIN_PASSWORD\s*[:=]\s*["']?\S/.test(body)
          && !/\$\{GF_SECURITY_ADMIN_PASSWORD/.test(body)) hits.push(`${rel} (grafana pw)`);
      // prometheus must reference a password_file, not an inline password
      if (e.name === 'prometheus.yml' && /^\s*password:\s*\S/m.test(body)) hits.push(`${rel} (inline scrape password)`);
    }
  };
  ['infra'].forEach(scan);
  return hits.length ? { ok: false, detail: hits.join(', ') }
                     : { ok: true, detail: 'kuma key in password_file, grafana pw from env' };
});

// ── R028 ─ the deadman must not be conditional ──────────────────────────────
// Two ways a heartbeat quietly stops being a heartbeat, both of which leave the
// workflow working and the monitoring dead:
//
//   it is missing — a new scheduled workflow shipped without one. Fatal at build
//   time in withHeartbeat(), asserted here too because the exported JSON is what
//   actually deploys.
//
//   it hangs off a branch. Graph Health ends `Record health` -> IF -> `Alert by
//   email`; anchoring on the terminal node would ping ONLY when Graph is broken.
//   A deadman wired behind an IF is inverted, not merely weaker.
check('R028', 'every scheduled workflow has an unconditional heartbeat', () => {
  const problems = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'n8n/workflows'))) {
    if (!f.endsWith('.json')) continue;
    const wf = JSON.parse(read(`n8n/workflows/${f}`));
    if (!(wf.nodes || []).some(n => n.type === 'n8n-nodes-base.scheduleTrigger')) continue;

    const beat = (wf.nodes || []).find(n => n.name === 'Heartbeat');
    if (!beat) { problems.push(`${f} is scheduled with no Heartbeat`); continue; }

    // A monitor that can fail the workflow it monitors is worse than none.
    if (beat.onError !== 'continueRegularOutput') {
      problems.push(`${f}:Heartbeat can fail its own workflow`);
    }

    const anchor = Object.keys(wf.connections || {})
      .find(src => (wf.connections[src].main || []).flat().some(c => c && c.node === 'Heartbeat'));
    if (!anchor) { problems.push(`${f}:Heartbeat is not connected to anything`); continue; }

    const anchorNode = (wf.nodes || []).find(n => n.name === anchor);
    if (anchorNode && /^n8n-nodes-base\.(if|switch|filter)$/.test(anchorNode.type)) {
      problems.push(`${f}:Heartbeat hangs off ${anchor}, a branch — it would only fire on one outcome`);
    }
    // Reaching an empty result set must not silence it (R015 again).
    if (anchorNode && !anchorNode.alwaysOutputData) {
      problems.push(`${f}:${anchor} can emit nothing, which mutes the heartbeat on a quiet cycle`);
    }
  }
  return problems.length ? { ok: false, detail: problems.join('; ') }
                         : { ok: true, detail: 'every schedule has a deadman that always fires' };
});

// ── R033 ─ architecture graph in sync with workflows ─────────────────────────
// dashboard/src/lib/architecture.generated.ts is derived from the exported
// workflows by n8n/build-architecture.js. Assert that regenerating in memory
// matches the committed file, preventing the architecture map from drifting.
check('R033', 'architecture graph is in sync with exported workflows', () => {
  const genPath = path.join(ROOT, 'dashboard/src/lib/architecture.generated.ts');
  if (!fs.existsSync(genPath)) return { ok: false, detail: 'architecture.generated.ts missing' };
  const current = read('dashboard/src/lib/architecture.generated.ts');
  const { buildArchitectureGraph, generateTypeScript } = require('./build-architecture.js');
  const freshGraph = buildArchitectureGraph();
  // Match without timestamp line to test semantic equality
  const stripTime = s => s.replace(/"generatedAt":\s*"[^"]*"/, '"generatedAt": "CHECK"');
  const freshTs = generateTypeScript(freshGraph);
  if (stripTime(current) !== stripTime(freshTs)) {
    return { ok: false, detail: 'architecture.generated.ts is out of sync — run `node n8n/build-architecture.js`' };
  }
  return { ok: true, detail: `${freshGraph.workflowCount} workflows, ${freshGraph.edgeCount} edges in sync` };
});

// ── R034 ─ newsletter tracking links unwrapped before model filter ───────────
check('R034', 'newsletter candidate extraction unwraps tracking URLs and matches apex domain', () => {
  const { candidates, unwrap, getApexDomain } = require('./lib/hermes-extract.js');
  if (typeof unwrap !== 'function' || typeof getApexDomain !== 'function') {
    return { ok: false, detail: 'unwrap or getApexDomain not exported from hermes-extract.js' };
  }
  if (getApexDomain('email.reuters.com') !== 'reuters.com') {
    return { ok: false, detail: 'getApexDomain failed for email.reuters.com' };
  }
  const sample = '<a href="https://link.reuters.com/click/1?url=https%3A%2F%2Fwww.reuters.com%2Fenergy-solar-story">Australia Solar Energy Growth Surges</a>';
  const cands = candidates(sample, 'https://email.reuters.com');
  if (!cands.length || cands[0].url !== 'https://www.reuters.com/energy-solar-story') {
    return { ok: false, detail: 'tracking redirect not unwrapped in candidates()' };
  }
  return { ok: true, detail: 'tracking links unwrapped and apex domains mapped' };
});

check('R012', 'required env is set locally', () => {
  const need = ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_SENDER_UPN',
                'MEETING_HOSTS', 'TEAMS_MEETING_WEBHOOK_URL', 'N8N_WEBHOOK_CREDENTIAL_ID'];
  const missing = need.filter(k => !process.env[k]);
  return missing.length ? { ok: false, detail: 'missing ' + missing.join(', ') }
                        : { ok: true, detail: `${need.length} keys` };
});

// The one that actually bit: the variable existed locally and in the repo's
// compose file, but never reached the deployed container.
check('R013', 'MEETING_HOSTS lists more than the automation account', () => {
  const v = (process.env.MEETING_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (v.length < 2) return { ok: false, detail: `only ${v.length} host — meetings others book are invisible` };
  return { ok: true, detail: `${v.length} hosts` };
});

if (VPS) {
  check('R014', 'the live container sees MEETING_HOSTS', () => {
    const host = process.env.VPS_HOST;
    const key = (process.env.VPS_SSH_KEY || '').replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    if (!host || !key) return { ok: false, detail: 'VPS_HOST / VPS_SSH_KEY not set' };
    const out = execFileSync('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12',
      `root@${host}`, 'docker compose -f /docker/bext/docker-compose.yml exec -T n8n printenv MEETING_HOSTS'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return out.includes('@') ? { ok: true, detail: out.split(',').length + ' hosts in container' }
                             : { ok: false, detail: 'empty in container — needs docker compose up -d n8n' };
  });
}

// ── R035 ─ the report SQL must PLAN against the live schema ─────────────────
// Cost: the 28 Aug 05:00 send. A subquery referenced the window alias from a
// scope where it does not exist; every static check passed, because only the
// database can parse SQL. This check PREPAREs every query in the daily report
// against the real schema through the tunnel, and skips cleanly when no
// database is reachable rather than failing the build on a closed laptop.
check('R035', 'daily-report SQL prepares against the live schema', () => {
  const wf = JSON.parse(read('n8n/workflows/BEXT-Daily-News-5-Daily-Report.json'));
  const queries = wf.nodes
    .filter(n => n.type === 'n8n-nodes-base.postgres' && n.parameters && n.parameters.query)
    .map(n => ({ name: n.name, q: n.parameters.query }));
  const script = [
    "require('dotenv').config();",
    "const {Client}=require('pg');",
    "const qs=JSON.parse(process.argv[1]||'[]');",
    "(async()=>{",
    " const c=new Client({host:process.env.PG_HOST,port:+process.env.PG_PORT,database:process.env.PG_DB,user:process.env.PG_USER,password:process.env.PG_PASSWORD,connectionTimeoutMillis:4000});",
    " try{await c.connect();}catch(e){console.log('SKIP');process.exit(0);}",
    " for(const x of qs){",
    "  try{await c.query('BEGIN');await c.query('PREPARE _pf AS '+x.q);await c.query('ROLLBACK');}",
    "  catch(e){console.log('FAIL '+x.name+': '+String(e.message).slice(0,140));await c.end();process.exit(0);}",
    " }",
    " await c.end();console.log('OK '+qs.length);",
    "})();",
  ].join('');
  try {
    const out = execFileSync('node', ['-e', script, JSON.stringify(queries)],
      { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (out.startsWith('SKIP')) return { ok: true, detail: 'no database reachable — run with the tunnel up to exercise this' };
    if (out.startsWith('FAIL')) return { ok: false, detail: out.slice(5) };
    return { ok: true, detail: queries.length + ' queries prepared clean' };
  } catch (e) {
    return { ok: false, detail: 'checker crashed: ' + String(e.message).slice(0, 120) };
  }
});

// ── R036 ─ the pre-send validator must not block a report that was fine ─────
// The validator is the only node that can stop the client deliverable, so its
// dangerous failure is not missing a flaw — it is inventing one at 05:00 with
// nobody awake to overrule it. Its first draft did: it counted double-escaped
// entities across the raw HTML and would have blocked three of the five reports
// to 30 Aug, every match a crop parameter inside an image URL.
//
// n8n/validate-replay.js runs the shipped node code over reports the client
// actually received. A "would block" verdict there is a false positive by
// definition, and fails the build.
check('R036', 'pre-send validator passes every report already sent', () => {
  try {
    const out = execFileSync('node', ['n8n/validate-replay.js'],
      { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const line = out.split(/\r?\n/).filter(l => /^(OK|SKIP|FAIL)/.test(l)).pop() || out;
    if (line.startsWith('SKIP')) return { ok: true, detail: 'no database reachable — run with the tunnel up to exercise this' };
    return { ok: true, detail: line.slice(3).trim() + ' sent reports replay clean' };
  } catch (e) {
    // A non-zero exit is the harness reporting a blocked report, which is the
    // regression this check exists for; its stdout carries which day and why.
    const out = String((e.stdout || '') + (e.stderr || '')).trim();
    const line = out.split(/\r?\n/).filter(l => /^FAIL/.test(l)).pop();
    return { ok: false, detail: line ? line.slice(5) : out.slice(-200) };
  }
});

// ── report ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  console.log('Preflight — known failure modes\n');
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.id}  ${r.title}`);
    if (r.detail) console.log(`         ${r.detail}`);
  }
  console.log('');
  console.log(failed.length
    ? `${failed.length} regression(s). Each one is written up in docs/REGRESSIONS.md.`
    : `All ${results.length} checks pass.`);
  if (!VPS) console.log('(--vps also checks the deployed container)');
}
process.exitCode = failed.length ? 1 : 0;
