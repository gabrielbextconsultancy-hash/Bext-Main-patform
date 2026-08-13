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
const SMTP_CRED = process.env.N8N_SMTP_CREDENTIAL_ID;
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
// n8n's Code sandbox does not expose the WHATWG URL global that the parser uses
// to resolve relative hrefs, so pull it off the url builtin explicitly.
const crypto = require('crypto');
const { URL } = require('url');
${INGEST_SRC}
// --- end shared parser ---

const FETCHER = 'http://fetcher:8080/fetch';
// Dated items older than this are ignored. Long enough that a slow-publishing
// regulator still lands, short enough that archive pages cannot refill the table.
const FRESHNESS_DAYS = 14;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
};

const sources = $input.all().map(i => i.json);
const helpers = this.helpers;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchOne(s) {
  const config = typeof s.config === 'string' ? JSON.parse(s.config) : (s.config || {});
  const target = s.method === 'rss' ? (config.feed_url || s.url) : s.url;
  let articles = [], status = 'ok', error = null, seen = 0;

  try {
    let html;
    if (config.requires_browser) {
      // Imperva-protected or client-rendered — the fetcher renders it in Chromium
      // and solves the challenge. It only runs two browsers at a time and answers
      // 503 when both are busy, so back off and try again rather than dropping
      // the source for the whole hour.
      let last;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const r = await helpers.httpRequest({
            method: 'POST', url: FETCHER, json: true, timeout: 120000,
            body: { url: target, timeout: 60000 },
          });
          html = r.html || '';
          break;
        } catch (e) {
          last = e;
          if (!String(e.message || '').includes('503')) throw e;
          await sleep(5000 + attempt * 3000);
        }
      }
      if (html === undefined) throw last ?? new Error('fetcher unavailable');
    } else {
      html = await helpers.httpRequest({
        method: 'GET', url: target, headers: HEADERS, timeout: 45000,
      });
    }

    const raw = s.method === 'rss' ? parseFeed(html, target) : parseIndex(html, target);
    const all = normalise(raw, { id: s.id, config });

    // Only what this source has not given us before. Index pages repeat their
    // whole contents every hour, so without this the run re-parses roughly 2,500
    // items to find the handful that are actually new.
    const known = new Set(
      Array.isArray(s.known_urls)
        ? s.known_urls
        : JSON.parse(s.known_urls || '[]')
    );
    const unseen = all.filter(a => !known.has(a.url));

    // Where a publication date exists, ignore anything older than the window —
    // archive and "most read" panels otherwise keep reintroducing old stories.
    // Undated items are kept: if the URL is new to us, the item is new to us.
    const cutoff = Date.now() - FRESHNESS_DAYS * 86400000;
    articles = unseen.filter(a => !a.published_at || Date.parse(a.published_at) >= cutoff);

    seen = all.length;
    if (all.length > 0 && articles.length === 0) status = 'ok';   // nothing new is normal
    else if (all.length === 0) status = 'empty';
  } catch (e) {
    status = 'error';
    error = String(e.message || e).slice(0, 500);
  }

  return { json: { source_id: s.id, slug: s.slug, status, error, articles, seen } };
}

// Sequentially, 64 sources take longer than the task timeout — the browser-backed
// ones alone are tens of seconds each. Plain HTTP sources run wide; browser ones
// are held to the fetcher's own limit so they queue here instead of thrashing it.
async function pool(items, size, fn) {
  const results = [];
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) results.push(await fn(queue.shift()));
  }));
  return results;
}

const needsBrowser = s => {
  const c = typeof s.config === 'string' ? JSON.parse(s.config) : (s.config || {});
  return !!c.requires_browser;
};

const [plain, browser] = [sources.filter(s => !needsBrowser(s)), sources.filter(needsBrowser)];
const [a, b] = await Promise.all([pool(plain, 10, fetchOne), pool(browser, 2, fetchOne)]);
return [...a, ...b];
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
          // Carries each source's recently-seen URLs so the fetch step can skip
          // anything already stored instead of re-parsing it every hour and
          // relying on the unique index to reject the duplicate. 120 covers well
          // over one page of any index we read.
          query: `SELECT s.id, s.slug, s.name, s.url, s.method::text AS method, s.config,
       coalesce(k.urls, '[]'::json) AS known_urls
FROM sources s
LEFT JOIN LATERAL (
  SELECT json_agg(u.url) AS urls
  FROM (SELECT url FROM articles WHERE source_id = s.id ORDER BY fetched_at DESC LIMIT 120) u
) k ON true
WHERE s.active
ORDER BY s.id`,
          options: {},
        },
      },
      {
        id: 'fetch', name: 'Fetch and parse', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(140, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: INGEST_CODE },
      },
      {
        id: 'split', name: 'Collect articles', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(360, 0),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `
// One item carrying every article as JSON. Passing them individually would mean
// one round-trip per article, and n8n's queryReplacement splits on commas — so
// any article title containing a comma shifts every following parameter.
const articles = [];
for (const item of $input.all()) {
  for (const a of item.json.articles) articles.push(a);
}
// Same URL can surface from two sources in one run; the database unique index
// would reject the whole statement rather than the row.
const seen = new Set();
const unique = articles.filter(a => !seen.has(a.url) && seen.add(a.url));
return [{ json: { payload: JSON.stringify(unique), count: unique.length } }];
`,
        },
      },
      {
        id: 'insert', name: 'Insert articles', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(580, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // ON CONFLICT makes the run idempotent — the same article still sitting
          // on an index page an hour later is not a new article.
          query: `INSERT INTO articles (source_id, url, title, author, published_at, summary_raw, content_hash)
SELECT source_id, url, title, author, published_at, summary_raw, content_hash
FROM json_to_recordset($1::json) AS x(
  source_id int, url text, title text, author text,
  published_at timestamptz, summary_raw text, content_hash text)
ON CONFLICT (url) DO NOTHING`,
          options: { queryReplacement: '={{ $json.payload }}' },
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
          { node: 'Collect articles', type: 'main', index: 0 },
          { node: 'Collect statuses', type: 'main', index: 0 },
        ]],
      },
      'Collect articles': { main: [[{ node: 'Insert articles', type: 'main', index: 0 }]] },
      'Collect statuses': { main: [[{ node: 'Record source health', type: 'main', index: 0 }]] },
    },
  };
}

// ─── Workflow 2: Article Analysis ────────────────────────────────────────────

// Ranking is what makes the sheet readable: 68 sources produce far more than
// anyone wants at 5am, so each article gets a relevance score and the report
// takes the top of each section.
const ANALYSIS_PROMPT = `You are briefing an Australian energy and sustainability consultant.
They advise on energy efficiency, building performance, renewables, and the regulatory
environment across Australia, with Victoria as their main market.

For each article below, return a JSON object with:
  id               the article id, unchanged
  summary          two sentences, plain English, what happened and why it matters to them
  relevance_score  0-100. Score high for Australian regulatory change, funding and grant
                   programs, energy efficiency and building performance, Victorian schemes
                   (VEU, Solar Victoria, SEC), and market rule changes. Score low for
                   overseas consumer news, corporate PR, and anything already routine.
  topics           up to 4 short lowercase tags
  entities         named organisations, schemes or people mentioned

Return ONLY a JSON array, no markdown fence, no commentary.

ARTICLES:
`;

function articleAnalysisWorkflow() {
  return {
    name: 'BEXT — Article Analysis',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'trigger', name: 'Every 30 minutes', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-320, 0),
        parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } },
      },
      {
        id: 'load', name: 'Load unanalysed', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-100, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // Batched at 40 to stay inside the free tier's rate limit and keep any
          // single model call small enough to stay coherent.
          query: `SELECT a.id, a.title, a.summary_raw, s.name AS source_name, s.category
FROM articles a
JOIN sources s ON s.id = a.source_id
LEFT JOIN article_analysis an ON an.article_id = a.id
WHERE an.article_id IS NULL
ORDER BY a.fetched_at DESC
LIMIT 40`,
          options: {},
        },
      },
      {
        id: 'analyse', name: 'Score with Gemini', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(140, 0),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `
const rows = $input.all().map(i => i.json);
if (rows.length === 0) return [];

const MODEL = 'gemini-3.6-flash';
const KEY = $env.GEMINI_API_KEY;
const PROMPT = ${JSON.stringify(ANALYSIS_PROMPT)};

const payload = rows.map(r => ({
  id: r.id,
  source: r.source_name,
  category: r.category,
  title: r.title,
  excerpt: (r.summary_raw || '').slice(0, 600),
}));

// Gemini drops the connection often enough that a single attempt is not
// viable — every 30-minute run failed for five days straight on ECONNRESET,
// each one abandoning a whole batch. Retry the transient classes only:
// socket resets, timeouts, 429 and 5xx. A 400 or a bad key is not transient,
// so it still fails immediately rather than burning four minutes first.
const TRANSIENT = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network|aborted/i;
const isRetryable = (e) => {
  const status = e?.statusCode ?? e?.response?.statusCode;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return !status && TRANSIENT.test(String(e?.message || e?.code || ''));
};

let res, lastErr;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    res = await this.helpers.httpRequest({
      method: 'POST',
      url: \`https://generativelanguage.googleapis.com/v1beta/models/\${MODEL}:generateContent?key=\${KEY}\`,
      json: true,
      timeout: 120000,
      body: {
        contents: [{ parts: [{ text: PROMPT + JSON.stringify(payload, null, 1) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      },
    });
    break;
  } catch (e) {
    lastErr = e;
    if (attempt === 4 || !isRetryable(e)) throw e;
    // 2s, 8s, 20s — well inside the 900s task timeout and the 30-minute cadence.
    await new Promise(r => setTimeout(r, [2000, 8000, 20000][attempt - 1]));
  }
}
if (!res) throw lastErr;

const text = res?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
let parsed;
try { parsed = JSON.parse(text); }
catch { throw new Error('Gemini returned unparseable JSON: ' + text.slice(0, 300)); }

const valid = new Set(rows.map(r => r.id));
const scored = parsed
  .filter(p => valid.has(p.id))
  .map(p => ({
    article_id: p.id,
    summary: String(p.summary ?? '').slice(0, 2000),
    relevance_score: Math.max(0, Math.min(100, Number(p.relevance_score) || 0)),
    topics: (Array.isArray(p.topics) ? p.topics.slice(0, 4) : []).join('|'),
    entities: (Array.isArray(p.entities) ? p.entities.slice(0, 10) : []).join('|'),
    model: MODEL,
  }));

// One item carrying the whole batch as JSON. Passing rows individually meant
// n8n's queryReplacement split them on commas, and summaries are full of commas —
// which pushed prose into the relevance_score integer column and failed the insert.
return [{ json: { payload: JSON.stringify(scored), count: scored.length } }];
`,
        },
      },
      {
        id: 'save', name: 'Save analysis', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(380, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          query: `INSERT INTO article_analysis (article_id, summary, relevance_score, topics, entities, model)
-- nullif turns an empty list into NULL, and string_to_array(NULL) is NULL, which
-- both array columns reject. An article with no named entities is normal, so fall
-- back to an empty array rather than failing the whole batch.
SELECT article_id, summary, relevance_score,
       coalesce(string_to_array(nullif(topics, ''), '|'), '{}'),
       coalesce(string_to_array(nullif(entities, ''), '|'), '{}'),
       model
FROM json_to_recordset($1::json)
  AS x(article_id bigint, summary text, relevance_score int,
       topics text, entities text, model text)
ON CONFLICT (article_id) DO NOTHING`,
          options: { queryReplacement: '={{ $json.payload }}' },
        },
      },
    ],
    connections: {
      'Every 30 minutes': { main: [[{ node: 'Load unanalysed', type: 'main', index: 0 }]] },
      'Load unanalysed': { main: [[{ node: 'Score with Gemini', type: 'main', index: 0 }]] },
      'Score with Gemini': { main: [[{ node: 'Save analysis', type: 'main', index: 0 }]] },
    },
  };
}

// ─── Workflow 3: Daily Report ────────────────────────────────────────────────

// Section order is the brief's, not ours — the client reads it looking for these
// headings in this sequence.
const REPORT_SECTIONS = [
  'Australian News',
  'International Industry Updates',
  'Industry Updates',
];

// The sheet is generated at 05:00 and covers the whole of the *previous*
// calendar day in Melbourne, not a rolling 24 hours. A rolling window clipped
// the prior day's first five hours and pulled in items from the morning of the
// send, so an article published at 09:00 could land in a sheet dated the day
// before it appeared.
// Everything from that day goes in, whatever it scored. Scoring still runs and
// still orders each section best-first, but it no longer decides membership: a
// >= 40 cut and an eight-per-category cap were together dropping most of the
// day's intake, and the brief asks for the day's coverage, not a shortlist.
// The join to article_analysis is therefore LEFT — an article the scorer has
// not reached yet is still that day's news and still belongs in the sheet.
const REPORT_SELECT = `
WITH win AS (
  SELECT date_trunc('day', now() AT TIME ZONE 'Australia/Melbourne')
           - interval '1 day' AS day_start
)
SELECT a.id, a.url, a.title, a.published_at,
       s.name AS source_name, s.category,
       coalesce(an.summary, '') AS summary,
       an.relevance_score
FROM articles a
JOIN sources s               ON s.id = a.source_id
LEFT JOIN article_analysis an ON an.article_id = a.id
CROSS JOIN win w
-- Only about a quarter of these sources publish a machine-readable date, so
-- fall back to when we first saw the article. Ingest runs hourly, which keeps
-- that within an hour of publication for the sources that omit it.
WHERE (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')
        >= w.day_start
  AND (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')
        <  w.day_start + interval '1 day'
ORDER BY s.category,
         an.relevance_score DESC NULLS LAST,
         a.published_at DESC NULLS LAST`;

function dailyReportWorkflow() {
  return {
    name: 'BEXT — Daily Report',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'trigger', name: 'Daily 05:00 AEST', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-400, 0),
        // Expressed in Australia/Melbourne (workflow timezone), so it follows DST
        // rather than drifting an hour when daylight saving starts.
        parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 5 * * *' }] } },
      },
      {
        id: 'pull', name: 'Top articles, prior day', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-180, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: { operation: 'executeQuery', query: REPORT_SELECT, options: {} },
      },
      {
        id: 'brief', name: 'Hermes writes the brief', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(60, 0),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `
const rows = $input.all().map(i => i.json);
if (rows.length === 0) {
  return [{ json: { empty: true, item_count: 0, sections: [], intro: '' } }];
}

// Group into the brief's section order.
const ORDER = ${JSON.stringify(REPORT_SECTIONS)};
const sections = ORDER
  .map(name => ({ name, items: rows.filter(r => r.category === name) }))
  .filter(s => s.items.length > 0);

// One Hermes call for the editorial intro. Deliberately one call, not one per
// article — at ~7.5 tokens/sec on this VPS, per-article calls would take the
// report past its 05:00 send window.
let intro = '';
try {
  const headlines = rows.slice(0, 15)
    .map(r => \`- [\${r.relevance_score ?? '—'}] \${r.title} (\${r.source_name})\`).join('\\n');
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://ollama:11434/api/generate',
    json: true,
    timeout: 180000,
    body: {
      model: 'hermes3:8b',
      stream: false,
      // 220 cut the intro off mid-sentence in testing; 3 sentences of prose needs
      // more headroom than the token count suggests.
      options: { temperature: 0.3, num_predict: 360 },
      prompt: \`You brief an Australian energy and sustainability consultant each morning.
Write 2-3 sentences naming what actually matters in today's items and why — regulatory
change, funding, and Victorian schemes matter most. No greeting, no sign-off, no bullet
points, no markdown. Plain prose only.

TODAY'S ITEMS:
\${headlines}\`,
    },
  });
  intro = String(res?.response ?? '').trim();
} catch (e) {
  // A slow or unavailable model must not stop the report going out.
  intro = '';
}

return [{ json: { empty: false, item_count: rows.length, sections, intro,
                  generated_by: intro ? 'hermes3:8b' : 'none' } }];
`,
        },
      },
      {
        id: 'render', name: 'Render HTML', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(280, 0),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `
const d = $input.first().json;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
// The sheet goes out at 05:00 covering the day before, so the heading and the
// subject line name the day being reported on, not the morning it was sent.
// Dating it "Saturday" when every item is from Friday reads as a stale report.
const coverage = new Date(Date.now() - 86400000).toLocaleDateString('en-AU',
  { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Australia/Melbourne' });

// Inline styles throughout — Outlook and Gmail strip <style> blocks.
const body = d.empty
  ? '<p style="color:#6b7280">No qualifying articles published on this day.</p>'
  : d.sections.map(sec => \`
      <h2 style="font:600 15px/1.3 Arial,sans-serif;color:#111827;margin:28px 0 10px;
                 padding-bottom:6px;border-bottom:2px solid #14b8a6">\${esc(sec.name)}</h2>
      \` + sec.items.map(a => \`
        <div style="margin:0 0 16px">
          <a href="\${esc(a.url)}" style="font:600 14px/1.4 Arial,sans-serif;color:#0f766e;
             text-decoration:none">\${esc(a.title)}</a>
          <div style="font:11px/1.4 Arial,sans-serif;color:#9ca3af;margin:3px 0 4px">
            \${esc(a.source_name)} · \${a.relevance_score == null
              ? 'not yet scored' : 'relevance ' + a.relevance_score}
          </div>
          \${a.summary
            ? \`<div style="font:13px/1.5 Arial,sans-serif;color:#374151">\${esc(a.summary)}</div>\`
            : ''}
        </div>\`).join('')
    ).join('');

const html = \`<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6">
<div style="max-width:680px;margin:0 auto;background:#fff;padding:28px 32px">
  <div style="font:11px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#9ca3af">
    BEXT Consultancy · Industry Daily
  </div>
  <h1 style="font:600 20px/1.3 Arial,sans-serif;color:#111827;margin:6px 0 2px">\${coverage}</h1>
  <div style="font:12px/1.4 Arial,sans-serif;color:#9ca3af;margin-bottom:20px">
    \${d.item_count} items across \${d.sections.length} sections
  </div>
  \${d.intro ? \`<div style="background:#f0fdfa;border-left:3px solid #14b8a6;padding:12px 14px;
       font:13px/1.6 Arial,sans-serif;color:#134e4a;margin-bottom:8px">\${esc(d.intro)}</div>\` : ''}
  \${body}
  <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;
              font:11px/1.5 Arial,sans-serif;color:#9ca3af">
    Generated automatically from \${d.item_count} scored articles.
    Grants / Funding and LinkedIn sections are covered in a separate report.
  </div>
</div></body></html>\`;

const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
// REPORT_RECIPIENT is a comma-separated list — the sheet goes to the consultant
// and to the client, not to one hardcoded address. Falls back to the sender so a
// misconfigured list can never send the report to nobody.
const recipient = (($env.REPORT_RECIPIENT || '').split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .join(', ')) || $env.REPORT_SENDER;
// Built here and kept free of commas: queryReplacement splits on them, which
// truncated this to a bare item count the first time round.
const detail = \`Sent \${d.item_count} items to \${recipient} | intro by \${d.generated_by}\`;
// The ids of exactly what went into the sheet, so report_items can record it.
const items = d.sections.flatMap(sec =>
  sec.items.map((it, i) => ({
    article_id: it.id, category: sec.name, rank: i + 1,
    blurb: String(it.summary || '').slice(0, 500),
  }))
);
return [{ json: { html, items, subject: 'BEXT Industry Daily — ' + coverage,
                  report_date: date, item_count: d.item_count,
                  recipient, detail, generated_by: d.generated_by } }];
`,
        },
      },
      {
        id: 'save', name: 'Save report', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(500, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // Written before the send so a delivery failure still leaves the rendered
          // report on record — the dashboard can show what would have gone out.
          // One JSON parameter rather than positional ones: n8n splits
          // queryReplacement on commas, and rendered HTML is full of them.
          query: `INSERT INTO reports (report_date, status, html, recipient, item_count, generated_at)
SELECT report_date::date, 'rendered', html, recipient, item_count, now()
FROM json_to_recordset($1::json)
  AS x(report_date text, html text, recipient text, item_count int)
ON CONFLICT (report_date) DO UPDATE SET
  status = 'rendered', html = EXCLUDED.html, recipient = EXCLUDED.recipient,
  item_count = EXCLUDED.item_count, generated_at = now(), error = NULL`,
          options: {
            queryReplacement:
              '={{ JSON.stringify([{ report_date: $json.report_date, html: $json.html, recipient: $json.recipient, item_count: $json.item_count }]) }}',
          },
        },
      },
      {
        id: 'items', name: 'Record items sent', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(520, 180),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // Which articles went out, not just how many. Without this there is no
          // record of what the client actually received.
          query: `INSERT INTO report_items (report_id, article_id, category, rank, blurb)
SELECT r.id, x.article_id, x.category, x.rank, x.blurb
FROM json_to_recordset($1::json)
  AS x(article_id bigint, category text, rank int, blurb text)
CROSS JOIN LATERAL (
  SELECT id FROM reports WHERE report_date = (now() AT TIME ZONE 'Australia/Melbourne')::date
) r
ON CONFLICT (report_id, article_id) DO NOTHING`,
          options: {
            queryReplacement: '={{ JSON.stringify($("Render HTML").first().json.items) }}',
          },
        },
      },
      {
        id: 'send', name: 'Send via SMTP', type: 'n8n-nodes-base.emailSend',
        typeVersion: 2.1, position: pos(720, 0),
        credentials: { smtp: { id: SMTP_CRED, name: 'BEXT SMTP' } },
        parameters: {
          fromEmail: '={{ $env.REPORT_SENDER }}',
          toEmail: '={{ $("Render HTML").first().json.recipient }}',
          subject: '={{ $("Render HTML").first().json.subject }}',
          emailFormat: 'html',
          html: '={{ $("Render HTML").first().json.html }}',
          options: {},
        },
      },
      {
        id: 'mark', name: 'Mark sent', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(940, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          query: `UPDATE reports SET status = 'sent', sent_at = now()
WHERE report_date = $1::date`,
          options: { queryReplacement: '={{ $("Render HTML").first().json.report_date }}' },
        },
      },
      {
        id: 'health', name: 'Record result', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(1160, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          query: `INSERT INTO integration_health (service, status, detail)
VALUES ('daily_report', 'up', $1)`,
          options: { queryReplacement: '={{ $("Render HTML").first().json.detail }}' },
        },
      },
    ],
    connections: {
      'Daily 05:00 AEST': { main: [[{ node: 'Top articles, prior day', type: 'main', index: 0 }]] },
      'Top articles, prior day': { main: [[{ node: 'Hermes writes the brief', type: 'main', index: 0 }]] },
      'Hermes writes the brief': { main: [[{ node: 'Render HTML', type: 'main', index: 0 }]] },
      'Render HTML': { main: [[{ node: 'Save report', type: 'main', index: 0 }]] },
      'Save report': { main: [[{ node: 'Record items sent', type: 'main', index: 0 }]] },
      'Record items sent': { main: [[{ node: 'Send via SMTP', type: 'main', index: 0 }]] },
      'Send via SMTP': { main: [[{ node: 'Mark sent', type: 'main', index: 0 }]] },
      'Mark sent': { main: [[{ node: 'Record result', type: 'main', index: 0 }]] },
    },
  };
}

// ─── Workflow 4: Graph Health ────────────────────────────────────────────────

// graph/verify.js is the same four checks run by hand from a laptop. This is the
// unattended copy: the Brief B workflows all depend on the client secret, and a
// secret that expires quietly would otherwise be discovered by a meeting whose
// minutes never arrived. Checked daily, recorded, and mailed only when it breaks.
const GRAPH_HEALTH_CODE = `
const TENANT = $env.MS_TENANT_ID;
const CLIENT = $env.MS_CLIENT_ID;
const SECRET = $env.MS_CLIENT_SECRET;
const UPN    = $env.MS_SENDER_UPN;

if (!TENANT || !CLIENT || !SECRET || !UPN) {
  return [{ json: { ok: false, detail: 'MS_* not present in the container environment',
                    failures: ['configuration'] } }];
}

const http = this.helpers.httpRequest;
const results = [];
async function step(name, fn) {
  try { results.push({ name, ok: true, detail: await fn() }); }
  catch (e) { results.push({ name, ok: false, detail: String(e.message || e).slice(0, 300) }); }
}

let token = null;
await step('token', async () => {
  const r = await http({
    method: 'POST',
    url: \`https://login.microsoftonline.com/\${TENANT}/oauth2/v2.0/token\`,
    json: true, timeout: 30000,
    body: new URLSearchParams({
      client_id: CLIENT, client_secret: SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  token = r.access_token;
  return \`expires in \${Math.round(r.expires_in / 60)} min\`;
});

// Without a token the rest cannot be attempted, and reporting three further
// failures would misrepresent one broken secret as four broken permissions.
if (token) {
  const graph = (p) => http({
    method: 'GET', url: 'https://graph.microsoft.com/v1.0' + p,
    json: true, timeout: 30000, headers: { Authorization: 'Bearer ' + token },
  });

  await step('user lookup (User.Read.All)', async () => {
    const u = await graph('/users/' + encodeURIComponent(UPN));
    return u.displayName;
  });

  await step('sites (Sites.ReadWrite.All)', async () => {
    const s = await graph('/sites?search=');
    return \`\${s.value?.length ?? 0} site(s) visible\`;
  });

  // The folders the meeting workflow writes into. Their absence is the failure
  // mode that would otherwise surface as a successful run filing nothing.
  await step('meeting folders', async () => {
    const site = await graph('/sites/bextconsultancy.sharepoint.com:/sites/BEXTHQ');
    const drives = await graph('/sites/' + site.id + '/drives');
    const drive = drives.value.find(d => d.name === 'Documents') || drives.value[0];
    const want = ['Templates', 'Meeting Transcripts', 'Meeting Minutes'];
    const found = [];
    for (const name of want) {
      try {
        await graph('/drives/' + drive.id + '/root:/' +
          encodeURI('API Automation Folder/' + name));
        found.push(name);
      } catch { /* recorded by omission below */ }
    }
    if (found.length !== want.length) {
      throw new Error('missing: ' + want.filter(w => !found.includes(w)).join(' / '));
    }
    return found.length + ' of ' + want.length + ' present';
  });
}

const failures = results.filter(r => !r.ok);
// Commas are deliberately absent: n8n's queryReplacement splits on them, which
// would shift this string into the wrong column.
const detail = results.map(r => \`\${r.ok ? 'ok' : 'FAIL'} \${r.name}: \${r.detail}\`).join(' | ');
return [{ json: { ok: failures.length === 0, detail,
                  failures: failures.map(f => f.name) } }];
`;

function graphHealthWorkflow() {
  return {
    name: 'BEXT — Graph Health',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'trigger', name: 'Daily 06:00', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-320, 0),
        // An hour after the daily report, so a secret that expired overnight is
        // reported alongside the send it would have broken.
        parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 6 * * *' }] } },
      },
      {
        id: 'check', name: 'Check Graph', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(-80, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: GRAPH_HEALTH_CODE },
      },
      {
        id: 'record', name: 'Record health', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(160, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          query: `INSERT INTO integration_health (service, status, detail)
SELECT 'microsoft_graph', x.status, x.detail
FROM json_to_recordset($1::json) AS x(status text, detail text)`,
          options: {
            queryReplacement:
              '={{ JSON.stringify([{ status: $json.ok ? "up" : "down", detail: $json.detail }]) }}',
          },
        },
      },
      {
        id: 'gate', name: 'Only when broken', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: pos(400, 0),
        parameters: {
          conditions: {
            options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
            combinator: 'and',
            conditions: [{
              id: 'failed',
              operator: { type: 'boolean', operation: 'false', singleValue: true },
              leftValue: '={{ $("Check Graph").first().json.ok }}',
              rightValue: '',
            }],
          },
          options: {},
        },
      },
      {
        id: 'alert', name: 'Alert by email', type: 'n8n-nodes-base.emailSend',
        typeVersion: 2.1, position: pos(640, -80),
        credentials: { smtp: { id: SMTP_CRED, name: 'BEXT SMTP' } },
        parameters: {
          fromEmail: '={{ $env.REPORT_SENDER }}',
          // To the operator, not the client distribution list — this is an
          // internal fault, and the client has no action to take on it.
          toEmail: '={{ $env.MS_SENDER_UPN }}',
          subject: '=BEXT — Microsoft Graph check failed ({{ $("Check Graph").first().json.failures.join(", ") }})',
          emailFormat: 'text',
          text: `={{ "The daily Graph check failed.\\n\\n" + $("Check Graph").first().json.detail + "\\n\\nMeeting minutes and document filing stay stopped until this is fixed.\\nTroubleshooting: graph/app-registration.md" }}`,
          options: {},
        },
      },
    ],
    connections: {
      'Daily 06:00': { main: [[{ node: 'Check Graph', type: 'main', index: 0 }]] },
      'Check Graph': { main: [[{ node: 'Record health', type: 'main', index: 0 }]] },
      'Record health': { main: [[{ node: 'Only when broken', type: 'main', index: 0 }]] },
      'Only when broken': { main: [[{ node: 'Alert by email', type: 'main', index: 0 }], []] },
    },
  };
}

// ─── Workflow 5: Meeting Intake ──────────────────────────────────────────────

// Brief B review area 3, the client's stated highest priority: record a meeting,
// and minutes, decisions, action items and a follow-up draft appear without
// anyone taking a note. The consultant reviews; nothing sends itself.
const MINUTES_PROMPT = `You are writing the minutes of a meeting for an Australian energy and
sustainability consultancy, from the Teams transcript below.

Return a JSON object with exactly these keys:
  summary      3-5 sentences of prose. What was discussed and what it means. No bullet points.
  attendees    array of the speaker names appearing in the transcript
  decisions    array of strings. Decisions actually made. Omit anything merely discussed.
  actions      array of { task, owner, due }. owner is a person named in the transcript, or
               "Unassigned". due is a plain date like "22 August" or "" if none was stated.
  followups    array of strings. Things to raise or check later that are not yet actions.

Write in Australian English. Be specific: name the schemes, clients and figures that were
mentioned. If a section has nothing in it, return an empty array rather than inventing content.

Return ONLY the JSON object, no markdown fence, no commentary.

TRANSCRIPT:
`;

const MEETING_CODE = `
const TENANT = $env.MS_TENANT_ID, CLIENT = $env.MS_CLIENT_ID;
const SECRET = $env.MS_CLIENT_SECRET, UPN = $env.MS_SENDER_UPN;
const GEMINI = $env.GEMINI_API_KEY;
const http = this.helpers.httpRequest;

const SITE = 'bextconsultancy.sharepoint.com:/sites/BEXTHQ';
const BASE = 'API Automation Folder';
const TEMPLATE = BASE + '/Templates/Minutes Template.docx';
const MODEL = 'gemini-3.6-flash';

// Meetings already minuted, passed down from the database. Re-filing a meeting
// every fifteen minutes would bury the reviewer in duplicates.
const done = new Set($input.all().map(i => i.json.meeting_id).filter(Boolean));

const auth = await http({
  method: 'POST',
  url: \`https://login.microsoftonline.com/\${TENANT}/oauth2/v2.0/token\`,
  json: true, timeout: 30000,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CLIENT, client_secret: SECRET,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  }).toString(),
});
const TOKEN = auth.access_token;
const G = 'https://graph.microsoft.com/v1.0';
const graph = (path, opts = {}) => http({
  url: G + path, json: true, timeout: 60000,
  headers: { Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) },
  ...opts,
});

// The meetings API rejects a UPN and requires the object id, unlike mail and
// calendar which accept either.
const me = await graph('/users/' + encodeURIComponent(UPN) + '?$select=id,displayName');

// The drive is resolved once, by id. Addressing a library through the compound
// /sites/host:/sites/name:/drive/root:/path form returns 400 — the site path and
// the item path cannot both be relative in one URL.
const site = await graph('/sites/' + SITE);
const drives = await graph('/sites/' + site.id + '/drives');
const DRIVE = (drives.value.find(d => d.name === 'Documents') || drives.value[0]).id;

// Meetings that finished in the last day. Wider than the fifteen-minute cadence
// on purpose: Teams takes minutes to publish a transcript after a meeting ends,
// and a run that failed should pick the meeting up next time rather than lose it.
const since = new Date(Date.now() - 86400000).toISOString();
const until = new Date(Date.now() + 60000).toISOString();
const events = await graph('/users/' + me.id + '/calendar/events'
  + '?$select=subject,start,end,organizer,isOnlineMeeting,onlineMeeting'
  + '&$filter=' + encodeURIComponent(\`end/dateTime ge '\${since}' and end/dateTime le '\${until}'\`)
  + '&$top=50');

const out = [];

for (const ev of (events.value || [])) {
  if (!ev.isOnlineMeeting || !ev.onlineMeeting?.joinUrl) continue;

  let meeting, transcripts;
  try {
    const found = await graph('/users/' + me.id + '/onlineMeetings?$filter='
      + encodeURIComponent(\`JoinWebUrl eq '\${ev.onlineMeeting.joinUrl}'\`));
    meeting = found.value?.[0];
    if (!meeting || done.has(meeting.id)) continue;
    transcripts = await graph('/users/' + me.id + '/onlineMeetings/' + meeting.id + '/transcripts');
  } catch (e) {
    // A meeting we cannot read is not a run failure — an external organiser
    // outside the access policy is a normal thing to skip.
    continue;
  }
  if (!(transcripts.value || []).length) continue;

  try {
    // --- transcript ---------------------------------------------------------
    const vtt = await http({
      method: 'GET',
      url: G + '/users/' + me.id + '/onlineMeetings/' + meeting.id
         + '/transcripts/' + transcripts.value[0].id + '/content?$format=text/vtt',
      headers: { Authorization: 'Bearer ' + TOKEN }, timeout: 120000,
    });
    const text = typeof vtt === 'string' ? vtt : String(vtt);
    if (text.trim().length < 50) continue;   // a transcript of nothing said

    // --- extraction ---------------------------------------------------------
    // Same transient-failure handling as the article scorer: Gemini drops
    // connections often enough that one attempt loses a meeting outright.
    const TRANSIENT = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network|aborted/i;
    let res, lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        res = await http({
          method: 'POST',
          url: \`https://generativelanguage.googleapis.com/v1beta/models/\${MODEL}:generateContent?key=\${GEMINI}\`,
          json: true, timeout: 180000,
          body: {
            contents: [{ parts: [{ text: ${JSON.stringify(MINUTES_PROMPT)} + text.slice(0, 200000) }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
          },
        });
        break;
      } catch (e) {
        lastErr = e;
        const st = e?.statusCode ?? e?.response?.statusCode;
        const retryable = st === 429 || (st >= 500 && st < 600)
          || (!st && TRANSIENT.test(String(e?.message || e?.code || '')));
        if (attempt === 4 || !retryable) throw e;
        await new Promise(r => setTimeout(r, [2000, 8000, 20000][attempt - 1]));
      }
    }
    if (!res) throw lastErr;

    const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    let x;
    try { x = JSON.parse(raw); }
    catch { throw new Error('Gemini returned unparseable JSON: ' + raw.slice(0, 200)); }

    const when = new Date(ev.end?.dateTime + 'Z');
    const data = {
      subject: ev.subject || 'Meeting',
      date: when.toLocaleDateString('en-AU',
        { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Melbourne' }),
      organiser: ev.organizer?.emailAddress?.name || '',
      attendees: (x.attendees || []).join(', '),
      summary: String(x.summary || ''),
      decisions: (x.decisions || []).map(String),
      actions: (x.actions || []).map(a => ({
        task: String(a.task || ''), owner: String(a.owner || 'Unassigned'), due: String(a.due || ''),
      })),
      followups: (x.followups || []).map(String),
    };

    // --- document -----------------------------------------------------------
    const tpl = await http({
      method: 'GET',
      url: G + '/drives/' + DRIVE + '/root:/' + encodeURI(TEMPLATE) + ':/content',
      headers: { Authorization: 'Bearer ' + TOKEN }, encoding: 'arraybuffer', timeout: 60000,
    });
    const docx = await http({
      method: 'POST', url: 'http://fetcher:8080/render-docx',
      json: true, timeout: 60000, encoding: 'arraybuffer',
      body: { template: Buffer.from(tpl).toString('base64'), data },
    });

    // --- filing -------------------------------------------------------------
    // Date first so the folder sorts chronologically without a custom view, and
    // colons stripped because SharePoint rejects them in a file name.
    const stamp = when.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
    const safe = (ev.subject || 'Meeting').replace(/[\\\\/:*?"<>|]/g, '-').slice(0, 80);

    const put = async (path, body, type) => http({
      method: 'PUT', url: G + '/drives/' + DRIVE + '/root:/' + encodeURI(path) + ':/content',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': type },
      body, json: false, timeout: 120000,
    });

    await put(\`\${BASE}/Meeting Transcripts/\${stamp} \${safe}.vtt\`, text, 'text/vtt');
    await put(\`\${BASE}/Meeting Minutes/\${stamp} \${safe} — Minutes.docx\`, Buffer.from(docx),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    // --- follow-up draft ----------------------------------------------------
    // Created as a draft and never sent. The brief is explicit that nothing
    // leaves without review, and a draft enforces that structurally rather than
    // by convention.
    const lines = [
      \`Thanks all for today's discussion on \${data.subject}.\`, '',
      data.summary, '',
      data.decisions.length ? 'Decisions:' : '',
      ...data.decisions.map(d => '  - ' + d),
      data.actions.length ? '' : '', data.actions.length ? 'Actions:' : '',
      ...data.actions.map(a => \`  - \${a.task} (\${a.owner}\${a.due ? ', due ' + a.due : ''})\`),
      '', 'Minutes are attached to the meeting record in SharePoint.', '', 'Regards',
    ].filter(l => l !== null);

    const draft = await graph('/users/' + me.id + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        subject: \`\${data.subject} — draft minutes and actions\`,
        body: { contentType: 'Text', content: lines.join('\\n') },
        toRecipients: ev.organizer?.emailAddress?.address
          ? [{ emailAddress: { address: ev.organizer.emailAddress.address } }] : [],
      },
    });

    out.push({ json: {
      meeting_id: meeting.id,
      subject: data.subject,
      organiser_upn: ev.organizer?.emailAddress?.address || '',
      started_at: ev.start?.dateTime ? ev.start.dateTime + 'Z' : null,
      ended_at: ev.end?.dateTime ? ev.end.dateTime + 'Z' : null,
      attendees: x.attendees || [],
      status: 'drafted',
      transcript_path: \`\${BASE}/Meeting Transcripts/\${stamp} \${safe}.vtt\`,
      minutes_path: \`\${BASE}/Meeting Minutes/\${stamp} \${safe} — Minutes.docx\`,
      draft_message_id: draft.id,
      extracted: x,
      model: MODEL,
      error: null,
    } });
  } catch (e) {
    // Recorded rather than thrown: one unreadable meeting must not stop the
    // others, and a failure with no record is a meeting silently lost.
    out.push({ json: {
      meeting_id: meeting.id, subject: ev.subject || '', status: 'failed',
      organiser_upn: ev.organizer?.emailAddress?.address || '',
      started_at: null, ended_at: null, attendees: [], transcript_path: null,
      minutes_path: null, draft_message_id: null, extracted: null, model: MODEL,
      error: String(e.message || e).slice(0, 500),
    } });
  }
}

if (!out.length) return [];
return [{ json: { payload: JSON.stringify(out.map(o => o.json)), count: out.length } }];
`;

function meetingIntakeWorkflow() {
  return {
    name: 'BEXT — Meeting Intake',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'trigger', name: 'Every 15 minutes', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-380, 0),
        // Polling rather than a webhook: this n8n is Community and reachable
        // publicly only through traefik, and a fifteen-minute lag on minutes is
        // invisible against the time Teams itself takes to publish a transcript.
        parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } },
      },
      {
        id: 'seen', name: 'Load processed meetings', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-160, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // Only the window the code looks at. The table grows forever; the
          // exclusion list should not.
          query: `SELECT meeting_id FROM meeting_minutes
WHERE created_at > now() - interval '3 days'`,
          options: {},
        },
      },
      {
        id: 'process', name: 'Transcribe and draft', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(80, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: MEETING_CODE },
      },
      {
        id: 'record', name: 'Record minutes', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(320, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // One JSON parameter rather than positional ones: queryReplacement
          // splits on commas, and every one of these fields is full of them.
          query: `INSERT INTO meeting_minutes
  (meeting_id, subject, organiser_upn, started_at, ended_at, attendees, status,
   transcript_path, minutes_path, draft_message_id, extracted, model, error)
SELECT meeting_id, subject, organiser_upn, started_at, ended_at,
       coalesce(attendees, '{}'), status::minutes_status,
       transcript_path, minutes_path, draft_message_id, extracted, model, error
FROM json_to_recordset($1::json) AS x(
  meeting_id text, subject text, organiser_upn text,
  started_at timestamptz, ended_at timestamptz, attendees text[], status text,
  transcript_path text, minutes_path text, draft_message_id text,
  extracted jsonb, model text, error text)
ON CONFLICT (meeting_id) DO UPDATE SET
  status = EXCLUDED.status, minutes_path = EXCLUDED.minutes_path,
  draft_message_id = EXCLUDED.draft_message_id, extracted = EXCLUDED.extracted,
  error = EXCLUDED.error, updated_at = now()`,
          options: { queryReplacement: '={{ $json.payload }}' },
        },
      },
    ],
    connections: {
      'Every 15 minutes': { main: [[{ node: 'Load processed meetings', type: 'main', index: 0 }]] },
      'Load processed meetings': { main: [[{ node: 'Transcribe and draft', type: 'main', index: 0 }]] },
      'Transcribe and draft': { main: [[{ node: 'Record minutes', type: 'main', index: 0 }]] },
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
  await deploy(articleAnalysisWorkflow());
  if (!SMTP_CRED) console.error('N8N_SMTP_CREDENTIAL_ID not set — skipping the daily report and Graph health.');
  else {
    await deploy(dailyReportWorkflow());
    await deploy(graphHealthWorkflow());
    await deploy(meetingIntakeWorkflow());
  }
})();
