#!/usr/bin/env node
/**
 * Render the daily sheet from live data, without sending it.
 *
 * Runs the deployed Render HTML node's own code against the real query, so what
 * you look at is the artefact the workflow would produce — not a reconstruction
 * that can drift from it.
 *
 *   node graph/preview-report.js                  write the HTML, print a summary
 *   node graph/preview-report.js --out report.html
 *
 * Then, to see it in a real inbox without touching the client:
 *   node graph/send-test-report.js --to you@example.com --html report.html
 *
 * Needs the tunnel:
 *   ssh -i $VPS_SSH_KEY -L 5433:127.0.0.1:5432 -N root@$VPS_HOST
 */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : path.join(__dirname, '..', 'report-preview.html');

// --date YYYY-MM-DD previews a specific covered day rather than the default
// (yesterday). Useful for showing the client exactly what a given date produced.
const dateIdx = process.argv.indexOf('--date');
const FORCE_DATE = dateIdx > -1 ? process.argv[dateIdx + 1] : null;
if (FORCE_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(FORCE_DATE)) {
  console.error('--date must be YYYY-MM-DD'); process.exit(1);
}

const WF = path.join(__dirname, '..', 'n8n', 'workflows', 'BEXT-Daily-Report.json');
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const selectSql = wf.nodes.find(n => n.name === 'Top articles, prior day').parameters.query;
const renderCode = wf.nodes.find(n => n.name === 'Render HTML').parameters.jsCode;

// The order the sheet presents its sections in, matching the workflow.
const ORDER = ['Australian News', 'Industry Updates', 'International Industry Updates'];

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  // For a forced date, swap the "yesterday" window for that day's start. The rest
  // of the query — floor, sections, ordering — is left exactly as deployed, so the
  // preview stays faithful to what the workflow produces.
  let sql = FORCE_DATE
    ? selectSql.replace(
        /date_trunc\('day', now\(\) AT TIME ZONE 'Australia\/Melbourne'\)\s*-\s*interval '1 day' AS day_start/,
        `'${FORCE_DATE} 00:00'::timestamp AS day_start`)
    : selectSql;

  // --floor N overrides the relevance line, for showing the full unfiltered fetch.
  // 0 keeps everything scored; the deployed default is 16.
  const floorIdx = process.argv.indexOf('--floor');
  if (floorIdx > -1) {
    const f = Number(process.argv[floorIdx + 1]);
    sql = sql.replace(/an\.relevance_score >= \d+/, `an.relevance_score >= ${f}`);
    console.log('floor overridden to ' + f + ' (deployed default is 16)');
  }

  const { rows } = await db.query(sql);
  await db.end();

  if (!rows.length) {
    console.log('No qualifying articles in the reporting window — the sheet would be empty.');
    return;
  }

  const byCat = new Map();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category).push(r);
  }
  const sections = ORDER.filter(n => byCat.has(n)).map(n => ({ name: n, items: byCat.get(n) }));

  const d = {
    sections, empty: false, item_count: rows.length,
    sources_monitored: rows[0].sources_monitored,
    audit_tally: rows[0].audit_tally || null,
    sources_contributing: new Set(rows.map(r => r.source_name)).size,
    intro: 'Preview render — the sheet as the workflow would build it right now.',
    recipient: 'preview@local',
  };

  // Execute the node's code with the inputs n8n gives it.
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  const $input = { first: () => ({ json: d }), all: () => [{ json: d }] };
  const $ = () => ({ first: () => ({ json: { deliverability: 'preview', deliverability_ok: true } }) });
  const fn = new AsyncFn('$input', '$', '$env', 'require', renderCode);
  const out = await fn($input, $, process.env, require);
  const html = (Array.isArray(out) ? out[0].json : out.json).html;

  fs.writeFileSync(OUT, html);

  const withArt = rows.filter(r => r.image_url).length;
  console.log(rows.length + ' items · ' + sections.length + ' sections · '
    + withArt + ' with artwork · ' + Math.round(html.length / 1024) + ' KB');
  for (const s of sections) console.log('   ' + String(s.items.length).padStart(3) + '  ' + s.name);
  console.log('\nwrote ' + OUT);
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
