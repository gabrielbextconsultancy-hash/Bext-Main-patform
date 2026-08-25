#!/usr/bin/env node
/**
 * Open articles that have no publication date, and read it from the page.
 *
 * The listing parser never opened an article, so every scraped source produced
 * published_at = null and the pipeline dated those stories by when it happened
 * to look at the index. Ingest runs hourly, so an evening story was first seen
 * after midnight and filed under the wrong day — measured at 33% of articles.
 * That is what the client kept reporting as missing news.
 *
 *   node sources/backfill-dates.js              the pending backlog, newest first
 *   node sources/backfill-dates.js --limit 500
 *   node sources/backfill-dates.js --retry-blocked   revisit rate-limited pages
 *
 * Needs the tunnels: 5433 for Postgres, 8090 for Scrapling.
 *
 * The extraction itself lives in n8n/lib/ingest.js so the workflow and this
 * script cannot drift apart; this file is the batch runner around it.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { publishedFromHtml, looksLikeArticle } = require('../n8n/lib/ingest.js');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const LIMIT = Number(arg('--limit', 400));
const RETRY_BLOCKED = process.argv.includes('--retry-blocked');
const SCRAPLING = process.env.SCRAPLING_URL || 'http://127.0.0.1:8090/fetch';

// Global concurrency, but never two requests in flight to the same host.
//
// A flat pool of eight earned 429s from Renewables Now — 23 of 31 apparently
// dateless articles on 25 Aug 2026 were in fact rate-limited, and a 429 is
// indistinguishable from "publishes no date" unless it is handled separately.
// Our highest-volume sources are also the ones most likely to throttle, so
// politeness per host matters more than raw parallelism.
const CONCURRENCY = 8;
const PER_HOST_DELAY_MS = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

/** Serialises per host and spaces requests to the same host. */
const makeHostGate = () => {
  const busy = new Map();
  return async (host, fn) => {
    const prev = busy.get(host) || Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    busy.set(host, prev.then(() => mine));
    await prev;
    try {
      return await fn();
    } finally {
      await sleep(PER_HOST_DELAY_MS);
      release();
      if (busy.get(host) === mine) busy.delete(host);
    }
  };
};

const fetchPage = async (url) => {
  const res = await fetch(SCRAPLING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, include_html: true, timeout: 25 }),
  });
  if (!res.ok) return { state: 'blocked', detail: 'scrapling ' + res.status };
  const j = await res.json();
  // 429 and friends mean "ask again later", not "there is no date here".
  if (j.status === 429 || j.status === 503) return { state: 'blocked', detail: 'http ' + j.status };
  if (!j.ok || (j.status && j.status >= 400)) return { state: 'blocked', detail: 'http ' + j.status };
  return { state: 'ok', html: j.html || '' };
};

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    max: CONCURRENCY + 1,
  });

  const states = RETRY_BLOCKED ? ['pending', 'blocked'] : ['pending'];
  const { rows } = await db.query(
    `SELECT a.id, a.url, s.name AS source
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.published_at IS NULL
        AND a.date_state = ANY($1::article_date_state[])
      ORDER BY a.fetched_at DESC
      LIMIT $2`, [states, LIMIT]);

  console.log('opening ' + rows.length + ' article pages (concurrency ' + CONCURRENCY
    + ', ' + PER_HOST_DELAY_MS + 'ms per host)');

  const gate = makeHostGate();
  const tally = { found: 0, none: 0, blocked: 0, notArticle: 0 };
  let i = 0;

  const worker = async () => {
    while (i < rows.length) {
      const a = rows[i++];
      let out = { state: 'none', detail: null }, published = null;
      try {
        const got = await gate(hostOf(a.url), () => fetchPage(a.url));
        if (got.state === 'blocked') {
          out = { state: 'blocked' };
        } else {
          published = publishedFromHtml(got.html, a.url);
          if (published) out = { state: 'found' };
          else {
            // A landing page has no date because it is not a story. Recording
            // that distinctly stops it being retried forever and keeps it out
            // of the sheet.
            out = { state: 'none' };
            if (looksLikeArticle(got.html) === false) tally.notArticle++;
          }
        }
      } catch (e) {
        out = { state: 'blocked' };
      }
      await db.query(
        'UPDATE articles SET published_at = coalesce($1::timestamptz, published_at), date_state = $2::article_date_state WHERE id = $3',
        [published, out.state, a.id]);
      tally[out.state]++;
      if ((tally.found + tally.none + tally.blocked) % 25 === 0) {
        process.stdout.write('\r  ' + (tally.found + tally.none + tally.blocked) + '/' + rows.length + '   ');
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await db.end();

  console.log('\n\n  dated   ' + tally.found);
  console.log('  no date ' + tally.none + '   (of which ' + tally.notArticle + ' are section pages, not articles)');
  console.log('  blocked ' + tally.blocked + '   (rate-limited or refused — retry with --retry-blocked)');
})().catch((e) => { console.error('FAILED ' + e.message); process.exitCode = 1; });
