#!/usr/bin/env node
/**
 * Delete everything the pipeline gathered before a cutoff date.
 *
 *   node db/prune-before.js --date 2026-08-25 --dry
 *   node db/prune-before.js --date 2026-08-25
 *
 * Articles are matched on their PUBLICATION day in Melbourne — the same term
 * the report, the audit and the dashboard all use — so what disappears here is
 * exactly what disappears from those views, and nothing survives in one place
 * having been deleted in another.
 *
 * article_analysis and report_items fall away by ON DELETE CASCADE; reports and
 * day_audits are removed by their own date. Sources are never touched: they are
 * configuration seeded from sources/registry.yaml, not per-day data, and
 * deleting them stops all fetching until reseeded.
 *
 * Irreversible. It runs in one transaction, prints what it will remove before
 * removing it, and --dry rolls back instead of committing.
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const DATE = arg('--date');
const DRY = process.argv.includes('--dry');

if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error('need --date YYYY-MM-DD (the cutoff; everything BEFORE it is deleted)');
  process.exit(1);
}

// The publication day, in the timezone every other view uses.
const DAY = `(coalesce(published_at, fetched_at) AT TIME ZONE 'Australia/Melbourne')::date`;

(async () => {
  const c = new Client({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  await c.connect();

  const counts = async () => (await c.query(`
    SELECT
      (SELECT count(*)::int FROM articles WHERE ${DAY} < $1::date)              AS articles,
      (SELECT count(*)::int FROM article_analysis an JOIN articles a ON a.id = an.article_id
        WHERE ${DAY.replace(/published_at/g, 'a.published_at').replace(/fetched_at/g, 'a.fetched_at')} < $1::date) AS analyses,
      (SELECT count(*)::int FROM reports WHERE report_date < $1::date)          AS reports,
      (SELECT count(*)::int FROM report_items ri JOIN reports r ON r.id = ri.report_id
        WHERE r.report_date < $1::date)                                          AS report_items,
      (SELECT count(*)::int FROM day_audits WHERE day < $1::date)               AS day_audits,
      (SELECT count(*)::int FROM fetch_attempts WHERE run_at < $1::date)  AS fetch_attempts
  `, [DATE])).rows[0];

  const before = await counts();
  console.log(`cutoff ${DATE} — everything before it:`);
  for (const [k, v] of Object.entries(before)) console.log(`   ${k.padEnd(15)} ${v}`);

  const kept = (await c.query(
    `SELECT count(*)::int n, min(${DAY})::text lo, max(${DAY})::text hi
     FROM articles WHERE ${DAY} >= $1::date`, [DATE])).rows[0];
  console.log(`kept: ${kept.n} articles, ${kept.lo} .. ${kept.hi}`);

  await c.query('BEGIN');
  // Order matters only for clarity; the cascades would cope either way.
  const del = async (label, sql) => {
    const r = await c.query(sql, [DATE]);
    console.log(`   deleted ${String(r.rowCount).padStart(6)}  ${label}`);
  };
  await del('reports (report_items cascade)', 'DELETE FROM reports WHERE report_date < $1::date');
  await del('articles (analysis + ledger cascade)', `DELETE FROM articles WHERE ${DAY} < $1::date`);
  await del('day_audits', 'DELETE FROM day_audits WHERE day < $1::date');
  await del('fetch_attempts', 'DELETE FROM fetch_attempts WHERE run_at < $1::date');

  if (DRY) {
    await c.query('ROLLBACK');
    console.log('--dry: rolled back, nothing was removed');
  } else {
    await c.query('COMMIT');
    const after = await counts();
    const left = Object.values(after).reduce((a, b) => a + b, 0);
    console.log(left === 0
      ? 'committed — nothing before the cutoff remains'
      : `committed — but ${left} rows before the cutoff survive: ${JSON.stringify(after)}`);
  }
  await c.end();
})();
