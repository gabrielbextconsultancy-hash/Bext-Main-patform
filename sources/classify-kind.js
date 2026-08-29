#!/usr/bin/env node
/**
 * Mark undated pages as news or as the site's standing furniture.
 *
 *   node sources/classify-kind.js               the report window, newest first
 *   node sources/classify-kind.js --limit 200
 *   node sources/classify-kind.js --days 30
 *
 * Needs the Postgres tunnel on 5433 and Ollama reachable — locally that means
 *   ssh -i $VPS_SSH_KEY -L 5433:127.0.0.1:5432 -L 11434:127.0.0.1:11434 -N root@$VPS_HOST
 *
 * The judgement itself lives in n8n/lib/classify-kind.js, shared with the
 * News Quality workflow so the two cannot drift.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { classifyKind } = require('../n8n/lib/classify-kind.js');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const LIMIT = Number(arg('--limit', 120));
const DAYS = Number(arg('--days', 5));
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';

// Same shape as n8n's helpers.httpRequest, so the library sees one interface.
const http = async (o) => {
  const res = await fetch(o.url, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: AbortSignal.timeout(o.timeout || 180000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return text; }
};

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });

  // Only what could still reach a sheet, and only what has no date of its own —
  // an article that declares a publication date is news by construction.
  const { rows } = await db.query(
    `SELECT a.id, a.title, s.name AS source
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.content_kind = 'unknown'
        AND a.published_at IS NULL
        AND a.fetched_at > now() - ($1 || ' days')::interval
      ORDER BY a.fetched_at DESC
      LIMIT $2`, [DAYS, LIMIT]);

  if (!rows.length) { console.log('nothing undecided in the window'); await db.end(); return; }
  console.log('judging ' + rows.length + ' undated pages (about ' + Math.ceil(rows.length * 7 / 60) + ' min)');

  const verdicts = await classifyKind(rows, { http, ollamaUrl: OLLAMA, batch: 5 });

  let news = 0, reference = 0, offtopic = 0;
  for (const [id, kind] of verdicts) {
    await db.query('UPDATE articles SET content_kind = $1::article_content_kind WHERE id = $2', [kind, id]);
    if (kind === 'reference') reference++; else if (kind === 'offtopic') offtopic++; else news++;
  }
  // Anything the model would not commit on stays 'unknown' and keeps going out.
  const undecided = rows.length - verdicts.size;

  const sample = await db.query(
    `SELECT title FROM articles WHERE content_kind = 'reference'
      AND fetched_at > now() - ($1 || ' days')::interval
     ORDER BY fetched_at DESC LIMIT 8`, [DAYS]);

  await db.end();
  console.log('\n  news       ' + news);
  console.log('  reference  ' + reference + '   (held out of the sheet)');
  console.log('  offtopic   ' + offtopic + '   (real articles, not industry news - held)');
  console.log('  undecided  ' + undecided + '   (left in, on purpose)');
  if (sample.rowCount) {
    console.log('\n  held as reference:');
    sample.rows.forEach(r => console.log('    ' + String(r.title || '').slice(0, 62)));
  }
})().catch((e) => { console.error('FAILED ' + e.message); process.exitCode = 1; });
