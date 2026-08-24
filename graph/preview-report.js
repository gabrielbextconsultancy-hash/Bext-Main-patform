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
  const { rows } = await db.query(selectSql);
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
