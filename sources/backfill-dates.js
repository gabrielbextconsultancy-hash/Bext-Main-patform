#!/usr/bin/env node
/**
 * Give undated articles their real publication date.
 *
 * parseIndex reads a listing page and rarely finds a date there, so scraped
 * articles arrive with published_at NULL. The report then falls back to
 * fetched_at, which reads "published today" — fine while a source trickles, and
 * wrong the moment a backlog arrives at once.
 *
 * It did. Repairing the link scorer on 23 Aug 2026 unlocked forty Clean Energy
 * Council articles in a single run, including items from 2022 and 2023. Undated,
 * every one of them would have appeared in the next morning's sheet as current
 * news in front of the client.
 *
 * The date is on the article page, which we already fetch for its image, in
 * whichever of half a dozen conventions the publisher uses.
 *
 *   node sources/backfill-dates.js           200 most recent undated
 *   node sources/backfill-dates.js 500
 *
 * Needs the tunnel:
 *   ssh -i $VPS_SSH_KEY -L 5433:127.0.0.1:5432 -L 8090:127.0.0.1:8090 -N root@$VPS_HOST
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const SCRAPLING = process.env.SCRAPLING_URL || 'http://127.0.0.1:8090/fetch';
const LIMIT = Number(process.argv[2] || 200);
const CONCURRENCY = 8;

/** Publication date, in whichever convention the page uses. */
const pickDate = (html, url) => {
  const pats = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+name=["'](?:pubdate|publish-date|date|DC\.date\.issued)["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /"published_at"\s*:\s*"([^"]+)"/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m && m[1]) {
      const t = Date.parse(m[1]);
      // Reject nonsense: a date before the web or in the future is a parse error,
      // not a publication date.
      if (Number.isFinite(t) && t > Date.parse('2000-01-01') && t < Date.now() + 86400000) {
        return new Date(t).toISOString();
      }
    }
  }
  // Many publishers date the URL: /2023/07/14/slug or /news/2022-05-03-slug
  const inUrl = url.match(/\/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?:\/|-|$)/);
  if (inUrl) {
    const t = Date.parse(`${inUrl[1]}-${String(inUrl[2]).padStart(2, '0')}-${String(inUrl[3]).padStart(2, '0')}`);
    if (Number.isFinite(t) && t < Date.now() + 86400000) return new Date(t).toISOString();
  }
  return null;
};

const lookup = async (url) => {
  try {
    const r = await fetch(SCRAPLING, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, include_html: true, timeout: 25 }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.ok) return null;
    return pickDate(j.html || '', url);
  } catch (e) { return null; }
};

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    max: CONCURRENCY + 1,
  });

  const { rows } = await db.query(
    `SELECT a.id, a.url, s.name AS source
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.published_at IS NULL
      ORDER BY a.fetched_at DESC
      LIMIT $1`, [LIMIT]
  );
  if (!rows.length) { console.log('nothing undated.'); await db.end(); return; }
  console.log('dating ' + rows.length + ' articles\n');

  const queue = [...rows];
  let dated = 0, unknown = 0, stale = 0;
  const cutoff = Date.now() - 14 * 86400000;

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const a = queue.shift();
      const iso = await lookup(a.url);
      if (iso) {
        dated++;
        if (Date.parse(iso) < cutoff) stale++;
        await db.query('UPDATE articles SET published_at = $1 WHERE id = $2', [iso, a.id]);
        process.stdout.write(Date.parse(iso) < cutoff ? 'o' : '.');
      } else {
        unknown++;
        process.stdout.write('?');
      }
    }
  }));

  console.log('\n\n  dated    ' + dated + '   of which ' + stale + ' are older than the 14-day report window');
  console.log('  unknown  ' + unknown + '   no date found; these keep falling back to fetched_at');
  await db.end();
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
