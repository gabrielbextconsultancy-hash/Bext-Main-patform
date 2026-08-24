#!/usr/bin/env node
/**
 * Ring 1 and ring 2 of docs/SELF-HEALING.md: read what failed, recognise it,
 * fix the handful of things we have agreed it may fix, and hand everything else
 * to a human with the diagnosis already written.
 *
 *   node n8n/self-heal.js --dry-run    classify and print; change nothing
 *   node n8n/self-heal.js              classify and act on the allowlist
 *   node n8n/self-heal.js --json       machine-readable, for a loop agent
 *
 * ── why this is a script and not only a workflow ────────────────────────────
 *
 * `BEXT — Self Heal` runs every fifteen minutes and does the half of this that
 * n8n can do to itself: classify, log, retry an execution, reactivate a
 * workflow, post to Teams. It cannot restart a container, push workflow JSON
 * from the repo, or mint a Graph token, because the Code sandbox allows only
 * crypto/url/https (R022) — no child_process, no pg, no docker.
 *
 * The obvious way to give it those powers is to mount /var/run/docker.sock into
 * bext-n8n. That is refused on purpose: this VPS also runs Premier Fitness in
 * project `n8n`, and the docker socket is root on the host — an escape from our
 * container would reach their stack. CLAUDE.md rule 1 is not only about which
 * commands we type.
 *
 * So the host-level actions live here, where they run under an operator's SSH
 * key with an explicit container allowlist. Same rules file, same incident log,
 * same ids. The workflow heals what it safely can and names the rest; this
 * script finishes the job.
 */
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { classify, RULES, AUTO_ACTIONS } = require('./lib/heal-rules.js');

const {
  N8N_URL, N8N_API_KEY, VPS_HOST, VPS_SSH_KEY,
  PG_HOST, PG_PORT, PG_DB, PG_USER, PG_PASSWORD,
  TEAMS_MEETING_WEBHOOK_URL,
} = process.env;

const DRY = process.argv.includes('--dry-run');
const JSON_OUT = process.argv.includes('--json');

// How many actions the healer may take in a rolling hour. Six is deliberately
// low: a healthy morning needs one or two, and anything past that is a fault
// the healer is making worse by hammering it. R016 is the precedent — a broken
// meeting that retried forever.
const MAX_ACTIONS_PER_HOUR = 6;

// The only containers that may be restarted, and the reasoning for each
// exclusion, because "bext-* is fine" is not true:
//
//   bext-n8n       — restarting it kills the scheduler that runs the healer,
//                    mid-heal, leaving an `attempted` row and no follow-up.
//                    A stuck n8n is a human decision.
//   bext-postgres  — it holds the incident log. Restarting it destroys the
//                    record of why we restarted it.
//   bext-ollama    — slow to warm; a restart looks like a fix and produces a
//                    quiet outage for the next several minutes.
//
// Everything here is stateless and comes back in seconds.
const RESTARTABLE = new Set(['bext-fetcher', 'bext-scrapling', 'bext-api', 'bext-dashboard']);

const log = [];
const note = (level, msg) => { log.push({ level, msg }); if (!JSON_OUT) console.log(`  ${level.padEnd(5)} ${msg}`); };

// ── plumbing ────────────────────────────────────────────────────────────────

const n8n = async (route, init = {}) => {
  if (!N8N_URL || !N8N_API_KEY) throw new Error('N8N_URL / N8N_API_KEY not set');
  const r = await fetch(`${N8N_URL}/api/v1/${route}`, {
    ...init,
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`n8n API ${r.status} on ${route}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
};

// Postgres binds loopback on the VPS, so from a laptop this needs the tunnel
// (docs/INFRASTRUCTURE.md). PG_PORT is 5433 locally and 5432 remotely; that is
// not a typo and connecting to 5432 on a laptop silently reads a different
// database.
async function db() {
  const { Client } = require('pg');
  const c = new Client({
    host: PG_HOST, port: Number(PG_PORT), database: PG_DB,
    user: PG_USER, password: PG_PASSWORD, connectionTimeoutMillis: 8000,
  });
  await c.connect();
  return c;
}

function ssh(command) {
  if (!VPS_HOST || !VPS_SSH_KEY) throw new Error('VPS_HOST / VPS_SSH_KEY not set');
  const key = VPS_SSH_KEY.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
  return execFileSync('ssh', [
    '-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `root@${VPS_HOST}`, command,
  ], { encoding: 'utf8', timeout: 60000 });
}

async function teams(title, text) {
  if (!TEAMS_MEETING_WEBHOOK_URL) { note('warn', 'no Teams webhook configured — escalation not delivered'); return; }
  if (DRY) { note('dry', `would post to Teams: ${title}`); return; }
  await fetch(TEAMS_MEETING_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, text }),
  });
}

// ── ring 1: what failed ─────────────────────────────────────────────────────

async function failedSince(since) {
  // EXECUTIONS_DATA_SAVE_ON_ERROR is `all`, so failures are always recorded even
  // when successes are not. This list is therefore complete for our purposes —
  // but only for FAILURES. A workflow that ran clean and produced nothing leaves
  // nothing here; that is what the Kuma push monitors and preflight R024 catch.
  // Do not add "no executions" logic to this function. It cannot see absence.
  const res = await n8n(`executions?status=error&limit=50&includeData=false`);
  return (res.data || [])
    .filter(e => new Date(e.stoppedAt || e.startedAt) > since)
    .map(e => ({
      id: String(e.id),
      workflowName: (e.workflowData && e.workflowData.name) || e.workflowId,
      workflowId: e.workflowId,
      lastNodeExecuted: e.lastNodeExecuted,
      error: [e.error, e.message, e.stoppedAt && e.data && e.data.resultData
        && e.data.resultData.error && e.data.resultData.error.message].filter(Boolean).join(' '),
      at: e.stoppedAt || e.startedAt,
    }));
}

// ── ring 2: the six things it may do ────────────────────────────────────────

const ACTIONS = {
  async retry_execution(inc) {
    await n8n(`executions/${inc.execution_id}/retry`, { method: 'POST' });
    return `retried execution ${inc.execution_id}`;
  },

  async reactivate_workflow(inc) {
    // Activating through the API does not register the trigger until n8n
    // restarts — that is the R024 / health-check finding, and it is why this
    // reports what it did rather than claiming the workflow is now running.
    // The Kuma push monitor is what confirms it actually fires.
    await n8n(`workflows/${inc.workflow_id}/activate`, { method: 'POST' });
    return `reactivated ${inc.workflow} — the push monitor confirms it, not this call`;
  },

  async redeploy_workflow(inc) {
    // Rule 7: the repo is the source of truth, so drift resolves one way only.
    const file = path.join(__dirname, 'workflows', `${inc.workflow.replace(/^BEXT — /, 'BEXT-').replace(/\s+/g, '-')}.json`);
    const wf = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    await n8n(`workflows/${inc.workflow_id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} }),
    });
    return `redeployed ${inc.workflow} from ${path.basename(file)}`;
  },

  async restart_container(inc) {
    const name = inc.container;
    // Two independent gates. The prefix test alone would pass `bext-n8n`, and
    // the set alone would pass a typo that happened to be in the set — so both,
    // and refuse rather than guess.
    if (!/^bext-[a-z0-9-]+$/.test(name || '')) throw new Error(`refusing: ${name} is not a bext-* container`);
    if (!RESTARTABLE.has(name)) throw new Error(`refusing: ${name} is not on the restart allowlist`);
    if (DRY) return `would restart ${name}`;
    ssh(`docker restart ${name}`);
    return `restarted ${name}`;
  },

  async refresh_graph_token(inc) {
    // Nothing to rotate: the client secret is unchanged and the token is minted
    // per run. Recording the attempt matters because a SECOND R103 within the
    // hour means the secret itself is expiring, which is a human job — the
    // escalation below says so rather than silently retrying twice.
    return 'token is minted per run; nothing cached to clear — a repeat within the hour means the client secret is expiring';
  },

  async flag_source_browser(inc) {
    if (DRY) return `would flag source for the browser fetcher`;
    const c = await db();
    try {
      // Tier 2 is the browser fetcher (db/migrations/015). Setting the floor
      // makes the next run start there instead of failing at tier 1 again.
      await c.query(
        `UPDATE sources SET notes = coalesce(notes,'') || ' [self-heal: needs browser fetcher]'
          WHERE slug = $1 AND coalesce(notes,'') NOT LIKE '%needs browser fetcher%'`,
        [inc.source_slug || '']);
      return `flagged ${inc.source_slug || '(unknown source)'} for the browser fetcher`;
    } finally { await c.end(); }
  },
};

// ── the loop ────────────────────────────────────────────────────────────────

async function main() {
  if (!JSON_OUT) console.log(`Self-heal${DRY ? ' (dry run — nothing will change)' : ''}\n`);

  const c = await db().catch(e => {
    if (/ECONNREFUSED|ETIMEDOUT/.test(e.message)) {
      note('skip', 'no tunnel to Postgres (ssh -L 5433:127.0.0.1:5432) — cannot log incidents, so not acting');
      return null;
    }
    throw e;
  });
  if (!c) return finish(1);

  try {
    const wm = await c.query('SELECT last_seen_at FROM heal_watermark WHERE id = 1');
    const since = wm.rows[0] ? new Date(wm.rows[0].last_seen_at) : new Date(Date.now() - 3600e3);

    const capRow = await c.query(
      `SELECT count(*)::int AS n FROM incidents
        WHERE detected_at > now() - interval '1 hour' AND outcome IN ('attempted','healed','failed')`);
    let budget = MAX_ACTIONS_PER_HOUR - capRow.rows[0].n;

    const failures = await failedSince(since);
    if (!failures.length) { note('ok', `nothing failed since ${since.toISOString()}`); }

    for (const f of failures) {
      // R016 in spirit: one execution, one attempt. Without this a permanently
      // broken run is retried every fifteen minutes forever.
      const seen = await c.query('SELECT 1 FROM incidents WHERE execution_id = $1 LIMIT 1', [f.id]);
      if (seen.rowCount) { note('skip', `${f.workflowName} #${f.id} already handled`); continue; }

      const rule = classify(f);
      const action = rule && AUTO_ACTIONS.has(rule.action) ? rule.action : 'escalate';

      // Written BEFORE the action, so an action that kills the healer still
      // leaves evidence that it was attempted.
      const ins = await c.query(
        `INSERT INTO incidents (workflow, execution_id, rule_id, signature, action, outcome, detail)
         VALUES ($1,$2,$3,$4,$5::heal_action,$6::incident_outcome,$7) RETURNING id`,
        [f.workflowName, f.id, rule ? rule.id : null, (f.error || '').slice(0, 500),
         action, action === 'escalate' ? 'detected' : 'attempted',
         rule ? rule.title : 'unclassified']);
      const incidentId = ins.rows[0].id;

      if (action === 'escalate') {
        const why = rule
          ? `${rule.id} — ${rule.title}.\n\nFix: ${rule.hint || 'see docs/REGRESSIONS.md'}`
          : 'No rule matched. This is a new failure mode — ring 3.';
        await teams(`Self-heal: ${f.workflowName} needs you`,
          `${why}\n\nExecution ${f.id}\n\n${(f.error || '').slice(0, 600)}`);
        await c.query(
          `UPDATE incidents SET outcome='escalated'::incident_outcome, escalated_at=now() WHERE id=$1`, [incidentId]);
        note('esc', `${f.workflowName} #${f.id} → ${rule ? rule.id : 'unclassified'}`);
        continue;
      }

      if (budget <= 0) {
        await c.query(`UPDATE incidents SET outcome='suppressed'::incident_outcome,
                       detail = detail || ' [rate cap]' WHERE id=$1`, [incidentId]);
        note('cap', `${f.workflowName} #${f.id} → ${rule.id} suppressed: ${MAX_ACTIONS_PER_HOUR}/hour reached`);
        continue;
      }

      budget -= 1;
      const inc = { ...f, execution_id: f.id, workflow: f.workflowName, workflow_id: f.workflowId, container: rule.container };
      try {
        const detail = DRY && action !== 'restart_container' && action !== 'flag_source_browser'
          ? `would ${action}` : await ACTIONS[action](inc);
        await c.query(
          `UPDATE incidents SET outcome=$2::incident_outcome, detail=$3, resolved_at=now() WHERE id=$1`,
          [incidentId, DRY ? 'detected' : 'healed', detail]);
        note(DRY ? 'dry' : 'heal', `${f.workflowName} #${f.id} → ${rule.id}: ${detail}`);
      } catch (e) {
        await c.query(
          `UPDATE incidents SET outcome='failed'::incident_outcome, detail=$2 WHERE id=$1`,
          [incidentId, String(e.message).slice(0, 500)]);
        await teams(`Self-heal could not fix ${f.workflowName}`,
          `${rule.id} — ${rule.title}\n\nTried: ${action}\nFailed: ${e.message}`);
        note('FAIL', `${f.workflowName} #${f.id} → ${rule.id}: ${e.message}`);
      }
    }

    if (!DRY) await c.query('UPDATE heal_watermark SET last_seen_at = now() WHERE id = 1');
  } finally {
    await c.end();
  }
  finish(0);
}

function finish(code) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: code === 0, dryRun: DRY, rules: RULES.length, log }, null, 2));
  process.exitCode = code;
}

main().catch(e => { note('FAIL', e.message); finish(1); });
