#!/usr/bin/env node
/**
 * Seeds the `sources` table from sources/registry.yaml.
 *
 * The registry is the source of truth — this is an upsert on `slug`, so it is
 * safe to re-run after editing the registry. Runtime columns (last_fetch_at,
 * last_status, consecutive_failures) are never overwritten.
 *
 * Needs an SSH tunnel to the VPS Postgres:
 *   ssh -i ~/.ssh/pf-nfac-hostinger -L 5433:127.0.0.1:5432 root@187.127.213.243 -N
 *
 *   node db/seed-sources.js
 */
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const registry = yaml.parse(
  fs.readFileSync(path.join(__dirname, '..', 'sources', 'registry.yaml'), 'utf8')
);

const client = new Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DB,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

(async () => {
  await client.connect();
  let inserted = 0, updated = 0;

  for (const s of registry.sources) {
    // Everything that is not a first-class column travels in `config`.
    const config = {};
    if (s.feed_url) config.feed_url = s.feed_url;
    if (s.requires_browser) config.requires_browser = true;
    // Firecrawl renders this source's client-side JavaScript. Carried explicitly:
    // the seeder drops unknown keys, which is how feed_url once vanished.
    if (s.firecrawl) config.firecrawl = true;
    if (s.session_site) config.session_site = s.session_site;
    if (s.filter) config.filter = s.filter;
    if (s.note) config.note = s.note;
    if (s.selectors) config.selectors = s.selectors;

    const { rows } = await client.query(
      `INSERT INTO sources (slug, name, category, subcategory, url, method, config, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         subcategory = EXCLUDED.subcategory,
         url = EXCLUDED.url,
         method = EXCLUDED.method,
         config = EXCLUDED.config,
         active = EXCLUDED.active
       RETURNING (xmax = 0) AS is_insert`,
      [s.slug, s.name, s.category, s.subcategory ?? null, s.url, s.method,
       JSON.stringify(config), s.active !== false]
    );
    rows[0].is_insert ? inserted++ : updated++;
  }

  const { rows: summary } = await client.query(
    `SELECT category, method, count(*)::int AS n
     FROM sources GROUP BY category, method ORDER BY category, method`
  );
  console.log(`seeded: ${inserted} inserted, ${updated} updated`);
  console.table(summary);
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
