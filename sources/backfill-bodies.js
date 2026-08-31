#!/usr/bin/env node
/**
 * Read the article text for everything that has none.
 *
 * The scraped sources stored zero characters: the scorer judged them, and the
 * client's summaries were written, from a headline alone. The quality pass now
 * reads every page it opens, but the backlog needs one pass of its own.
 *
 *   node sources/backfill-bodies.js --days 4 --limit 200
 *
 * Polite per host, same as the date backfill: a flat pool earns 429s from the
 * busiest publishers, and a 429 recorded as "no body" is a lie that sticks.
 * Needs the 5433 and 8090 tunnels.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { extractBody, relatedLinks, contentHash } = require('../n8n/lib/ingest.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', 4));
const LIMIT = Number(arg('--limit', 200));
const SCRAPLING = process.env.SCRAPLING_URL || 'http://127.0.0.1:8090/fetch';
const CONCURRENCY = 6;
const PER_HOST_MS = 1300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u; } };

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    max: CONCURRENCY + 1,
  });
  const { rows } = await db.query(
    `SELECT a.id, a.url, a.source_id
       FROM articles a
      WHERE a.body_state IN ('pending','blocked')
        AND a.fetched_at > now() - ($1 || ' days')::interval
      ORDER BY a.fetched_at DESC LIMIT $2`, [DAYS, LIMIT]);

  console.log('reading ' + rows.length + ' article pages');
  const lastHit = {};
  const tally = { found: 0, none: 0, blocked: 0, discovered: 0, rescored: 0 };
  let i = 0;

  const worker = async () => {
    while (i < rows.length) {
      const a = rows[i++];
      const h = hostOf(a.url);
      const wait = (lastHit[h] || 0) + PER_HOST_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastHit[h] = Date.now();

      let body = null, state = 'none', rel = [];
      try {
        const r = await fetch(SCRAPLING, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: a.url, include_html: true, timeout: 25 }),
          signal: AbortSignal.timeout(45000),
        });
        const j = await r.json();
        if (!j.ok || j.status === 429 || j.status === 503) state = 'blocked';
        else {
          body = extractBody(j.html || '');
          state = body ? 'found' : 'none';
          rel = relatedLinks(j.html || '', a.url, { limit: 5 });
        }
      } catch (e) { state = 'blocked'; }

      await db.query(
        'UPDATE articles SET body_text = coalesce($1, body_text), body_state = $2::article_body_state WHERE id = $3',
        [body, state, a.id]);
      tally[state]++;

      if (body) {
        // Judged from a headline before, judged from the article now.
        const d = await db.query('DELETE FROM article_analysis WHERE article_id = $1', [a.id]);
        tally.rescored += d.rowCount;
      }
      for (const x of rel) {
        const ins = await db.query(
          `INSERT INTO articles (source_id, url, title, content_hash) VALUES ($1,$2,$3,$4)
           ON CONFLICT (url) DO NOTHING`,
          [a.source_id, x.url, x.title, contentHash({ title: x.title, summary_raw: null })]);
        tally.discovered += ins.rowCount;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await db.end();

  console.log('\n  bodies read   ' + tally.found);
  console.log('  no body       ' + tally.none);
  console.log('  blocked       ' + tally.blocked + '   (retried next pass)');
  console.log('  requeued      ' + tally.rescored + '   (rescored from the article, not the headline)');
  console.log('  discovered    ' + tally.discovered + '   (new articles found by following links)');
})().catch((e) => { console.error('FAILED ' + e.message); process.exitCode = 1; });
