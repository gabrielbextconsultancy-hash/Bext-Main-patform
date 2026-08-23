#!/usr/bin/env node
/**
 * Re-score already-analysed articles under the current prompt.
 *
 * The analysis workflow only scores what has never been scored, so a change to
 * the prompt applies to new articles and leaves the backlog on the old scale.
 * A report drawing on both is being filtered by two different standards at once,
 * and the difference is invisible in the output.
 *
 * That matters on 23 Aug 2026: solar was raised to the top of the priority ladder
 * and the report floor dropped from 50 to 40 in the same afternoon. Without this,
 * tomorrow's sheet would mix scores from before and after both changes.
 *
 *   node sources/rescore.js                 last 2 days, dry run
 *   node sources/rescore.js 3 --apply       last 3 days, write the new scores
 *
 * Prints every change before writing anything. Needs the tunnel:
 *   ssh -i $VPS_SSH_KEY -L 5433:127.0.0.1:5432 -N root@$VPS_HOST
 */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DAYS = Number(process.argv[2]) || 2;
const APPLY = process.argv.includes('--apply');
const BATCH = 12;                       // the deployed workflow's batch size
const MODEL = 'gemini-3.6-flash';
const KEY = process.env.GEMINI_API_KEY;

// Read the prompt from the deployed workflow rather than keeping a second copy —
// two prompts that drift apart would make this tool lie about what production does.
const WF = path.join(__dirname, '..', 'n8n', 'workflows', 'BEXT-Article-Analysis.json');
const code = JSON.parse(fs.readFileSync(WF, 'utf8'))
  .nodes.find(n => /code/i.test(n.type) && /score/i.test(n.name)).parameters.jsCode;
const m = code.match(/const PROMPT = ("[\s\S]*?");\n/);
if (!m) { console.error('could not read PROMPT out of the deployed workflow'); process.exit(1); }
const PROMPT = JSON.parse(m[1]);

const scoreBatch = async (rows) => {
  const payload = rows.map(r => ({
    id: r.id, source: r.source_name, category: r.category,
    title: r.title, excerpt: (r.summary_raw || '').slice(0, 600),
  }));
  const body = {
    contents: [{ parts: [{ text: PROMPT + JSON.stringify(payload, null, 1) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const parsed = JSON.parse(txt);
      const out = new Map();
      for (const p of (Array.isArray(parsed) ? parsed : [])) {
        if (Number.isFinite(Number(p.relevance_score))) {
          out.set(Number(p.id), { score: Number(p.relevance_score), summary: p.summary || null });
        }
      }
      return out;
    } catch (e) {
      if (attempt === 4) { console.error('  batch failed: ' + String(e.message).slice(0, 90)); return new Map(); }
      await new Promise(r => setTimeout(r, [2000, 8000, 20000][attempt - 1]));
    }
  }
  return new Map();
};

(async () => {
  if (!KEY) { console.error('GEMINI_API_KEY missing'); process.exit(1); }
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });

  const { rows } = await db.query(
    `SELECT a.id, a.title, a.summary_raw, s.name AS source_name, s.category,
            an.relevance_score AS was
       FROM articles a
       JOIN article_analysis an ON an.article_id = a.id
       JOIN sources s ON s.id = a.source_id
      WHERE a.fetched_at > now() - ($1 || ' days')::interval
      ORDER BY a.fetched_at DESC`, [DAYS]);

  console.log(`${rows.length} analysed articles in the last ${DAYS} day(s)`);
  console.log(APPLY ? 'APPLYING new scores\n' : 'DRY RUN — nothing will be written\n');

  const floor = Number(process.env.REPORT_MIN_RELEVANCE || 40);
  let moved = 0, inNow = 0, inBefore = 0, changes = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const scored = await scoreBatch(slice);
    for (const r of slice) {
      const got = scored.get(r.id);
      if (!got) continue;
      if (r.was >= floor) inBefore++;
      if (got.score >= floor) inNow++;
      if (got.score !== r.was) {
        moved++;
        // Only crossings of the floor change what the client sees.
        const crossed = (r.was >= floor) !== (got.score >= floor);
        if (crossed) changes.push({ was: r.was, now: got.score, src: r.source_name, title: r.title });
        if (APPLY) {
          await db.query(
            `UPDATE article_analysis SET relevance_score = $1,
                    summary = coalesce($2, summary), model = $3
              WHERE article_id = $4`,
            [got.score, got.summary, MODEL + ' (rescored)', r.id]);
        }
      }
    }
    process.stdout.write('.');
  }

  console.log('\n\n  scores changed : ' + moved + ' of ' + rows.length);
  console.log('  above floor ' + floor + ' : ' + inBefore + ' before  ->  ' + inNow + ' after');

  const joined = changes.filter(c => c.now >= floor);
  const dropped = changes.filter(c => c.now < floor);
  const show = (list, label) => {
    if (!list.length) return;
    console.log('\n  ' + label + ' (' + list.length + '):');
    for (const c of list.slice(0, 10)) {
      console.log('    ' + String(c.was).padStart(3) + ' -> ' + String(c.now).padEnd(4)
        + c.src.slice(0, 20).padEnd(21) + c.title.slice(0, 44));
    }
  };
  show(joined, 'now IN the report');
  show(dropped, 'now OUT of the report');

  await db.end();
  if (!APPLY) console.log('\nRe-run with --apply to write these.');
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
