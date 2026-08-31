#!/usr/bin/env node
/**
 * Replay the pre-send validator over reports that were actually sent.
 *
 * The validator is the only node that can stop the client deliverable, so its
 * dangerous failure mode is not missing a flaw — it is inventing one at 05:00
 * with nobody awake to overrule it. Its first draft did exactly that: it counted
 * double-escaped entities across the raw HTML and would have blocked three of
 * the five reports to 30 Aug, every match a crop parameter inside an image URL
 * and none of it text a client reads.
 *
 * So this runs the SHIPPED node code — read out of the built workflow rather
 * than a copy that can drift — against the last N reports the client received
 * and did not complain about. Any "would block" verdict there is a false
 * positive by definition. Preflight R036 runs this; it is also worth running by
 * hand after changing any rule inside the validator.
 *
 * The model half is skipped by handing the node an empty $env: only the
 * deterministic rules can hold a send, so only they need this guarantee.
 *
 *   node n8n/validate-replay.js [--limit 12] [--verbose]
 *
 * Exits 0 when every replayed report would send, 1 when any would be blocked,
 * and 0 with SKIP when no database is reachable — a closed laptop must not fail
 * the build.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const WF = path.join(__dirname, 'workflows', 'BEXT-Daily-News-5-Daily-Report.json');
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1])
  || Number(process.argv[process.argv.indexOf('--limit') + 1]) || 12;
const VERBOSE = process.argv.includes('--verbose');

const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;

function loadValidator() {
  const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
  const node = (wf.nodes || []).find(n => n.name === 'Validate before send');
  if (!node) throw new Error('the Daily Report has no "Validate before send" node');
  // The node reads the sheet through $('Render HTML') and the reviewer's answer
  // through $('Gemini reviews the sheet'). Point both at local stubs and the
  // rest of the node runs unaltered — which is the whole point of replaying it.
  //
  // The reviewer stub answers nothing, so the model half reports "unavailable"
  // and only the deterministic rules run. That is deliberate: those rules are
  // the only ones with the authority to hold a send, so they are the only ones
  // that need this guarantee, and the replay stays offline and repeatable.
  const body = node.parameters.jsCode
    .replace(/\$\('Render HTML'\)\.first\(\)\.json/g, '__rendered')
    .replace(/\$\('Gemini reviews the sheet'\)\.first\(\)\.json/g, '__review');
  return new AsyncFn('$env', '__rendered', '__review', body);
}

(async () => {
  let run;
  try {
    run = loadValidator();
  } catch (e) {
    console.log('FAIL ' + e.message);
    process.exit(1);
  }

  const c = new Client({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    connectionTimeoutMillis: 4000,
  });
  try {
    await c.connect();
  } catch {
    console.log('SKIP no database reachable');
    process.exit(0);
  }

  const { rows } = await c.query(`
    SELECT id, report_date, html
    FROM reports
    WHERE status = 'sent' AND html IS NOT NULL
    ORDER BY report_date DESC
    LIMIT $1`, [LIMIT]);

  const blocked = [];
  for (const r of rows) {
    // The blurb the report actually carried, read from the ledger rather than
    // rebuilt from article_analysis. Rebuilding was wrong: requeueing articles
    // for rescoring deletes their analysis rows, and the replay then judged a
    // sent report against text it never contained — it reported 2026-08-28 as
    // "52% of items have no usable summary" minutes after a backfill requeued
    // 88 articles. A check on history must read history.
    const it = await c.query(`
      SELECT coalesce(ri.blurb, '') AS blurb, a.title
      FROM report_items ri
      JOIN articles a ON a.id = ri.article_id
      WHERE ri.report_id = $1`, [r.id]);

    const day = r.report_date.toISOString().slice(0, 10);
    let out;
    try {
      out = (await run({}, { items: it.rows, html: r.html || '' }, {}))[0].json;
    } catch (e) {
      console.log(`FAIL validator threw on ${day}: ${String(e.message).slice(0, 140)}`);
      await c.end();
      process.exit(1);
    }
    if (out.validation_ok === false) blocked.push(`${day} — ${out.validation_detail}`);
    if (VERBOSE) {
      console.log(`  ${day}  items=${String(it.rows.length).padStart(3)}  `
        + (out.validation_ok === false ? 'WOULD BLOCK' : 'would send') + `  ${out.validation_detail}`);
    }
  }
  await c.end();

  if (blocked.length) {
    console.log('FAIL would have blocked ' + blocked.length + ' of ' + rows.length + ': ' + blocked.join('; '));
    process.exit(1);
  }
  console.log('OK ' + rows.length);
})();
