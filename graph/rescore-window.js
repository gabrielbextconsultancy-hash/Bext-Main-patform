#!/usr/bin/env node
/**
 * Rescore already-analysed articles in a date window under the CURRENT deployed
 * Article-Analysis prompt, in place.
 *
 * Production only ever scores an article once (the Save node is ON CONFLICT DO
 * NOTHING), so when the prompt changes, existing rows keep their old scores.
 * This backfills them. Use it after any edit to the scoring prompt or the
 * relevance floor.
 *
 *   node graph/rescore-window.js --from 2026-08-25 --to 2026-08-26
 *   node graph/rescore-window.js --from 2026-08-25 --to 2026-08-26 --stale-only
 *
 * The window keys on coalesce(published_at, fetched_at) in Australia/Melbourne,
 * exactly as the daily report does, so "--from D --to D+1" is the set the report
 * for day D draws from. --stale-only skips rows already carrying this run's tag,
 * so a quota-interrupted run can be resumed without redoing work.
 *
 * Needs the Postgres tunnel (PG_PORT in .env, 5433 locally) and GEMINI_API_KEY.
 * Small batches and a pause between them keep it under the Gemini rate limit; a
 * 429 is a spent daily quota — wait for the reset and re-run with --stale-only.
 */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const FROM = arg('--from');
const TO = arg('--to');
const STALE_ONLY = process.argv.includes('--stale-only');
const BATCH = Number(arg('--batch', 6));
const GAP_MS = Number(arg('--gap', 3000));
if (!FROM || !TO || !/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{4}-\d{2}-\d{2}$/.test(TO)) {
  console.error('usage: rescore-window.js --from YYYY-MM-DD --to YYYY-MM-DD [--stale-only] [--batch N] [--gap MS]');
  process.exit(1);
}

// The tag stamped on rows this tool rescores, so --stale-only can tell done from
// not-done and the daily report's audit can see which scores are current.
const TAG = 'rescore-' + FROM + '-to-' + TO;

const WF = path.join(__dirname, '..', 'n8n', 'workflows', 'BEXT-Article-Analysis.json');
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const codeNode = wf.nodes.find(n => /code/i.test(n.type) && /score|analys/i.test(n.name));
const PROMPT_LIT = (codeNode.parameters.jsCode.match(/const PROMPT = (".*?");\n/s) || [])[1];
if (!PROMPT_LIT) { console.error('could not read PROMPT from the deployed workflow'); process.exit(1); }
const prompt = JSON.parse(PROMPT_LIT);

const KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.6-flash';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const scoreBatch = async (rows) => {
  const payload = rows.map((r) => ({
    id: Number(r.id), source: r.source_name, category: r.category || 'Industry Updates',
    title: r.title, excerpt: (r.summary_raw || '').slice(0, 600),
  }));
  const body = {
    contents: [{ parts: [{ text: prompt + JSON.stringify(payload, null, 1) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (j?.error?.code === 429) return { quota: true, map: new Map() };
  const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!txt) { console.error('  empty reply: ' + JSON.stringify(j).slice(0, 160)); return { map: new Map() }; }
  let parsed;
  try { parsed = JSON.parse(txt); } catch (e) { console.error('  unparseable: ' + txt.slice(0, 140)); return { map: new Map() }; }
  const map = new Map();
  for (const p of (Array.isArray(parsed) ? parsed : [])) {
    map.set(Number(p.id), { score: Number(p.relevance_score), summary: p.summary });
  }
  return { map };
};

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  const mel = "AT TIME ZONE 'Australia/Melbourne'";
  const params = [FROM + ' 00:00', TO + ' 00:00'];
  const staleClause = STALE_ONLY ? ' AND an.model <> $3' : '';
  if (STALE_ONLY) params.push(TAG);
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.summary_raw, s.name AS source_name, s.category, an.relevance_score AS was
       FROM articles a
       JOIN article_analysis an ON an.article_id = a.id
       JOIN sources s ON s.id = a.source_id
      WHERE (coalesce(a.published_at, a.fetched_at) ${mel}) >= $1
        AND (coalesce(a.published_at, a.fetched_at) ${mel}) <  $2${staleClause}
      ORDER BY a.id`, params);

  console.log(`rescoring ${rows.length} rows in ${FROM}..${TO}, batches of ${BATCH}, tag ${TAG}`);
  let done = 0, changed = 0, toZero = 0, failed = 0;
  const dist = { hi: 0, mid: 0, tan: 0, weak: 0, zero: 0 };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let r = { map: new Map() };
    for (let attempt = 1; attempt <= 3 && r.map.size === 0; attempt++) {
      r = await scoreBatch(batch);
      if (r.quota) {
        console.error(`\nGemini daily quota is exhausted (429). ${done} rescored, ${rows.length - done} left.`);
        console.error(`Wait for the quota reset, then re-run with --stale-only to finish.`);
        await db.end();
        process.exit(2);
      }
      if (r.map.size === 0) { console.error(`  batch ${i} attempt ${attempt} empty; pausing`); await sleep(5000); }
    }
    for (const row of batch) {
      const s = r.map.get(Number(row.id));
      if (!s || !Number.isFinite(s.score)) { failed++; continue; }
      await db.query(
        `UPDATE article_analysis SET relevance_score = $1, summary = coalesce($2, summary), model = $3
          WHERE article_id = $4`, [s.score, s.summary || null, TAG, Number(row.id)]);
      done++;
      if (s.score !== row.was) changed++;
      if (s.score === 0 && row.was !== 0) toZero++;
      dist[s.score >= 80 ? 'hi' : s.score >= 55 ? 'mid' : s.score >= 20 ? 'tan' : s.score >= 1 ? 'weak' : 'zero']++;
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
    await sleep(GAP_MS);
  }
  await db.end();
  console.log(`\nupdated ${done}, changed ${changed}, newly 0 ${toZero}, failed ${failed}`);
  console.log(`distribution:  80-100 ${dist.hi}   55-79 ${dist.mid}   20-54 ${dist.tan}   1-19 ${dist.weak}   0(dropped) ${dist.zero}`);
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
