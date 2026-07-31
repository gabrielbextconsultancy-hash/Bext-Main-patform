#!/usr/bin/env node
/**
 * Fetches every active source and reports what came back — without writing
 * anything to the database.
 *
 *   node n8n/dry-run.js            all sources
 *   node n8n/dry-run.js aemo cec   just those slugs
 *
 * The point is to find the sources that will silently return nothing before
 * they are wired into a workflow that runs hourly.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { parseFeed, parseIndex, normalise } = require('./lib/ingest');

const registry = yaml.parse(
  fs.readFileSync(path.join(__dirname, '..', 'sources', 'registry.yaml'), 'utf8')
);

const only = process.argv.slice(2);
const sources = registry.sources
  .filter(s => s.active !== false)
  .filter(s => only.length === 0 || only.includes(s.slug));

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
};

async function fetchText(url, ms = 20000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: UA, signal: c.signal, redirect: 'follow' });
    return { status: r.status, ok: r.ok, text: await r.text(), url: r.url };
  } finally {
    clearTimeout(t);
  }
}

async function run(s) {
  const target = s.method === 'rss' ? s.feed_url : s.url;
  try {
    const res = await fetchText(target);
    if (!res.ok) return { ...s, count: 0, note: `HTTP ${res.status}` };

    const raw =
      s.method === 'rss' ? parseFeed(res.text, res.url) : parseIndex(res.text, res.url);
    // config.filter is nested under config once seeded; the registry has it flat.
    const items = normalise(raw, { id: 0, config: { filter: s.filter } });

    const recent = items.filter(
      i => i.published_at && Date.now() - Date.parse(i.published_at) < 14 * 86_400_000
    ).length;

    return {
      ...s,
      count: items.length,
      recent,
      dated: items.filter(i => i.published_at).length,
      sample: items[0]?.title ?? null,
      note: raw.length && !items.length ? `${raw.length} found, all filtered out` : '',
    };
  } catch (e) {
    return { ...s, count: 0, note: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

(async () => {
  console.log(`Dry run over ${sources.length} active sources\n`);
  const results = [];
  const q = [...sources];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (q.length) {
        const r = await run(q.shift());
        results.push(r);
        process.stderr.write(r.count > 0 ? '.' : 'x');
      }
    })
  );
  process.stderr.write('\n\n');

  results.sort((a, b) => a.count - b.count || a.slug.localeCompare(b.slug));

  const dead = results.filter(r => r.count === 0);
  const thin = results.filter(r => r.count > 0 && r.count < 3);
  const good = results.filter(r => r.count >= 3);

  const line = r =>
    `  ${r.slug.padEnd(28)} ${String(r.count).padStart(3)} items  ` +
    `${String(r.dated ?? 0).padStart(3)} dated  ${r.method.padEnd(6)} ${r.note}`;

  if (dead.length) {
    console.log(`NOTHING RETURNED (${dead.length}) — these need attention before 18 Aug`);
    dead.forEach(r => console.log(line(r)));
    console.log();
  }
  if (thin.length) {
    console.log(`THIN (${thin.length}) — parsed, but suspiciously few`);
    thin.forEach(r => console.log(line(r)));
    console.log();
  }
  console.log(`WORKING (${good.length})`);
  good.forEach(r => console.log(line(r)));

  console.log(
    `\nTotal ${results.reduce((n, r) => n + r.count, 0)} articles from ` +
      `${good.length + thin.length}/${results.length} sources.`
  );

  fs.writeFileSync(
    path.join(__dirname, 'dry-run.json'),
    JSON.stringify(results.map(({ sample, ...r }) => ({ ...r, sample })), null, 1)
  );
})();
