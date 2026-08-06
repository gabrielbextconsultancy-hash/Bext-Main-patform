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
  let articles = [], status = 'ok', error = null;

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
    articles = normalise(raw, { id: s.id, config });
    if (articles.length === 0) status = 'empty';
  } catch (e) {
    status = 'error';
    error = String(e.message || e).slice(0, 500);
  }

  return { json: { source_id: s.id, slug: s.slug, status, error, articles } };
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

const res = await this.helpers.httpRequest({
  method: 'POST',
  url: \`https://generativelanguage.googleapis.com/v1beta/models/\${MODEL}:generateContent?key=\${KEY}\`,
  json: true,
  timeout: 120000,
  body: {
    contents: [{ parts: [{ text: PROMPT + JSON.stringify(payload, null, 1) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  },
});

const text = res?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
let parsed;
try { parsed = JSON.parse(text); }
catch { throw new Error('Gemini returned unparseable JSON: ' + text.slice(0, 300)); }

const valid = new Set(rows.map(r => r.id));
return parsed
  .filter(p => valid.has(p.id))
  .map(p => ({ json: {
    article_id: p.id,
    summary: String(p.summary ?? '').slice(0, 2000),
    relevance_score: Math.max(0, Math.min(100, Number(p.relevance_score) || 0)),
    topics: Array.isArray(p.topics) ? p.topics.slice(0, 4) : [],
    entities: Array.isArray(p.entities) ? p.entities.slice(0, 10) : [],
    model: MODEL,
  }}));
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
VALUES ($1, $2, $3, string_to_array(nullif($4,''), '|'), string_to_array(nullif($5,''), '|'), $6)
ON CONFLICT (article_id) DO NOTHING`,
          options: {
            queryReplacement:
              '={{ $json.article_id }},{{ $json.summary }},{{ $json.relevance_score }},{{ $json.topics.join("|") }},{{ $json.entities.join("|") }},{{ $json.model }}',
          },
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

const REPORT_SELECT = `
WITH ranked AS (
  SELECT a.id, a.url, a.title, a.published_at, s.name AS source_name, s.category,
         an.summary, an.relevance_score,
         row_number() OVER (PARTITION BY s.category ORDER BY an.relevance_score DESC, a.published_at DESC NULLS LAST) AS rn
  FROM articles a
  JOIN sources s          ON s.id = a.source_id
  JOIN article_analysis an ON an.article_id = a.id
  WHERE a.fetched_at > now() - interval '24 hours'
    AND an.relevance_score >= 40
)
SELECT id, url, title, published_at, source_name, category, summary, relevance_score
FROM ranked
WHERE rn <= 8
ORDER BY category, relevance_score DESC`;

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
        id: 'pull', name: 'Top articles, last 24h', type: 'n8n-nodes-base.postgres',
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
    .map(r => \`- [\${r.relevance_score}] \${r.title} (\${r.source_name})\`).join('\\n');
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://ollama:11434/api/generate',
    json: true,
    timeout: 180000,
    body: {
      model: 'hermes3:8b',
      stream: false,
      options: { temperature: 0.3, num_predict: 220 },
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
const today = new Date().toLocaleDateString('en-AU',
  { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Australia/Melbourne' });

// Inline styles throughout — Outlook and Gmail strip <style> blocks.
const body = d.empty
  ? '<p style="color:#6b7280">No qualifying articles in the last 24 hours.</p>'
  : d.sections.map(sec => \`
      <h2 style="font:600 15px/1.3 Arial,sans-serif;color:#111827;margin:28px 0 10px;
                 padding-bottom:6px;border-bottom:2px solid #14b8a6">\${esc(sec.name)}</h2>
      \` + sec.items.map(a => \`
        <div style="margin:0 0 16px">
          <a href="\${esc(a.url)}" style="font:600 14px/1.4 Arial,sans-serif;color:#0f766e;
             text-decoration:none">\${esc(a.title)}</a>
          <div style="font:11px/1.4 Arial,sans-serif;color:#9ca3af;margin:3px 0 4px">
            \${esc(a.source_name)} · relevance \${a.relevance_score}
          </div>
          <div style="font:13px/1.5 Arial,sans-serif;color:#374151">\${esc(a.summary)}</div>
        </div>\`).join('')
    ).join('');

const html = \`<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6">
<div style="max-width:680px;margin:0 auto;background:#fff;padding:28px 32px">
  <div style="font:11px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#9ca3af">
    BEXT Consultancy · Industry Daily
  </div>
  <h1 style="font:600 20px/1.3 Arial,sans-serif;color:#111827;margin:6px 0 2px">\${today}</h1>
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
return [{ json: { html, subject: 'BEXT Industry Daily — ' + today,
                  report_date: date, item_count: d.item_count,
                  recipient: $env.REPORT_RECIPIENT || $env.REPORT_SENDER,
                  generated_by: d.generated_by } }];
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
          options: {
            queryReplacement:
              '=Sent {{ $("Render HTML").first().json.item_count }} items to {{ $("Render HTML").first().json.recipient }}, brief by {{ $("Render HTML").first().json.generated_by }}',
          },
        },
      },
    ],
    connections: {
      'Daily 05:00 AEST': { main: [[{ node: 'Top articles, last 24h', type: 'main', index: 0 }]] },
      'Top articles, last 24h': { main: [[{ node: 'Hermes writes the brief', type: 'main', index: 0 }]] },
      'Hermes writes the brief': { main: [[{ node: 'Render HTML', type: 'main', index: 0 }]] },
      'Render HTML': { main: [[{ node: 'Save report', type: 'main', index: 0 }]] },
      'Save report': { main: [[{ node: 'Send via SMTP', type: 'main', index: 0 }]] },
      'Send via SMTP': { main: [[{ node: 'Mark sent', type: 'main', index: 0 }]] },
      'Mark sent': { main: [[{ node: 'Record result', type: 'main', index: 0 }]] },
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
  if (!SMTP_CRED) console.error('N8N_SMTP_CREDENTIAL_ID not set — skipping the daily report.');
  else await deploy(dailyReportWorkflow());
})();
