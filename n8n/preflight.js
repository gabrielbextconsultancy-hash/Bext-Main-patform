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
check('R002', 'Code nodes using URL require it from url', () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'n8n/workflows'))) {
    if (!f.endsWith('.json')) continue;
    const wf = JSON.parse(read(`n8n/workflows/${f}`));
    for (const n of codeNodes(wf)) {
      const c = n.parameters.jsCode;
      if (/new URL\(/.test(c) && !/require\(['"]url['"]\)/.test(c)) bad.push(`${f}:${n.name}`);
    }
  }
  return bad.length ? { ok: false, detail: bad.join(', ') } : { ok: true, detail: 'all guarded' };
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
    ['BEXT-Source-Ingest', 'n8n/lib/ingest.js', 'parseFeed'],
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
check('R010', 'every workflow is named "BEXT — ..."', () => {
  const bad = fs.readdirSync(path.join(ROOT, 'n8n/workflows'))
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(read(`n8n/workflows/${f}`)).name)
    .filter(n => !n.startsWith('BEXT — '));
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
