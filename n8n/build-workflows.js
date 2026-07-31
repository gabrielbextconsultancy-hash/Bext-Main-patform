#!/usr/bin/env node
/**
 * Generates and deploys the BEXT workflows.
 *
 *   node n8n/build-workflows.js          build, deploy, write JSON to n8n/workflows/
 *   node n8n/build-workflows.js --dry    build and write JSON only
 *
 * The parsing logic lives in n8n/lib/ingest.js and is inlined into the Code
 * node at build time, so there is one implementation rather than a copy in the
 * n8n UI that silently drifts from the tested one.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const B = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
const DRY = process.argv.includes('--dry');
const PG_CRED = process.env.N8N_PG_CREDENTIAL_ID;
const TAG = 'BEXT Consultancy';

// The tested parser, minus its CommonJS export line, for embedding in a Code node.
const INGEST_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'ingest.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '')
  .replace(/^const crypto = require\('crypto'\);$/m, '');

const pos = (x, y) => [x, y];

// ─── Workflow 1: Source Ingest ───────────────────────────────────────────────

const INGEST_CODE = `
// --- shared parser, generated from n8n/lib/ingest.js — do not edit here ---
const crypto = require('crypto');
${INGEST_SRC}
// --- end shared parser ---

const FETCHER = 'http://fetcher:8080/fetch';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
};

const sources = $input.all().map(i => i.json);
const out = [];

for (const s of sources) {
  const config = typeof s.config === 'string' ? JSON.parse(s.config) : (s.config || {});
  const target = s.method === 'rss' ? (config.feed_url || s.url) : s.url;
  let articles = [], status = 'ok', error = null;

  try {
    let html;
    if (config.requires_browser) {
      // Imperva-protected or client-rendered — the fetcher renders it in Chromium
      // and solves the challenge.
      const r = await this.helpers.httpRequest({
        method: 'POST', url: FETCHER, json: true, timeout: 90000,
        body: { url: target, timeout: 45000 },
      });
      html = r.html || '';
    } else {
      html = await this.helpers.httpRequest({
        method: 'GET', url: target, headers: HEADERS, timeout: 45000,
      });
    }

    const raw = s.method === 'rss' ? parseFeed(html, target) : parseIndex(html, target);
    articles = normalise(raw, { id: s.id, config });
    if (articles.length === 0) status = 'empty';
  } catch (e) {
    status = 'error';
    error = String(e.message || e).slice(0, 500);
  }

  out.push({ json: { source_id: s.id, slug: s.slug, status, error, articles } });
}

return out;
`;

// ─── Assembly ────────────────────────────────────────────────────────────────

function sourceIngestWorkflow() {
  return {
    name: 'BEXT — Source Ingest',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne', saveExecutionProgress: false },
    nodes: [
      {
        id: 'trigger', name: 'Every hour', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-320, 0),
        parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } },
      },
      {
        id: 'load', name: 'Load active sources', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-100, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          query: 'SELECT id, slug, name, url, method::text AS method, config FROM sources WHERE active ORDER BY id',
          options: {},
        },
      },
      {
        id: 'fetch', name: 'Fetch and parse', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(140, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: INGEST_CODE },
      },
      {
        id: 'split', name: 'One row per article', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(360, 0),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `
// Flatten to one item per article, and carry a status row per source so the
// health of a source that returned nothing is still recorded.
const articles = [], statuses = [];
for (const item of $input.all()) {
  const r = item.json;
  statuses.push({ source_id: r.source_id, status: r.status, error: r.error, count: r.articles.length });
  for (const a of r.articles) articles.push({ json: a });
}
$getWorkflowStaticData('global').lastStatuses = statuses;
return articles;
`,
        },
      },
      {
        id: 'insert', name: 'Insert articles', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(580, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // ON CONFLICT makes the hourly run idempotent — the same article
          // reappearing on an index page is not a new article.
          query: `INSERT INTO articles (source_id, url, title, author, published_at, summary_raw, content_hash)
VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)
ON CONFLICT (url) DO NOTHING`,
          options: {
            queryReplacement:
              '={{ $json.source_id }},{{ $json.url }},{{ $json.title }},{{ $json.author }},{{ $json.published_at }},{{ $json.summary_raw }},{{ $json.content_hash }}',
          },
        },
      },
      {
        id: 'health', name: 'Record source health', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(580, 200),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          query: `UPDATE sources s SET
  last_fetch_at = now(),
  last_status = v.status::fetch_status,
  last_error = nullif(v.error, ''),
  consecutive_failures = CASE WHEN v.status = 'ok' THEN 0 ELSE s.consecutive_failures + 1 END
FROM (SELECT * FROM json_to_recordset($1::json) AS x(source_id int, status text, error text)) v
WHERE s.id = v.source_id`,
          options: { queryReplacement: '={{ JSON.stringify($json.statuses) }}' },
        },
      },
      {
        id: 'statuses', name: 'Collect statuses', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(360, 200),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `return [{ json: { statuses: $input.all().map(i => ({
  source_id: i.json.source_id, status: i.json.status, error: i.json.error || '' })) } }];`,
        },
      },
    ],
    connections: {
      'Every hour': { main: [[{ node: 'Load active sources', type: 'main', index: 0 }]] },
      'Load active sources': { main: [[{ node: 'Fetch and parse', type: 'main', index: 0 }]] },
      'Fetch and parse': {
        main: [[
          { node: 'One row per article', type: 'main', index: 0 },
          { node: 'Collect statuses', type: 'main', index: 0 },
        ]],
      },
      'One row per article': { main: [[{ node: 'Insert articles', type: 'main', index: 0 }]] },
      'Collect statuses': { main: [[{ node: 'Record source health', type: 'main', index: 0 }]] },
    },
  };
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

async function deploy(wf) {
  const dir = path.join(__dirname, 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, wf.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '.json');
  fs.writeFileSync(file, JSON.stringify(wf, null, 2));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
  if (DRY) return;

  const list = await (await fetch(`${B}/api/v1/workflows?limit=100`, { headers: H })).json();
  const existing = list.data?.find(w => w.name === wf.name);

  const url = existing ? `${B}/api/v1/workflows/${existing.id}` : `${B}/api/v1/workflows`;
  const r = await fetch(url, {
    method: existing ? 'PUT' : 'POST',
    headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const j = await r.json();
  if (!r.ok) { console.error(`  FAILED ${r.status}:`, JSON.stringify(j).slice(0, 400)); return null; }
  console.log(`  ${existing ? 'updated' : 'created'} ${j.id}`);

  // Tag it — folders need an enterprise licence, tags do not.
  const tags = await (await fetch(`${B}/api/v1/tags?limit=100`, { headers: H })).json();
  const tag = tags.data?.find(t => t.name === TAG);
  if (tag) {
    await fetch(`${B}/api/v1/workflows/${j.id}/tags`, {
      method: 'PUT', headers: H, body: JSON.stringify([{ id: tag.id }]),
    });
  }
  return j.id;
}

(async () => {
  if (!PG_CRED) {
    console.error('Set N8N_PG_CREDENTIAL_ID in .env first.');
    process.exit(1);
  }
  await deploy(sourceIngestWorkflow());
})();
