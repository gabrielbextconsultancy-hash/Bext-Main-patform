#!/usr/bin/env node
/**
 * The full picture: every source, the URL it is read from, which route delivered,
 * and whether each route of the ladder is actually operational.
 *
 *   node sources/checklist.js           the checklist
 *   node sources/checklist.js --live    also re-test every URL right now
 *
 * --live matters more than it sounds. The stored status says what happened at
 * the last scheduled run, which can be an hour old and can be stale in the worst
 * way: a source that started failing since. Re-testing answers "can we fetch this
 * right now", which is the question being asked when someone asks for a checklist.
 *
 * Needs the tunnel for the database and the Scrapling service:
 *   ssh -i $VPS_SSH_KEY -L 5433:127.0.0.1:5432 -L 8090:127.0.0.1:8090 -N root@$VPS_HOST
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const LIVE = process.argv.includes('--live');
const SCRAPLING = process.env.SCRAPLING_URL || 'http://127.0.0.1:8090/fetch';
const FETCHER = process.env.FETCHER_URL || 'http://127.0.0.1:8080/fetch';

const TIERS = ['email', 'direct', 'browser', 'signed in', 'model'];
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

const probe = async (url) => {
  try {
    const r = await fetch(SCRAPLING, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, timeout: 20 }),
    });
    if (!r.ok) return { ok: false, status: 'svc ' + r.status };
    const j = await r.json();
    return { ok: !!j.ok, status: j.status, links: (j.links || []).length };
  } catch (e) {
    return { ok: false, status: 'err' };
  }
};

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    max: 10,
  });

  const { rows } = await db.query(`
    SELECT s.slug, s.name, s.category, s.method::text AS method, s.active,
           s.last_status::text AS last_status, s.satisfied_by_tier, s.email_authoritative,
           coalesce(s.config->>'feed_url', s.url) AS fetch_url,
           s.config->>'note' AS note,
           (SELECT count(*) FROM articles a
             WHERE a.source_id = s.id AND a.fetched_at > now() - interval '7 days') AS articles_7d
      FROM sources s
     ORDER BY s.category, s.name`);

  // Health of the routes themselves. A source failing because a service is down
  // is a different problem from a source the publisher has blocked, and the
  // checklist is misleading if it cannot tell them apart.
  const services = {};
  for (const [name, url] of [['scrapling (direct)', SCRAPLING], ['fetcher (browser)', FETCHER]]) {
    try {
      const health = url.replace(/\/(fetch|session-fetch)$/, '/health');
      const r = await fetch(health, { signal: AbortSignal.timeout(8000) });
      services[name] = r.ok ? 'up' : 'HTTP ' + r.status;
    } catch (e) { services[name] = 'unreachable'; }
  }
  const { rows: nl } = await db.query(
    `SELECT count(*) AS senders, (SELECT count(*) FROM newsletter_messages) AS received
       FROM newsletter_senders WHERE active`);
  const { rows: att } = await db.query(
    `SELECT tier, count(*) FILTER (WHERE outcome = 'success') AS wins, count(*) AS tries
       FROM fetch_attempts GROUP BY tier ORDER BY tier`);

  console.log('\nROUTES\n' + '-'.repeat(78));
  for (const [n, v] of Object.entries(services)) console.log('  ' + pad(n, 22) + v);
  console.log('  ' + pad('newsletter (email)', 22) + nl[0].senders + ' senders registered, ' + nl[0].received + ' messages received');
  console.log('  ' + pad('per-tier wins', 22) + att.map(a => TIERS[a.tier] + ':' + a.wins + '/' + a.tries).join('  '));

  const live = new Map();
  if (LIVE) {
    console.log('\nre-testing every active URL...');
    const active = rows.filter(r => r.active);
    const queue = [...active];
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const s = queue.shift();
        live.set(s.slug, await probe(s.fetch_url));
        process.stdout.write('.');
      }
    }));
    console.log('\n');
  }

  let cat = null;
  // Three states, not two. "Reachable" and "delivering articles" are different
  // properties, and conflating them is how a source reads as healthy while
  // returning nothing — the exact failure this whole ladder exists to surface.
  let delivering = 0, silent = 0, unreachable = 0, off = 0;
  for (const s of rows) {
    if (s.category !== cat) {
      cat = s.category;
      console.log('\n' + cat.toUpperCase() + '\n' + '-'.repeat(78));
    }
    const l = live.get(s.slug);
    const reachable = l ? l.ok : s.last_status === 'ok';
    const delivers = s.satisfied_by_tier !== null && s.satisfied_by_tier !== undefined;
    // + delivering · inactive ! reachable but silent x cannot be reached
    const mark = !s.active ? '·' : (!reachable ? 'x' : (delivers ? '+' : '!'));
    if (!s.active) off++;
    else if (mark === '+') delivering++;
    else if (mark === '!') silent++;
    else unreachable++;

    const route = delivers ? TIERS[s.satisfied_by_tier] : (s.active ? 'NONE' : '-');
    const liveNote = l ? (l.ok ? `live ${l.status} · ${l.links} links` : `live ${l.status}`) : '';

    console.log(' ' + mark + ' ' + pad(s.name, 34) + pad(route, 10) + pad(s.articles_7d + '/7d', 9) + liveNote);
    console.log('     ' + s.fetch_url.slice(0, 96));
    if (!s.active && s.note) console.log('     ' + String(s.note).replace(/\s+/g, ' ').slice(0, 92));
  }

  console.log('\n' + '='.repeat(78));
  console.log(`  ${delivering} delivering   ${silent} reachable but silent   ${unreachable} unreachable   ${off} inactive   ${rows.length} total`);
  console.log('  +  delivering — a route returned articles');
  console.log('  !  reachable but silent — the page loads and yields nothing. Needs a parser or a different URL,');
  console.log('     and is the state that looks healthy while contributing nothing.');
  console.log('  x  unreachable');
  console.log('  ·  inactive — deliberately not fetched');
  await db.end();
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
