#!/usr/bin/env node
/**
 * Rewrite a stored report so the dashboard matches what was actually sent.
 *
 * The dashboard reads the reports table, which only the workflow writes. A sheet
 * re-sent by hand — after a fix, say — leaves that row untouched, so "Delivered
 * sheets" keeps showing the broken version and the record disagrees with the
 * client's inbox.
 *
 * That happened on 24 Aug 2026: the 05:00 run stored three items because an
 * over-broad guard had blocked the rest, the guard was corrected, and a 21-item
 * sheet went out by hand while the row still read three.
 *
 *   node graph/rebuild-report-row.js            today, dry run
 *   node graph/rebuild-report-row.js --apply
 *
 * Rebuilds html, item_count and report_items from the same query the workflow
 * uses, so the row is regenerated rather than edited.
 */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const WF = path.join(__dirname, '..', 'n8n', 'workflows', 'BEXT-Daily-News-5-Daily-Report.json');
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const selectSql = wf.nodes.find(n => n.name === 'Top articles, prior day').parameters.query;
const renderCode = wf.nodes.find(n => n.name === 'Render HTML').parameters.jsCode;
const ORDER = ['Australian News', 'Industry Updates', 'International Industry Updates'];

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });

  const { rows } = await db.query(selectSql);
  if (!rows.length) { console.log('nothing qualifies — leaving the row alone'); await db.end(); return; }

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
    intro: '', recipient: process.env.REPORT_RECIPIENT || '',
  };
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  const $input = { first: () => ({ json: d }), all: () => [{ json: d }] };
  const $ = () => ({ first: () => ({ json: { deliverability: 'rebuilt', deliverability_ok: true } }) });
  const out = await new AsyncFn('$input', '$', '$env', 'require', renderCode)($input, $, process.env, require);
  const built = Array.isArray(out) ? out[0].json : out.json;

  const { rows: cur } = await db.query(
    'SELECT report_date::text, item_count FROM reports ORDER BY report_date DESC LIMIT 1');
  const day = cur[0].report_date;

  console.log('report ' + day + ':  stored ' + cur[0].item_count + ' items  ->  rebuilt ' + rows.length);
  for (const s of sections) console.log('   ' + String(s.items.length).padStart(3) + '  ' + s.name);

  if (!APPLY) { console.log('\nDry run. Re-run with --apply.'); await db.end(); return; }

  await db.query(
    `UPDATE reports SET html = $1, item_count = $2, generated_at = now() WHERE report_date = $3`,
    [built.html, rows.length, day]);

  // report_items drives the dashboard's per-source references, so it has to agree
  // with the sheet rather than describe the version that was replaced.
  await db.query('DELETE FROM report_items WHERE report_id = (SELECT id FROM reports WHERE report_date = $1)', [day]);
  // category, rank and blurb are all NOT NULL: the table records what the sheet
  // said about each item, not merely which articles were in it, so the dashboard
  // can show the reference without re-reading the analysis.
  await db.query(
    `INSERT INTO report_items (report_id, article_id, rank, category, blurb)
     SELECT (SELECT id FROM reports WHERE report_date = $2), x.id, x.rank, x.category, x.blurb
     FROM json_to_recordset($1::json) AS x(id bigint, rank int, category text, blurb text)`,
    [JSON.stringify(rows.map((r, i) => ({
      id: Number(r.id), rank: i + 1, category: r.category, blurb: r.summary || '',
    }))), day]);

  console.log('\nrow rebuilt — the dashboard now matches what was sent.');
  await db.end();
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
