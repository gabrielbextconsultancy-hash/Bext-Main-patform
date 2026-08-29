#!/usr/bin/env node
/**
 * Seeds brief_links from docs/brief-links.txt, mapping each link to its
 * registered source with the same host-and-path logic the day audit uses.
 * Run after any registry or brief change:  node db/seed-brief-links.js
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const host = (u) => { try { const h = new URL(u).host; return h.indexOf('www.') === 0 ? h.slice(4) : h; } catch (e) { return ''; } };
const pth = (u) => { try { return new URL(u).pathname.toLowerCase(); } catch (e) { return ''; } };
const MANUAL = {
  'reuters.com': 'reuters-carbon', 'theaustralian.com.au': 'the-australian',
  'iea.org': 'iea-energy-efficiency', 'portal.cleanenergycouncil.org.au': 'cec',
};

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  const src = (await db.query(`SELECT id, slug, url, config->>'feed_url' AS feed_url FROM sources`)).rows;
  const links = fs.readFileSync(path.join(__dirname, '..', 'docs', 'brief-links.txt'), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const rows = links.map((link, i) => {
    const h = host(link), p = pth(link);
    let best = null, score = -1;
    for (const s of src) {
      let sc = -1;
      if (host(s.url) === h || host(s.feed_url || '') === h) sc = 1;
      else if (MANUAL[h] === s.slug) sc = 0.5;
      if (sc < 0) continue;
      for (const seg of p.split('/')) if (seg && pth(s.url).indexOf(seg) > -1) sc++;
      if (sc > score) { score = sc; best = s; }
    }
    return { n: i + 1, url: link, source_id: best ? best.id : null };
  });

  await db.query(`INSERT INTO brief_links (n, url, source_id, updated_at)
    SELECT x.n, x.url, x.source_id, now()
    FROM json_to_recordset($1::json) AS x(n int, url text, source_id int)
    ON CONFLICT (n) DO UPDATE SET url = EXCLUDED.url, source_id = EXCLUDED.source_id, updated_at = now()`,
    [JSON.stringify(rows)]);
  const unmapped = rows.filter((r) => !r.source_id).length;
  console.log('seeded ' + rows.length + ' brief links (' + unmapped + ' unmapped)');
  await db.end();
})().catch((e) => { console.error('FAILED ' + e.message); process.exitCode = 1; });
