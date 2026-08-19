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
const WEBHOOK_CRED = process.env.N8N_WEBHOOK_CREDENTIAL_ID;
const TAG = 'BEXT Consultancy';

// The tested parser, minus its CommonJS export line, for embedding in a Code node.
const INGEST_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'ingest.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '')
  .replace(/^const crypto = require\('crypto'\);$/m, '');

// The tested document writer, minus its export line, for embedding in a Code node.
const DOCX_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'docx.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '');

// The tested card builder, minus its export line, for embedding in a Code node.
// The client's follow-up email format, embedded the same way as the card builder.
const EMAIL_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'meeting-email.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '');

const CARD_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'meeting-card.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '');

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
SELECT a.id, a.url, a.title,
       -- What the sheet prints beside each item. published_at where the source
       -- gives one, otherwise when we first saw it; date_is_exact says which,
       -- so the sheet never presents a fetch time as a publication date.
       coalesce(a.published_at, a.fetched_at) AS shown_at,
       (a.published_at IS NOT NULL)           AS date_is_exact,
       s.name AS source_name, s.category,
       coalesce(an.summary, '') AS summary,
       an.relevance_score,
       -- Carried on every row so the footer can state coverage without a
       -- second query: how many sources are being pulled right now.
       (SELECT count(*) FROM sources WHERE active) AS sources_monitored
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
  // No rows means no carrier for the source counts, so they are left at 0 and
  // the template omits the coverage line rather than claiming "0 of 0".
  return [{ json: { empty: true, item_count: 0, sections: [], intro: '',
                    sources_monitored: 0, sources_contributing: 0 } }];
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

// How many sources are being pulled, and how many actually published on the
// day. Every row carries sources_monitored, so read it off the first.
const sourcesMonitored = Number(rows[0].sources_monitored) || 0;
const sourcesContributing = new Set(rows.map(r => r.source_name)).size;

return [{ json: { empty: false, item_count: rows.length, sections, intro,
                  sources_monitored: sourcesMonitored,
                  sources_contributing: sourcesContributing,
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

// The date each item carries, in Melbourne time. Where the source published no
// machine-readable date we show when we picked it up and say so, rather than
// passing a fetch time off as a publication date.
const itemDate = (a) => {
  if (!a.shown_at) return 'date unavailable';
  const d = new Date(a.shown_at);
  if (isNaN(d)) return 'date unavailable';
  const s = d.toLocaleDateString('en-AU',
    { day:'numeric', month:'short', year:'numeric', timeZone:'Australia/Melbourne' });
  return a.date_is_exact ? s : s + ' (picked up)';
};

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
            \${esc(a.source_name)} · \${esc(itemDate(a))}
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
    \${d.item_count} items across \${d.sections.length} sections\${d.sources_monitored
      ? \` · \${d.sources_contributing} of \${d.sources_monitored} sources contributed\` : ''}
  </div>
  \${d.intro ? \`<div style="background:#f0fdfa;border-left:3px solid #14b8a6;padding:12px 14px;
       font:13px/1.6 Arial,sans-serif;color:#134e4a;margin-bottom:8px">\${esc(d.intro)}</div>\` : ''}
  \${body}
  <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;
              font:11px/1.5 Arial,sans-serif;color:#9ca3af">
    \${d.sources_monitored
      ? \`Generated automatically from \${d.sources_monitored} monitored sources; \${d.sources_contributing} published on this day.\`
      : 'Generated automatically.'}
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
            // recipient is stored semicolon-separated, not comma-separated.
            // queryReplacement splits its value on commas, so a two-address list
            // arrives mangled and the dashboard showed one recipient on some days
            // and both on others — which reads as "Brent is not getting the report"
            // when he is. The send itself is unaffected: the SMTP node uses a direct
            // expression, not queryReplacement.
            queryReplacement:
              '={{ JSON.stringify([{ report_date: $json.report_date, html: $json.html, recipient: String($json.recipient).replace(/,\\s*/g, "; "), item_count: $json.item_count }]) }}',
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
// The Code sandbox withholds URLSearchParams the same way it withholds URL.
// Missing it, the token step failed every night with a message that named the
// symbol rather than the cause.
const { URLSearchParams } = require('url');

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
SELECT 'microsoft_graph', x.status::health_status, x.detail
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
const MINUTES_PROMPT = `You are writing the minutes of a recurring weekly program check-in for an
Australian energy and sustainability consultancy, from the Teams transcript below.

Return a JSON object with exactly these keys:

  attendees   array of { name, initials, company }. One entry per distinct speaker. Derive
              initials from the name. Leave company "" unless stated.
  safety      array of { item, detail, owner, due, status }
              status here MUST be exactly Open or Closed — not the project vocabulary below
  projects    array of { project, phase, status, update, next_action, owner, due, network_note }
              status MUST be exactly one of: On Track, Monitor, At Risk, On Hold, Complete
              network_note is the DNSP or network position if one was mentioned, else ""
  finance     array of { item, detail, owner, due, status } — commercial and other business
              status here MUST also be exactly Open or Closed
  actions     array of { title, detail, owner, due, status, closed }
              owner is a person named in the transcript, or "Unassigned" — never guess
              closed is true only if the transcript says it is done
  decisions   array of strings — decisions actually made, not options discussed
  title       a short specific title for this meeting, 4 to 8 words, describing what was
              actually discussed. The calendar subject is often a placeholder like
              "reset test" — do not echo it. Example: "Torquay DNSP delay and switchboard order"
  summary     3-5 sentences of prose for the follow-up email
  next_meeting string, or ""

Rules that matter more than completeness:
  - Do not invent. An empty array is a correct answer for a section not discussed.
  - Never assign an owner who was not named. "Unassigned" is the honest answer.
  - Ignore small talk, greetings and side conversation entirely.
  - Australian English. Keep the speakers' own terms for projects and schemes.

Return ONLY the JSON object, no markdown fence.

TRANSCRIPT:
`;

const MEETING_CODE = `
// The Code sandbox does not expose URLSearchParams as a global, the same way it
// withholds URL. Without this the token request throws "URLSearchParams is not
// defined" on the first line that matters and the whole run dies before it has
// read anything — which is exactly what it did, silently, every fifteen minutes.
const { URLSearchParams } = require('url');

const TENANT = $env.MS_TENANT_ID, CLIENT = $env.MS_CLIENT_ID;
const SECRET = $env.MS_CLIENT_SECRET, UPN = $env.MS_SENDER_UPN;
const GEMINI = $env.GEMINI_API_KEY;
const http = this.helpers.httpRequest;

const SITE = 'bextconsultancy.sharepoint.com:/sites/BEXTHQ';
const BASE = 'API Automation Folder';
const TEMPLATE = BASE + '/Templates/Minutes Template.docx';
const MODEL = 'gemini-3.6-flash';

// The channel is the readable record: one folder per meeting holding the
// transcript, the minutes and the summary, plus PDF renditions for reading.
const CHANNEL_SITE = 'bextconsultancy.sharepoint.com:/sites/bext_transcriptsrecords';
const CHANNEL_BASE = 'Bext Transcripts';
const PROGRAM = 'RACV Property Electrification — Weekly Program Check-in';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WEBHOOK = $env.TEAMS_MEETING_WEBHOOK_URL;

// --- shared document writer, generated from n8n/lib/docx.js — do not edit here ---
${DOCX_SRC}
// --- shared card builder, generated from n8n/lib/meeting-card.js — do not edit here ---
${CARD_SRC}
// --- shared email builder, generated from n8n/lib/meeting-email.js — do not edit here ---
// Wrapped in its own scope: the card builder and the email builder both define
// SUMMARY_MAX, clip and isClosed, and inlining them side by side in one scope is
// a redeclaration error. Isolating here beats renaming things in a file that has
// its own tests and its own reader.
const buildMeetingEmail = (function () {
${EMAIL_SRC}
  return buildMeetingEmail;
})();
// --- end shared code ---

// Meetings already minuted, passed down from the database. Re-filing a meeting
// every fifteen minutes would bury the reviewer in duplicates.
// One input carrying two kinds of row — see the query on the node before this.
const inputRows = $input.all().map(i => i.json);
const done = new Set(
  inputRows.filter(r => r.kind === 'done').map(r => r.a).filter(Boolean));
const PARTICIPANTS = inputRows
  .filter(r => r.kind === 'participant')
  .map(r => ({ name: r.a, company: r.b, email: r.c, aliases: r.d || [] }));

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

// There are eight outbound calls in the per-meeting block and axios reports all of
// them the same way: "Request failed with status code 401". That message names
// neither the endpoint nor the response body, which turned a one-line fault into a
// guessing game. Every risky call goes through this so the recorded error says
// which one, with the status and the first of the body.
// ignoreHttpStatusErrors is an HTTP Request NODE option — the Code node's http
// helper does not honour it, so catching is the only way.
const call = async (label, opts) => {
  try {
    return await http(opts);
  } catch (e) {
    const st = e.statusCode || e.status || (e.response && e.response.status) || '?';
    const b = (e.response && (e.response.body || e.response.data)) || e.message || '';
    throw new Error(label + ' ' + st + ': ' + String(typeof b === 'string' ? b : JSON.stringify(b)).slice(0, 220));
  }
};

// graph() is used a dozen times and, unlabelled, every one of its failures reads
// "Request failed with status code 401" with no hint which endpoint. That cost a
// full debugging cycle: the labelled call() wrappers went on the obvious suspects
// and the real failure turned out to be somewhere graph() was used instead.
const graph = async (path, opts = {}) => {
  try {
    return await graphRaw(path, opts);
  } catch (e) {
    const st = e.statusCode || e.status || (e.response && e.response.status) || '?';
    const b = (e.response && (e.response.body || e.response.data)) || e.message || '';
    const method = (opts.method || 'GET');
    throw new Error('graph ' + method + ' ' + path.split('?')[0] + ' -> ' + st + ': '
      + String(typeof b === 'string' ? b : JSON.stringify(b)).slice(0, 200));
  }
};

// Normalise whatever the HTTP helper hands back for a binary response.
//
// With json: true it parses the body, and a binary payload becomes the JSON
// envelope { type: 'Buffer', data: [ ... ] }. Buffer.from() on that object does
// not fail — it produces the *text* of the envelope, which then gets uploaded
// with a .docx extension. Word opens it and reports "unreadable content", which
// reads as a corrupt template or a SharePoint permissions problem rather than a
// response-parsing one. Every binary body goes through here.
const toBuf = v => {
  if (Buffer.isBuffer(v)) return v;
  if (v && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data);
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (typeof v === 'string') return Buffer.from(v, 'binary');
  return Buffer.from(v);
};

const graphRaw = (path, opts = {}) => {
  const url = G + path;
  const headers = { Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) };

  // opts is spread BEFORE headers, deliberately.
  //
  // The other order — headers first, then ...opts — silently drops Authorization
  // on any call that passes headers of its own. The draft creation passes a
  // Content-Type, so it lost its token and Graph answered 401, while every GET
  // (which passes no headers) kept working. That mismatch is why this read as
  // "Microsoft is rejecting us" for hours: it was our own object spread, not
  // permissions, not licensing, not the n8n HTTP client.
  //
  // headers already merges opts.headers, so putting it last loses nothing.
  return http({
    url: url, json: true, timeout: 60000,
    ...opts,
    headers: headers,
  });
};

// The meetings API rejects a UPN and requires the object id, unlike mail and
// calendar which accept either.
const me = await graph('/users/' + encodeURIComponent(UPN) + '?$select=id,displayName');

// The drive is resolved once, by id. Addressing a library through the compound
// /sites/host:/sites/name:/drive/root:/path form returns 400 — the site path and
// the item path cannot both be relative in one URL.
const site = await graph('/sites/' + SITE);
const drives = await graph('/sites/' + site.id + '/drives');
const DRIVE = (drives.value.find(d => d.name === 'Documents') || drives.value[0]).id;

// Discovery is by transcript, not by calendar. Walking one mailbox's calendar
// missed every meeting somebody else organised — on this tenant that was most of
// them, because Brent books the weekly. getAllTranscripts asks the question we
// actually have ("what has been transcribed?") instead of the one the calendar
// can answer ("what was I invited to?"), and it still returns a meeting whose
// event has since been deleted or declined.
//
// Two traps, both silent:
//   - meetingOrganizerUserId is a required FUNCTION parameter, not a query one.
//     Omit it and Graph answers 400 with a message that reads like a bad URL.
//   - $filter=createdDateTime is ACCEPTED AND IGNORED. Filtering has to happen
//     here, or a full history is reprocessed on every tick.
// Same variable graph/run-meeting-once.js and graph/verify-meeting-access.js read,
// so the manual harness and the scheduled run discover exactly the same meetings.
const ORGANISERS = ($env.MEETING_HOSTS || UPN)
  .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

// Seven days, not one. A day was too tight in practice: the 18 August weekly
// aged out of range while the pipeline was still being repaired, and a meeting
// that falls out of the window is never retried — it needs a manual replay.
// Re-processing costs nothing, because the exclusion list already holds every
// meeting that produced something, so only unprocessed and failed ones return.
const WINDOW_MS = Number($env.MEETING_LOOKBACK_HOURS || 168) * 3600000;

const candidates = [];
for (const upn of ORGANISERS) {
  let org;
  try { org = await graph('/users/' + encodeURIComponent(upn) + '?$select=id,displayName'); }
  catch (e) { continue; }                       // mailbox gone or not readable
  let list;
  try {
    list = await graph('/users/' + org.id + '/onlineMeetings/getAllTranscripts('
      + 'meetingOrganizerUserId=' + encodeURIComponent("'" + org.id + "'") + ')');
  } catch (e) { continue; }                     // no licence, no consent, no meetings
  for (const t of (list.value || [])) {
    if (Date.now() - new Date(t.createdDateTime).getTime() > WINDOW_MS) continue;
    if (done.has(t.meetingId)) continue;
    candidates.push({
      organiserId: org.id, organiserUpn: upn, organiserName: org.displayName,
      transcriptId: t.id, meetingId: t.meetingId, createdDateTime: t.createdDateTime,
    });
  }
}

// Oldest first, so the cards post in the order the meetings happened and the most
// recent meeting is the most recent message in the channel. getAllTranscripts
// returns newest first, so a backfill of several meetings without this posts the
// oldest one last and the channel reads backwards.
candidates.sort(function (a, b) {
  return new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime();
});

const out = [];

for (const cand of candidates) {
  // The onlineMeeting carries subject, times and the participant list. That
  // participant list is also the only reliable source of attendee addresses —
  // a transcript gives names alone.
  let meeting, ev;
  try {
    meeting = await graph('/users/' + cand.organiserId + '/onlineMeetings/' + cand.meetingId);
  } catch (e) {
    continue;
  }
  {
    // Downstream was written against a calendar event, whose dateTime carries no
    // zone suffix and gets a 'Z' appended. Strip it here rather than touching
    // every consumer.
    const noZ = function (s) { return String(s || '').replace(/Z$/, ''); };
    const parts = meeting.participants || {};
    const attendees = (parts.attendees || [])
      .map(function (a) { return (a.upn || (a.identity && a.identity.user && a.identity.user.id) || ''); })
      .filter(Boolean);
    // A recurring series reports the SERIES start, not the instance that was just
    // held: the 18 August weekly filed itself as 2026-07-28, three weeks out. The
    // transcript is the only per-instance timestamp available, and it is written
    // minutes after the meeting ends — so take the DATE from the transcript and
    // keep the TIME OF DAY from the meeting, which a weekly series does hold
    // correctly. A one-off meeting lands on the same date either way, so this is
    // safe to apply unconditionally rather than trying to detect recurrence.
    const instanceStart = function (seriesIso, transcriptIso) {
      const s = new Date(seriesIso), t = new Date(transcriptIso);
      if (isNaN(s.getTime()) || isNaN(t.getTime())) return seriesIso;
      const d = new Date(t);
      d.setUTCHours(s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds(), 0);
      // The transcript lands after the end, so a meeting that ran past midnight UTC
      // would otherwise be dated a day late. Pull back when that happens.
      if (d.getTime() > t.getTime()) d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString();
    };
    const startIso = instanceStart(meeting.startDateTime, cand.createdDateTime);
    const durationMs = Math.max(0,
      new Date(meeting.endDateTime).getTime() - new Date(meeting.startDateTime).getTime());
    const endIso = new Date(new Date(startIso).getTime() + durationMs).toISOString();

    ev = {
      subject: meeting.subject || 'Meeting',
      start: { dateTime: noZ(startIso) },
      end: { dateTime: noZ(endIso) },
      organizer: { emailAddress: { address: cand.organiserUpn, name: cand.organiserName || '' } },
      attendees: attendees,
      seriesStart: meeting.startDateTime,
    };
  }

  try {
    // --- transcript ---------------------------------------------------------
    // json: false because the body is VTT, not JSON. ?$format=text/vtt and an
    // Accept header are equivalent — both return 200 text/vtt — and the query
    // form is kept because it is what the Graph docs show.
    const vtt = await call('transcript-content', {
      method: 'GET',
      url: G + '/users/' + cand.organiserId + '/onlineMeetings/' + cand.meetingId
         + '/transcripts/' + cand.transcriptId + '/content?$format=text/vtt',
      headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'text/vtt' },
      json: false, timeout: 120000,
    });
    const rawVtt = typeof vtt === 'string' ? vtt : String(vtt);

    // Two Teams clients in one call each produce their own stream, so the same
    // utterance arrives twice with slightly different wording. Left in, the
    // model sees every action twice, and it is matched on similarity within a
    // time window because the two streams never word it identically.
    const text = dedupeVtt(rawVtt).vtt;
    if (text.trim().length < 50) continue;   // a transcript of nothing said

    // --- extraction ---------------------------------------------------------
    // Same transient-failure handling as the article scorer: Gemini drops
    // connections often enough that one attempt loses a meeting outright.
    const TRANSIENT = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network|aborted/i;
    let res, lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        res = await call('gemini', {
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

    const TZ = 'Australia/Melbourne';
    const when = new Date(ev.end?.dateTime + 'Z');
    const fmt = d => d.toLocaleDateString('en-AU',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
    const hhmm = d => d.toLocaleTimeString('en-AU',
      { hour: 'numeric', minute: '2-digit', timeZone: TZ });

    const data = {
      program: PROGRAM,
      date: fmt(when),
      time: hhmm(new Date(ev.start.dateTime + 'Z')) + ' – ' + hhmm(when),
      venue: 'Microsoft Teams',
      meeting_no: '1',
      minutes_by: 'BEXT Automation',
      attendees: (x.attendees || []).map(a => ({
        name: a.name || '', initials: a.initials || '', company: a.company || '', email: '' })),
      safety: x.safety || [],
      // The template writes the network position inside the update cell, the way
      // the client's own minutes read.
      projects: (x.projects || []).map(p => Object.assign({}, p, {
        update: p.network_note ? p.update + '\\nNetwork / DNSP: ' + p.network_note : p.update })),
      finance: x.finance || [],
      actions: (x.actions || []).map(a => ({
        item: a.title || '', detail: a.detail || '', owner: a.owner || 'Unassigned',
        due: a.due || '',
        // Stored Open/Closed, rendered Done — the two documents word it
        // differently and both should keep reading as they do.
        status: a.closed ? 'Done' : 'Open' })),
    };

    // --- document -----------------------------------------------------------
    const tpl = await call('template-download', {
      method: 'GET',
      url: G + '/drives/' + DRIVE + '/root:/' + encodeURI(TEMPLATE) + ':/content',
      headers: { Authorization: 'Bearer ' + TOKEN }, encoding: 'arraybuffer', timeout: 60000,
    });
    const docx = await call('render-docx', {
      method: 'POST', url: 'http://fetcher:8080/render-docx',
      // json:false so the RESPONSE stays binary — the previous json:true turned the
      // rendered .docx into a { type: 'Buffer', data: [...] } envelope that was then
      // written to SharePoint as the file itself. The request body has to be
      // stringified by hand as a result: json:true was doing both jobs.
      json: false, timeout: 60000, encoding: 'arraybuffer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: toBuf(tpl).toString('base64'), data }),
    });

    // --- filing -------------------------------------------------------------
    // Date first so the folder sorts chronologically without a custom view, and
    // colons stripped because SharePoint rejects them in a file name.
    const stamp = when.toLocaleDateString('en-CA', { timeZone: TZ });
    const safe = (ev.subject || 'Meeting').replace(/[\\\\/:*?"<>|]/g, '-').slice(0, 80);

    // Failures are collected rather than thrown: a bad write should not cost the
    // draft email. The card is the one thing gated on a clean run.
    const failures = [];
    // Uploads go through Node's https module, not the n8n helper.
    //
    // A Buffer is an object, and the helper JSON.stringify()s an object body even
    // with json:false — so every .docx we wrote was the text
    // {"type":"Buffer","data":[80,75,3,4,...]} rather than the file. It uploads
    // fine, SharePoint stores it happily, and Word then reports "unreadable
    // content", which reads as a broken template or a permissions problem. The
    // files written by graph/run-meeting-once.js were intact throughout, because
    // that path uses plain fetch — that difference is what identified it.
    //
    // https.request writes the bytes verbatim, so there is nothing left to
    // misinterpret them.
    const https = require('https');
    const putBinary = (urlStr, buf, type) => new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const req = https.request({
        method: 'PUT', hostname: u.hostname, path: u.pathname + u.search,
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          'Content-Type': type,
          'Content-Length': buf.length,
        },
        timeout: 120000,
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400) return reject(new Error('upload ' + res.statusCode + ': ' + text.slice(0, 200)));
          try { resolve(JSON.parse(text)); } catch (e) { resolve({}); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('upload timed out')));
      req.on('error', reject);
      req.end(buf);
    });

    const put = async (driveId, p, body, type) => {
      try {
        const buf = toBuf(body);
        // A .docx is a zip. If what we are about to write is not one, the render
        // stage produced something else and writing it would recreate the exact
        // fault above — fail loudly instead.
        if (/\.docx$/i.test(p) && buf.slice(0, 4).toString('hex') !== '504b0304') {
          throw new Error('refusing to upload ' + p + ': not a zip (docx), starts '
            + buf.slice(0, 8).toString('hex'));
        }
        return await putBinary(
          G + '/drives/' + driveId + '/root:/' + encodeURI(p) + ':/content', buf, type);
      } catch (err) { failures.push(p + ' — ' + err.message); return {}; }
    };

    const chSite = await graph('/sites/' + CHANNEL_SITE);
    const chDrives = await graph('/sites/' + chSite.id + '/drives');
    const CH = (chDrives.value.find(d => d.name === 'Documents') || chDrives.value[0]).id;
    const folder = CHANNEL_BASE + '/' + stamp + ' ' + safe;

    const summaryDoc = simpleDocx(data.program + ' — Meeting Summary', [
      { text: data.date + '  ·  ' + data.venue },
      { heading: 'Summary' }, { text: String(x.summary || '') },
    ].concat((x.decisions || []).length ? [{ heading: 'Decisions' }] : [])
     .concat((x.decisions || []).map(d => ({ text: '•  ' + d })))
     .concat((x.actions || []).length ? [{ heading: 'Actions' }] : [])
     .concat((x.actions || []).map(a => ({
       text: '•  ' + a.title + ' — ' + (a.owner || 'Unassigned')
         + (a.due ? ', due ' + a.due : '') + (a.closed ? '  [closed]' : '') })))
     .concat([{ heading: 'Attendees' },
       { text: (x.attendees || []).map(a => a.name).join(', ') }]));

    const transcriptDoc = simpleDocx(data.program + ' — Transcript', [
      { text: data.date + '  ·  ' + data.venue },
    ].concat(vttToBlocks(text)));

    // Minutes last, in both places, so the card never announces a half-filed record.
    const arcTr = BASE + '/Meeting Transcripts/' + stamp + ' ' + safe + '.vtt';
    const arcMin = BASE + '/Meeting Minutes/' + stamp + ' ' + safe + ' — Minutes.docx';
    await put(DRIVE, arcTr, text, 'text/vtt');
    const chTr = await put(CH, folder + '/Transcript.vtt', text, 'text/vtt');
    const chSum = await put(CH, folder + '/Summary.docx', summaryDoc, DOCX);
    await put(CH, folder + '/Transcript.docx', transcriptDoc, DOCX);
    await put(DRIVE, arcMin, toBuf(docx), DOCX);
    const chMin = await put(CH, folder + '/Minutes.docx', toBuf(docx), DOCX);

    // SharePoint has no preview handler for .vtt, so the readable rendition is
    // what the card links to. Conversion is best effort and the button falls back;
    // the filled minutes in particular are refused by the Word export service.
    let pdfBuf = null;
    const toPdf = async (src, dst) => {
      try {
        const raw = await call('pdf-convert', {
          method: 'GET',
          url: G + '/drives/' + CH + '/root:/' + encodeURI(src) + ':/content?format=pdf',
          headers: { Authorization: 'Bearer ' + TOKEN }, encoding: 'arraybuffer', timeout: 120000,
        });
        const b = toBuf(raw);
        // Kept so the minutes PDF can also be attached to the email — the same
        // bytes, rather than downloading what we just uploaded.
        if (/Minutes\.pdf$/.test(dst)) pdfBuf = b;
        // The service answers 200 with a JSON error body on some inputs, so trust
        // the magic bytes rather than the status code.
        if (b.slice(0, 5).toString('latin1') !== '%PDF-') return {};
        return await put(CH, dst, b, 'application/pdf');
      } catch (err) { return {}; }
    };
    const pdfMin = await toPdf(folder + '/Minutes.docx', folder + '/Minutes.pdf');
    const pdfSum = await toPdf(folder + '/Summary.docx', folder + '/Summary.pdf');
    const pdfTr = await toPdf(folder + '/Transcript.docx', folder + '/Transcript.pdf');

    const chFolder = await graph('/drives/' + CH + '/root:/' + encodeURI(folder));

    // --- follow-up draft ----------------------------------------------------
    // Created as a draft and never sent. The brief is explicit that nothing
    // leaves without review, and a draft enforces that structurally rather than
    // by convention.
    // Recipients: people who were invited AND actually spoke. The meeting's
    // participant list is the only source of addresses — a transcript gives names
    // alone — and intersecting with the speakers keeps a silent invitee off a
    // client-visible email. The organiser is always included, because they own the
    // meeting whether or not they said anything.
    const spoke = (x.attendees || [])
      .map(a => String(a.name || '').toLowerCase().trim())
      .filter(Boolean);
    const nameOf = addr => {
      const p = PARTICIPANTS.find(q =>
        String(q.email || '').toLowerCase() === String(addr).toLowerCase());
      return p ? String(p.name).toLowerCase() : String(addr).split('@')[0].toLowerCase();
    };
    const organiser = ev.organizer?.emailAddress?.address || '';
    const recipients = [];
    for (const addr of (ev.attendees || []).concat(organiser ? [organiser] : [])) {
      if (!addr || !addr.includes('@')) continue;
      if (recipients.some(r => r.toLowerCase() === addr.toLowerCase())) continue;
      const n = nameOf(addr);
      const said = spoke.some(s => s === n || s.split(' ')[0] === n.split(' ')[0]);
      if (said || addr.toLowerCase() === organiser.toLowerCase()) recipients.push(addr);
    }

    const email = buildMeetingEmail({
      subject: ev.subject,
      startIso: ev.start.dateTime + 'Z',
      timeZone: TZ,
      summary: x.summary || '',
      decisions: x.decisions || [],
      projects: x.projects || [],
      safety: x.safety || [],
      finance: x.finance || [],
      actions: x.actions || [],
      participants: PARTICIPANTS,
      urls: { folder: chFolder.webUrl || '', minutes: chMin.webUrl || '' },
    });

    // Who actually receives it.
    //
    // MEETING_REPORT_RECIPIENT set  -> the message is SENT, to that address only.
    // MEETING_REPORT_RECIPIENT unset -> it stays a draft addressed to the people
    //                                   who spoke, for someone to review and send.
    //
    // Sending only to Brent is deliberate: he wants it in his inbox rather than
    // having to open a draft, but nothing reaches an external attendee without a
    // person deciding to forward it. Clearing the variable restores the review
    // step everywhere, which is why the behaviour hangs off configuration rather
    // than being written into the code path.
    const SEND_TO = ($env.MEETING_REPORT_RECIPIENT || '').trim();
    const to = SEND_TO ? [SEND_TO] : recipients;

    const draft = await graph('/users/' + me.id + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        subject: email.subject,
        body: { contentType: 'HTML', content: email.html },
        toRecipients: to.map(a => ({ emailAddress: { address: a } })),
        // Who was in the room, recorded on the message itself so a forward does
        // not have to be reconstructed from the minutes.
        replyTo: recipients.length
          ? recipients.map(a => ({ emailAddress: { address: a } })) : undefined,
      },
    });

    // "Please see attached minutes" has to be true. Under 3 MB goes inline;
    // anything larger needs an upload session, and the minutes have never come
    // close — so a big file falls back to the SharePoint link already in the body
    // rather than failing the run over an attachment.
    const docxBuf = toBuf(docx);
    if (docxBuf.length < 3000000) {
      await graph('/users/' + me.id + '/messages/' + draft.id + '/attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'Minutes.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          contentBytes: docxBuf.toString('base64'),
        },
      });
    }

    // The PDF too, when the conversion produced one — it previews on a phone
    // without Word, which is how this actually gets read.
    if (pdfBuf && pdfBuf.length && pdfBuf.length < 3000000) {
      try {
        await graph('/users/' + me.id + '/messages/' + draft.id + '/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'Minutes.pdf',
            contentType: 'application/pdf',
            contentBytes: pdfBuf.toString('base64'),
          },
        });
      } catch (e) { /* the Word copy is attached; a missing preview is not a failure */ }
    }

    // Send only when a recipient is configured. The attachments have to be on the
    // message before this, because a sent message cannot be added to.
    let sentAt = null;
    if (SEND_TO) {
      try {
        await graph('/users/' + me.id + '/messages/' + draft.id + '/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: {},
        });
        sentAt = new Date().toISOString();
      } catch (e) {
        // A record that exists but was not announced is recoverable; losing the
        // record over a mail failure is not.
        failures.push('send — ' + e.message);
      }
    }

    // --- channel card -------------------------------------------------------
    // Graph publishes no application permission for posting a channel message, so
    // this goes through the Power Automate webhook. A failure here leaves the
    // record complete and only the announcement missing, so it never sets failed.
    let postedAt = null, postError = null;
    if (!WEBHOOK) postError = 'TEAMS_MEETING_WEBHOOK_URL not set';
    else if (failures.length) postError = 'not posted, ' + failures.length + ' file(s) failed to land';
    else {
      try {
        // A transcript gives display names only, so most attendees will not
        // resolve. Those that do become real Teams mentions.
        const people = [];
        for (const a of (x.attendees || [])) {
          const nm = ((a && a.name) || '').trim();
          if (!nm) continue;
          try {
            const q = 'displayName eq ' + JSON.stringify(nm).replace(/"/g, "'");
            const f = await graph('/users?$select=id,displayName&$filter=' + encodeURIComponent(q));
            const hit = f && f.value && f.value[0];
            people.push(hit ? Object.assign({}, a, { id: hit.id }) : a);
          } catch (err) { people.push(a); }
        }

        const card = buildMeetingCard({
          subject: x.title || ev.subject, program: data.program, meetingNo: data.meeting_no,
          date: data.date, time: data.time, venue: data.venue,
          organiser: ev.organizer?.emailAddress?.name || '',
          attendees: people, summary: x.summary || '', decisions: x.decisions || [],
          actions: x.actions || [], projects: x.projects || [], safety: x.safety || [],
          urls: {
            folder: chFolder.webUrl,
            minutes: pdfMin.webUrl || chMin.webUrl,
            summary: pdfSum.webUrl || chSum.webUrl,
            transcript: pdfTr.webUrl || chTr.webUrl,
          },
        });

        // A URL carrying its own sig is self-authenticating. Without one the
        // trigger is tenant-restricted and wants an app-only bearer token.
        const hdrs = { 'Content-Type': 'application/json' };
        if (!/[?&]sig=/.test(WEBHOOK)) {
          const ft = await call('webhook-token', {
            method: 'POST',
            url: 'https://login.microsoftonline.com/' + TENANT + '/oauth2/v2.0/token',
            form: {
              client_id: CLIENT, client_secret: SECRET, grant_type: 'client_credentials',
              scope: 'https://service.flow.microsoft.com/.default',
            },
            json: true, timeout: 30000,
          });
          hdrs.Authorization = 'Bearer ' + ft.access_token;
        }
        await call('channel-webhook', { method: 'POST', url: WEBHOOK, headers: hdrs, body: card, json: true, timeout: 60000 });
        postedAt = new Date().toISOString();
      } catch (err) { postError = String(err.message || err).slice(0, 400); }
    }

    out.push({ json: {
      meeting_id: meeting.id,
      subject: x.title || ev.subject || 'Meeting',
      organiser_upn: ev.organizer?.emailAddress?.address || '',
      started_at: ev.start?.dateTime ? ev.start.dateTime + 'Z' : null,
      ended_at: ev.end?.dateTime ? ev.end.dateTime + 'Z' : null,
      attendees: (x.attendees || []).map(a => a.name || '').filter(Boolean),
      status: 'drafted',
      transcript_path: arcTr,
      minutes_path: arcMin,
      draft_message_id: draft.id,
      extracted: x,
      model: MODEL,
      error: null,
      folder_url: chFolder.webUrl || null,
      minutes_url: chMin.webUrl || null,
      minutes_pdf_url: pdfMin.webUrl || null,
      summary_pdf_url: pdfSum.webUrl || null,
      transcript_pdf_url: pdfTr.webUrl || null,
      sent_at: sentAt,
      summary_url: (pdfSum.webUrl || chSum.webUrl) || null,
      transcript_url: (pdfTr.webUrl || chTr.webUrl) || null,
      posted_at: postedAt,
      post_error: postError,
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
        // A cron expression rather than a minutes interval. n8n 2.32.6 fails to
        // register the interval form when a workflow is activated through the
        // public API — the scheduler throws
        //   TypeError: r.firstEvent.getTime is not a function
        // and the workflow then reads active with nothing actually scheduled.
        // The two workflows that have always fired, the 05:00 report and the
        // 06:00 health check, both use cronExpression.
        parameters: { rule: { interval: [{ field: 'cronExpression', expression: '*/15 * * * *' }] } },
      },
      {
        id: 'seen', name: 'Load processed meetings', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-160, 0),
        // An n8n node that emits zero items does not run the nodes after it. This
        // query returns nothing until the first meeting has been filed, so without
        // this the workflow could never bootstrap: it ran, produced no items, and
        // "succeeded" doing nothing — invisible, because EXECUTIONS_DATA_SAVE_ON_SUCCESS
        // is none. The exclusion list being empty is the normal first state, not a
        // reason to stop.
        alwaysOutputData: true,
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // Only the window the code looks at. The table grows forever; the
          // exclusion list should not.
          // Only meetings that actually produced something count as done. Including
          // failed rows here means one transient failure retires the meeting for
          // good: the row lands, the next tick sees it in the exclusion list, and
          // the meeting is never attempted again. A permanently broken meeting will
          // now retry every fifteen minutes, which is noisy but visible — and the
          // three-day window bounds it.
          // Two datasets in one node, tagged by `kind`. The Code node takes a
          // single input, and a second Postgres node would have to fan in — this
          // keeps the graph flat. `done` is the exclusion list; `participant`
          // supplies the person → company mapping the follow-up email groups by.
          query: `SELECT 'done' AS kind, meeting_id AS a, NULL::text AS b, NULL::text AS c,
                         NULL::text[] AS d
  FROM meeting_minutes
 WHERE status <> 'failed'
   AND created_at > now() - interval '3 days'
UNION ALL
SELECT 'participant', name, company, email, aliases FROM participants`,
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
   transcript_path, minutes_path, draft_message_id, extracted, model, error,
   folder_url, minutes_url, summary_url, transcript_url, posted_at, post_error,
   minutes_pdf_url, summary_pdf_url, transcript_pdf_url, sent_at)
SELECT meeting_id, subject, organiser_upn, started_at, ended_at,
       coalesce(attendees, '{}'), status::minutes_status,
       transcript_path, minutes_path, draft_message_id, extracted, model, error,
       folder_url, minutes_url, summary_url, transcript_url, posted_at, post_error,
       minutes_pdf_url, summary_pdf_url, transcript_pdf_url, sent_at
FROM json_to_recordset($1::json) AS x(
  meeting_id text, subject text, organiser_upn text,
  started_at timestamptz, ended_at timestamptz, attendees text[], status text,
  transcript_path text, minutes_path text, draft_message_id text,
  extracted jsonb, model text, error text,
  folder_url text, minutes_url text, summary_url text, transcript_url text,
  minutes_pdf_url text, summary_pdf_url text, transcript_pdf_url text, sent_at timestamptz,
  posted_at timestamptz, post_error text)
-- The unique index on meeting_id is PARTIAL (WHERE meeting_id IS NOT NULL), which
-- lets several rows carry a null id. Postgres will not match a partial index unless
-- the inference repeats its predicate, so omitting the WHERE here fails with
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
ON CONFLICT (meeting_id) WHERE meeting_id IS NOT NULL DO UPDATE SET
  status = EXCLUDED.status, minutes_path = EXCLUDED.minutes_path,
  draft_message_id = EXCLUDED.draft_message_id, extracted = EXCLUDED.extracted,
  error = EXCLUDED.error, folder_url = EXCLUDED.folder_url,
  minutes_url = EXCLUDED.minutes_url, summary_url = EXCLUDED.summary_url,
  minutes_pdf_url = EXCLUDED.minutes_pdf_url,
  summary_pdf_url = EXCLUDED.summary_pdf_url,
  transcript_pdf_url = EXCLUDED.transcript_pdf_url,
  sent_at = EXCLUDED.sent_at,
  transcript_url = EXCLUDED.transcript_url,
  -- A re-run that fails to post must not erase the timestamp of one that did.
  posted_at = coalesce(EXCLUDED.posted_at, meeting_minutes.posted_at),
  post_error = EXCLUDED.post_error, updated_at = now()`,
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

// ─── Workflow 6: Teams Inbound ───────────────────────────────────────────────

// Normalises whatever the Power Automate flow sends into the one shape the rest
// of the chain expects, and refuses anything that is not a transcript. The flow
// posts the driveItem id rather than the file body: the payload stays small, and
// the flow never needs permission to read content the app-only pipeline can
// already fetch for itself.
const TEAMS_INBOUND_CODE = `
const body = $input.first().json.body || $input.first().json;

const item = {
  source: body.source || 'unknown',
  driveId: body.driveId || '',
  itemId: body.itemId || '',
  name: body.name || '',
  webUrl: body.webUrl || '',
  createdDateTime: body.createdDateTime || new Date().toISOString(),
};

// A folder-created event fires for the folder as well as the file, and Teams
// occasionally replays one. Neither is an error worth alerting on — they are
// simply not work, so say so and stop.
if (!item.itemId || !/\\.vtt$/i.test(item.name)) {
  return [{ json: { ...item, accepted: false, reason: 'not a .vtt transcript' } }];
}

return [{ json: { ...item, accepted: true } }];
`;

function teamsInboundWorkflow(meetingIntakeId) {
  return {
    name: 'BEXT — Teams Inbound',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'hook', name: 'Teams inbound', type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: pos(-380, 0),
        // Hardcoded so a redeploy keeps the URL. n8n mints a fresh webhookId per
        // node otherwise, which silently breaks the Power Automate flow calling it
        // — the flow keeps returning 404 against a URL that no longer exists.
        webhookId: 'b7f1c4e2-3a9d-4c17-8e55-2f6a0d91b4c3',
        parameters: {
          httpMethod: 'POST',
          path: 'teams-inbound',
          // Reachable publicly through traefik, unlike the polling workflows, so
          // this one needs a real secret rather than obscurity.
          authentication: 'headerAuth',
          responseMode: 'onReceived',
          options: {},
        },
        credentials: WEBHOOK_CRED
          ? { httpHeaderAuth: { id: WEBHOOK_CRED, name: 'BEXT Webhook Auth' } }
          : undefined,
      },
      {
        id: 'normalise', name: 'Normalise payload', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(-140, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: TEAMS_INBOUND_CODE },
      },
      {
        id: 'gate', name: 'Only transcripts', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: pos(100, 0),
        parameters: {
          conditions: {
            options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
            combinator: 'and',
            conditions: [{
              id: 'accepted',
              operator: { type: 'boolean', operation: 'true', singleValue: true },
              leftValue: '={{ $json.accepted }}',
              rightValue: '',
            }],
          },
          options: {},
        },
      },
      {
        id: 'run', name: 'Run Meeting Intake', type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2, position: pos(340, -80),
        // Calls the existing pipeline rather than repeating it. Meeting Intake
        // already excludes anything in meeting_minutes, so an early run here and
        // the fifteen-minute poll cannot produce the record twice.
        parameters: {
          workflowId: { __rl: true, value: meetingIntakeId, mode: 'id' },
          options: { waitForSubWorkflow: false },
        },
      },
    ],
    connections: {
      'Teams inbound': { main: [[{ node: 'Normalise payload', type: 'main', index: 0 }]] },
      'Normalise payload': { main: [[{ node: 'Only transcripts', type: 'main', index: 0 }]] },
      'Only transcripts': { main: [[{ node: 'Run Meeting Intake', type: 'main', index: 0 }], []] },
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

  if (DRY) {
    // Still resolve the id, because one workflow is wired to another by id and a
    // dry run that cannot answer "what id would this have had" cannot build the
    // caller at all. Read-only, and --dry stays usable offline: a failure here
    // returns nothing rather than stopping the build.
    try {
      const list = await (await fetch(`${B}/api/v1/workflows?limit=100`, { headers: H })).json();
      return list.data?.find(w => w.name === wf.name)?.id;
    } catch {
      return undefined;
    }
  }

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
    const meetingId = await deploy(meetingIntakeWorkflow());

    // The inbound hook exists to start Meeting Intake early instead of waiting out
    // the fifteen-minute poll, so it is only worth deploying once that workflow has
    // an id to call. Without the header-auth credential it would be an unauthenticated
    // public endpoint, which is not a trade worth making for a latency improvement.
    if (!WEBHOOK_CRED) {
      console.error('N8N_WEBHOOK_CREDENTIAL_ID not set — skipping Teams Inbound.');
      console.error('  Create an n8n Header Auth credential named "BEXT Webhook Auth" and put its id in .env.');
    } else if (!meetingId) {
      console.error('No id for Meeting Intake — skipping Teams Inbound, which calls it by id.');
      if (DRY) console.error('  (--dry needs the workflow to exist already, or n8n to be reachable.)');
    } else {
      await deploy(teamsInboundWorkflow(meetingId));
    }
  }
})();
