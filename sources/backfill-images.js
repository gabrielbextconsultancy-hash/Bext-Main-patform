#!/usr/bin/env node
/**
 * Populate article artwork from each publisher's own og:image.
 *
 * The daily sheet does this for the items it is about to publish. This is the
 * same extraction, run over a backlog — useful after adding the column, and for
 * checking how many sources actually declare a lead image before relying on one.
 *
 *   node sources/backfill-images.js            50 most recent pending
 *   node sources/backfill-images.js 200        a larger batch
 *
 * Needs the Scrapling service reachable, which locally means the tunnel:
 *   ssh -i $VPS_SSH_KEY -L 8090:127.0.0.1:8090 -L 5433:127.0.0.1:5432 -N root@$VPS_HOST
 */
'use strict';
require('dotenv').config();
// A Pool, not a Client: the lookups run concurrently and each writes its result,
// and a single Client executing overlapping queries is deprecated — it works
// today only because pg queues them, and pg@9 removes that behaviour.
const { Pool } = require('pg');

const SCRAPLING = process.env.SCRAPLING_URL || 'http://127.0.0.1:8090/fetch';
const LIMIT = Number(process.argv[2] || 50);
const CONCURRENCY = 8;

const pick = (html, base) => {
  const pats = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m && m[1]) {
      try { return new URL(m[1].trim(), base).toString(); } catch (e) { /* not a usable URL */ }
    }
  }
  return null;
};

const lookup = async (url) => {
  try {
    const r = await fetch(SCRAPLING, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, include_html: true, timeout: 25 }),
    });
    if (!r.ok) return { state: 'blocked', image: null };
    const j = await r.json();
    if (!j.ok) return { state: 'blocked', image: null };
    const img = pick(j.html || '', url);
    return { state: img ? 'found' : 'none', image: img };
  } catch (e) {
    return { state: 'blocked', image: null };
  }
};

(async () => {
  const c = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    max: CONCURRENCY + 1,
  });

  // --report picks exactly what the next sheet will publish. Ordering the whole
  // backlog by fetch time looks similar but is not: it takes the most recently
  // ingested articles, which are usually not the ones that cleared the relevance
  // floor for the day being reported on.
  const forReport = process.argv.includes('--report');
  const sql = forReport
    ? `SELECT a.id, a.url, s.name AS source
         FROM articles a
         JOIN sources s ON s.id = a.source_id
         JOIN article_analysis an ON an.article_id = a.id
        WHERE a.image_state = 'pending'
          AND an.relevance_score >= ${Number(process.env.REPORT_MIN_RELEVANCE || 50)}
          AND (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date
              >= (now() AT TIME ZONE 'Australia/Melbourne')::date - 2
        ORDER BY an.relevance_score DESC
        LIMIT $1`
    : `SELECT a.id, a.url, s.name AS source
         FROM articles a JOIN sources s ON s.id = a.source_id
        WHERE a.image_state = 'pending'
        ORDER BY a.fetched_at DESC
        LIMIT $1`;
  const { rows } = await c.query(sql, [LIMIT]);
  if (!rows.length) { console.log('nothing pending.'); await c.end(); return; }
  console.log('looking up ' + rows.length + ' articles\n');

  const queue = [...rows];
  const tally = { found: 0, none: 0, blocked: 0 };
  const bySource = new Map();

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const a = queue.shift();
      const res = await lookup(a.url);
      tally[res.state]++;
      const t = bySource.get(a.source) || { found: 0, total: 0 };
      t.total++; if (res.state === 'found') t.found++;
      bySource.set(a.source, t);
      await c.query(
        'UPDATE articles SET image_url = $1, image_state = $2::article_image_state WHERE id = $3',
        [res.image, res.state, a.id]
      );
      process.stdout.write(res.state === 'found' ? '.' : (res.state === 'none' ? 'o' : 'x'));
    }
  }));

  console.log('\n\n  found   ' + tally.found + '   publisher declares a lead image');
  console.log('  none    ' + tally.none + '   page read, no og:image');
  console.log('  blocked ' + tally.blocked + '   article page could not be fetched');

  // Which sources will show artwork matters for the layout: a section where no
  // publisher declares images should not look broken.
  const weak = [...bySource.entries()].filter(([, t]) => t.found === 0).map(([s]) => s);
  if (weak.length) console.log('\n  no artwork from: ' + weak.slice(0, 8).join(', ') + (weak.length > 8 ? ` and ${weak.length - 8} more` : ''));

  await c.end();
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
