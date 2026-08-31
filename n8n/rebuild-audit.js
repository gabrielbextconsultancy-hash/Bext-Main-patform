#!/usr/bin/env node
/**
 * Rebuild a day's audit now, instead of waiting for the next scheduled pass.
 *
 * The audit is a stored snapshot, rebuilt three times a day. Between passes it
 * is stale by construction: today's was built at 02:00, when the day was two
 * hours old, and said 31 articles while the database held 194. That is not a
 * fault — but when someone is looking at the page and asking why the numbers
 * disagree, "wait until 23:50" is a poor answer.
 *
 *   node n8n/rebuild-audit.js              rebuild the current audit day
 *   node n8n/rebuild-audit.js --day 2026-08-30
 *   node n8n/rebuild-audit.js --dry        show the tally, write nothing
 *
 * It reuses the shipped pieces rather than reimplementing them: the SELECT and
 * the UPSERT are read out of the built workflow JSON, and the HTML comes from
 * n8n/lib/day-audit.js — the same module the Code node inlines. So a change to
 * the workflow changes this too, and the two cannot drift into disagreeing
 * about what a day contained. That shared-implementation promise is written in
 * the node's own comment; this is the CLI half of it, which had never existed.
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { buildDayAudit } = require('./lib/day-audit.js');

const WF = path.join(__dirname, 'workflows', 'BEXT-Daily-News-4-News-Quality.json');
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const DAY = arg('--day');
const DRY = process.argv.includes('--dry');

function nodeOf(wf, name) {
  const n = (wf.nodes || []).find((x) => x.name === name);
  if (!n) throw new Error(`the News Quality workflow has no "${name}" node`);
  return n;
}

// The brief-link list the Code node carries as a baked-in constant. Read it back
// out of the built node so this cannot fall behind the workflow.
function briefLinksFrom(code) {
  const m = code.match(/const BRIEF_LINKS = (\[[\s\S]*?\]);/);
  return m ? JSON.parse(m[1]) : [];
}

(async () => {
  const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
  const loadSql = nodeOf(wf, 'Load audit data').parameters.query;
  const saveSql = nodeOf(wf, 'Save day audit').parameters.query;
  const briefLinks = briefLinksFrom(nodeOf(wf, 'Build day audit').parameters.jsCode);

  const c = new Client({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    connectionTimeoutMillis: 6000,
  });
  await c.connect();

  const { rows } = await c.query(loadSql);
  const d = rows[0] || {};
  // --day overrides only the label the workflow computed; the article set the
  // SELECT returned is the one it would have used, so an arbitrary past day is
  // NOT rebuildable this way and must not pretend to be.
  if (DAY && DAY !== d.day) {
    console.log(`refusing: the load query returns the ${d.day} article set, not ${DAY}.`);
    console.log('Rebuild the current audit day, or widen the SELECT if past days are needed.');
    await c.end();
    process.exit(1);
  }

  const out = buildDayAudit(String(d.day || ''), d.sources || [], d.articles || [], briefLinks);
  const t = out.tally;
  console.log(`${d.day}: fetched ${t.fetched} · sent ${t.sent} · queued ${t.queued} `
    + `· held ${t.held} · excluded ${t.excluded}`);

  if (DRY) { console.log('(--dry, nothing written)'); await c.end(); return; }

  const before = await c.query('SELECT tally FROM day_audits WHERE day = $1::date', [d.day]);
  await c.query(saveSql, [JSON.stringify([{ day: d.day, tally: JSON.stringify(t), html: out.html }])]);
  const after = await c.query('SELECT tally, updated_at FROM day_audits WHERE day = $1::date', [d.day]);

  const was = before.rows[0] ? JSON.stringify(before.rows[0].tally) : '(none)';
  console.log(`  was   ${was}`);
  console.log(`  now   ${JSON.stringify(after.rows[0].tally)}`);
  // The upsert refuses to replace a populated day with an empty one, so a run
  // that loaded nothing leaves the previous audit standing. Say so plainly
  // rather than reporting a write that did not happen.
  if (JSON.stringify(after.rows[0].tally) === was && t.fetched === 0) {
    console.log('  guard held: an empty tally was not allowed to overwrite a populated day');
  }
  await c.end();
})();
