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
// IMAP credential for the newsletter mailbox — tier 0. Absent, that workflow is
// not deployed at all; see the note where it is skipped.
const IMAP_CRED = process.env.N8N_IMAP_CREDENTIAL_ID;
const TAG = 'BEXT Consultancy';

// The tested parser, minus its CommonJS export line, for embedding in a Code node.
const INGEST_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'ingest.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '')
  .replace(/^const crypto = require\('crypto'\);$/m, '');

// The model-backed fallback reader, minus its export line. Runs only when the
// ordinary parser finds nothing, so a broken source degrades instead of dying.
const HERMES_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'hermes-extract.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '');

// The tested document writer, minus its export line, for embedding in a Code node.
// The Teams news card and the fetch-list PDF, minus their export lines.
const NEWS_CARD_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'news-card.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '');

const FETCH_LIST_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'fetch-list.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '');

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

// The heal rules, minus their export line. Shared verbatim with n8n/self-heal.js
// so the workflow and the script recognise a failure the same way — preflight
// R025/R026 assert the ids and actions stay in step.
const HEAL_RULES_SRC = fs
  .readFileSync(path.join(__dirname, 'lib', 'heal-rules.js'), 'utf8')
  .replace(/^module\.exports\s*=.*$/m, '');

// The LinkedIn craft library, each file inlined into the content Code nodes.
// Order matters: scrub requires voice and audit requires heuristics, so a
// required module has to appear above the one that needs it.
//
// Two modules are read by others through a namespace (scrub uses VOICE.*, audit
// uses H.*). Those keep their binding: `module.exports = {` becomes `var VOICE = {`
// / `var H = {` rather than being stripped, so the reference still resolves once
// the require line is gone. The leaf modules (formulas, scrub, audit, factcheck,
// publish) are called by their bare exported names and simply lose their exports.
//
// n8n/lib/linkedin/test.js exercises all of these as ordinary modules — the same
// code, run two ways, so a change that breaks one breaks the test first.
const LI_READ = src => fs.readFileSync(path.join(__dirname, 'lib', 'linkedin', src), 'utf8')
  .replace(/^var \w+ = require\([^)]*\);$/gm, '');   // requires resolved by inlining, in order
const LI_HEURISTICS_SRC = LI_READ('heuristics.js').replace(/^module\.exports\s*=\s*\{/m, 'var H = {');
const LI_VOICE_SRC      = LI_READ('voice.js').replace(/^module\.exports\s*=\s*\{/m, 'var VOICE = {');
const LI_FORMULAS_SRC   = LI_READ('formulas.js').replace(/^module\.exports\s*=.*$/m, '');
const LI_SCRUB_SRC      = LI_READ('scrub.js').replace(/^module\.exports\s*=.*$/m, '');
const LI_AUDIT_SRC      = LI_READ('audit.js').replace(/^module\.exports\s*=.*$/m, '');
const LI_FACTCHECK_SRC  = LI_READ('factcheck.js').replace(/^module\.exports\s*=.*$/m, '');
const LI_PUBLISH_SRC    = LI_READ('publish.js').replace(/^module\.exports\s*=.*$/m, '');

// Everything the drafting and publishing nodes need, inlined once in dependency
// order. A Code node prepends this and then calls the functions directly (scrub,
// audit, reconcile, pick, formulaPromptBlock, voicePromptBlock, plan).
const LI_LIB = [
  '// --- LinkedIn craft library, generated from n8n/lib/linkedin/*.js — do not edit here ---',
  LI_HEURISTICS_SRC, LI_VOICE_SRC, LI_FORMULAS_SRC,
  LI_SCRUB_SRC, LI_AUDIT_SRC, LI_FACTCHECK_SRC, LI_PUBLISH_SRC,
  '// --- end LinkedIn craft library ---',
].join('\n');

const pos = (x, y) => [x, y];

// ─── Heartbeat ───────────────────────────────────────────────────────────────
//
// The last node on a workflow's success path, and the only thing that can tell
// the difference between "n8n is up" and "the 05:00 report actually went out".
// Kuma alarms on the ping NOT arriving, so this node existing is the assertion.
//
// Three deliberate choices:
//
//   httpRequest, not a Code node — the Kuma URL is plain http on the internal
//   docker network and the Code sandbox only allows crypto/url/https/dns. Using
//   a real node avoids widening NODE_FUNCTION_ALLOW_BUILTIN for a heartbeat.
//
//   onError continue — a monitor that can fail its own workflow is worse than
//   no monitor. If Kuma is down the workflow still finishes; the missing ping is
//   itself the alarm.
//
//   the token comes from $env at runtime, never from this file. A push token in
//   committed JSON lets anyone fake a healthy heartbeat, which reports all-clear
//   during an outage. Preflight R027 asserts it.
const heartbeat = (envKey, x, y) => ({
  id: 'kuma', name: 'Heartbeat', type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2, position: pos(x, y),
  onError: 'continueRegularOutput',
  parameters: {
    url: `={{ $env.KUMA_PUSH_BASE + "/" + $env.${envKey} }}`,
    options: { timeout: 5000 },
    sendQuery: true,
    queryParameters: { parameters: [{ name: 'status', value: 'up' }, { name: 'msg', value: 'OK' }] },
  },
});

// ─── Workflow 1: Source Ingest ───────────────────────────────────────────────

const INGEST_CODE = `
// --- shared parser, generated from n8n/lib/ingest.js — do not edit here ---
// n8n's Code sandbox does not expose the WHATWG URL global that the parser uses
// to resolve relative hrefs, so pull it off the url builtin explicitly.
const crypto = require('crypto');
const { URL } = require('url');
${INGEST_SRC}
// --- end shared parser ---

// --- model-backed fallback reader ---
${HERMES_SRC}
// --- end fallback reader ---

const FETCHER = 'http://fetcher:8080/fetch';
// Reproduces Chrome's TLS fingerprint, which is what the 403s were actually
// about. See scrapling/app.py for the before-and-after per source.
const SCRAPLING = 'http://scrapling:8090/fetch';
// Authenticated retrieval. The fetcher holds the logged-in browser context and
// reads credentials from its own environment; none of that passes through here.
const SESSION_FETCH = 'http://fetcher:8080/session-fetch';

// Did this page yield anything parseable? Used to decide whether it is worth
// paying for a browser render, and later whether to ask Hermes.
const parseIndex_isEmpty = (html, url, method) => {
  try {
    const got = method === 'rss' ? parseFeed(html, url) : parseIndex(html, url);
    return !Array.isArray(got) || got.length === 0;
  } catch (e) {
    return true;
  }
};
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
  let articles = [], status = 'ok', error = null, seen = 0, via = 'http';

  // Every tier logs what it did, whether it ran or not. A checklist that only
  // shows the winner cannot answer "was this even attempted?", which is the
  // question that went unanswered while DCCEEW reported ok and returned nothing.
  const attempts = [];
  const record = (tier, outcome, found, detail, ms) => {
    attempts.push({
      tier: tier, outcome: outcome, articles_found: found || 0,
      detail: detail || null, duration_ms: typeof ms === 'number' ? ms : null,
    });
  };
  // A refusal and a crash need telling apart: one means the site declined us and
  // escalating may help, the other means our own code broke and it probably will not.
  const refusalOutcome = (e) => (/\b(401|403|404|429|451|not signed in)\b/i.test(String(e.message || e)) ? 'refused' : 'error');

  try {
    // Tier 0. A newsletter may already have delivered this source's articles, in
    // which case there is nothing to fetch. This satisfies the source only where
    // scraping cannot work at all — the account walls. Everywhere else the
    // newsletter is additive, because a daily edition carries a fraction of what
    // a publisher ran, and treating it as sufficient would quietly shrink the sheet.
    if (s.email_authoritative) {
      const fresh = Number(s.email_articles_recent || 0);
      if (fresh > 0) {
        record(0, 'success', fresh, 'newsletter delivered within the freshness window');
        for (const t of [1, 2, 3, 4]) record(t, 'skipped', 0, 'the newsletter already delivered');
        return { json: {
          source_id: s.id, slug: s.slug, status: 'ok', error: null,
          articles: [], seen: fresh, via: 'email', satisfied_by_tier: 0, attempts: attempts,
        } };
      }
      record(0, 'empty', 0, 'no newsletter for this source in the window');
    } else {
      record(0, 'skipped', 0, 'newsletter is additive for this source, not authoritative');
    }

    // Retrieval is a ladder, because the ways a source fails are different in
    // kind and no single client handles all of them. Measured 22 Aug 2026:
    //
    //   plain HTTP        DCCEEW 403, EcoGeneration 403, NABERS unreachable
    //   TLS impersonation all three answer 200 — the WAF was fingerprinting the
    //                     handshake, so more Chromium was never going to help
    //   Chromium          still the only thing that runs client-side JavaScript
    //
    // Scrapling therefore goes first for everything, and Chromium is kept for
    // what it is genuinely needed for rather than used as a blunt retry.
    let html;

    const viaScrapling = async () => {
      const r = await helpers.httpRequest({
        method: 'POST', url: SCRAPLING, json: true, timeout: 90000,
        body: { url: target, include_html: true, timeout: 45 },
      });
      // A block page is not content. Returning it anyway is how a dead source
      // reports "ok" for weeks, which is the failure this whole ladder exists for.
      if (!r || !r.ok) throw new Error('scrapling status ' + ((r && r.status) || '?'));
      return r.html || '';
    };

    const viaBrowser = async () => {
      // The fetcher runs two browsers at a time and answers 503 when both are
      // busy, so back off rather than dropping the source for the whole hour.
      let last;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const r = await helpers.httpRequest({
            method: 'POST', url: FETCHER, json: true, timeout: 120000,
            body: { url: target, timeout: 60000 },
          });
          return r.html || '';
        } catch (e) {
          last = e;
          if (!String(e.message || '').includes('503')) throw e;
          await sleep(5000 + attempt * 3000);
        }
      }
      throw last || new Error('fetcher unavailable');
    };

    const viaSession = async () => {
      // Subscriber and member content. Credentials live in n8n's environment and
      // are read by the fetcher at request time — they are never in this workflow,
      // in the repo, or in any log line here.
      const r = await helpers.httpRequest({
        method: 'POST', url: SESSION_FETCH, json: true, timeout: 150000,
        body: { url: target, site: config.session_site, timeout: 90000 },
      });
      // Signed out, these sites return 200 and a perfectly valid visitor page.
      // Trusting the status code here is exactly how member articles would go
      // missing while the health table stayed green.
      if (!r || !r.authenticated) {
        throw new Error('not signed in' + (r && r.detail ? ': ' + r.detail : ''));
      }
      return r.html || '';
    };

    let raw = null;

    // The tiers, in escalation order. Each says what it costs and when it applies,
    // so the loop below stays a loop rather than a chain of special cases.
    const TIERS = [
      { n: 1, name: 'scrapling', run: viaScrapling, when: () => true },
      { n: 2, name: 'browser',   run: viaBrowser,   when: () => true },
      // Only where a login recipe is configured; otherwise this tier is a
      // guaranteed failure and logging it as one would be noise, not signal.
      { n: 3, name: 'session',   run: viaSession,   when: () => !!config.session_site },
    ];

    for (const tier of TIERS) {
      if (!tier.when()) { record(tier.n, 'skipped', 0, 'no login configured'); continue; }

      const started = Date.now();
      let got;
      try {
        got = await tier.run();
      } catch (e) {
        record(tier.n, refusalOutcome(e), 0, String(e.message || e).slice(0, 200), Date.now() - started);
        continue;
      }

      html = got || '';
      const parsed = s.method === 'rss' ? parseFeed(html, target) : parseIndex(html, target);
      if (parsed && parsed.length) {
        raw = parsed;
        via = tier.name;
        record(tier.n, 'success', parsed.length, null, Date.now() - started);
        break;
      }
      // Retrieved but unreadable: keep the HTML for the model and escalate.
      record(tier.n, 'empty', 0, 'retrieved ' + html.length + ' bytes, parser found nothing', Date.now() - started);
    }

    // Tier 4. The page came back, so the site is not the problem — our reader
    // simply does not recognise this markup. Rather than add another
    // site-specific selector to a pile that silently rots, ask the model the
    // question a person would ask: which of these links are stories? Only ever
    // runs when every retrieval tier failed to parse, so the cost is bounded to
    // genuinely broken sources.
    if ((!raw || !raw.length) && html) {
      const started = Date.now();
      const h = await hermesExtract({ html, baseUrl: target, http: helpers.httpRequest });
      if (h.articles.length) {
        raw = h.articles.map(a => ({ title: a.title, url: a.url, published_at: null }));
        via = (via === 'http' ? 'hermes' : via + '+hermes');
        record(4, 'success', h.articles.length, null, Date.now() - started);
      } else {
        record(4, 'empty', 0, h.reason || null, Date.now() - started);
      }
    } else if (!html) {
      record(4, 'skipped', 0, 'no page was retrieved to read');
    } else {
      record(4, 'skipped', 0, 'an earlier tier succeeded');
    }

    // Tiers after the winner never ran. Saying so explicitly is the difference
    // between "we stopped because we had what we needed" and "we never tried".
    for (const tier of TIERS) {
      if (!attempts.some(a => a.tier === tier.n)) record(tier.n, 'skipped', 0, 'an earlier tier succeeded');
    }

    const all = normalise(raw || [], { id: s.id, config });

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

  // via records which tier actually produced the page. Without it a source that
  // has quietly fallen back to the model every hour looks identical to a healthy
  // one, and the whole point of the ladder is that degradation stays visible.
  const won = attempts.find(a => a.outcome === 'success');
  return { json: {
    source_id: s.id, slug: s.slug, status, error, articles, seen, via,
    satisfied_by_tier: won ? won.tier : null,
    attempts: attempts,
  } };
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
        // R015: a SELECT that matches nothing emits nothing, and the Code node
        // downstream of nothing never runs — the workflow stops dead on a quiet
        // cycle and reports success. It must keep talking even when empty.
        alwaysOutputData: true,
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
       s.email_authoritative,
       coalesce(k.urls, '[]'::json) AS known_urls,
       coalesce(n.recent, 0) AS email_articles_recent
FROM sources s
LEFT JOIN LATERAL (
  SELECT json_agg(u.url) AS urls
  FROM (SELECT url FROM articles WHERE source_id = s.id ORDER BY fetched_at DESC LIMIT 120) u
) k ON true
-- Tier 0 asks whether a NEWSLETTER has already delivered for this source, so the
-- ladder can stop before spending anything.
--
-- This must count newsletter deliveries, not articles. Counting articles was
-- wrong and briefly shipped: AFR is scraped for headlines as well as subscribed
-- to, so its own scraped rows satisfied the check and it reported "newsletter
-- delivered" on a day no newsletter had ever been processed — then skipped the
-- scrape on the strength of it. Ask the mail table, which only the email tier
-- writes to.
--
-- Scoped to the window: an edition from last fortnight does not excuse us today.
LEFT JOIN LATERAL (
  SELECT coalesce(sum(m.articles_kept), 0) AS recent
  FROM newsletter_messages m
  WHERE m.source_slug = s.slug
    AND m.processed_at > now() - interval '20 hours'
) n ON true
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
  satisfied_by_tier = v.satisfied_by_tier,
  consecutive_failures = CASE WHEN v.status = 'ok' THEN 0 ELSE s.consecutive_failures + 1 END
FROM (SELECT * FROM json_to_recordset($1::json)
      AS x(source_id int, status text, error text, satisfied_by_tier smallint)) v
WHERE s.id = v.source_id`,
          options: { queryReplacement: '={{ JSON.stringify($json.statuses) }}' },
        },
      },
      {
        id: 'attempts', name: 'Record fetch attempts', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(800, 200),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // The per-tier log behind each verdict. This is what lets the dashboard
          // answer "was this route even tried?" rather than only "did it end ok?".
          query: `INSERT INTO fetch_attempts (source_id, tier, outcome, articles_found, detail, duration_ms)
SELECT source_id, tier, outcome::fetch_tier_outcome, articles_found, detail, duration_ms
FROM json_to_recordset($1::json) AS x(
  source_id int, tier smallint, outcome text,
  articles_found int, detail text, duration_ms int)`,
          // Named explicitly rather than $json: this node runs after the health
          // update, and a Postgres node emits its query result, not the payload
          // it was given. $json here would be the previous statement's output.
          options: { queryReplacement: '={{ $(\'Collect statuses\').first().json.attempts }}' },
        },
      },
      {
        id: 'statuses', name: 'Collect statuses', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(360, 200),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `const items = $input.all().map(i => i.json);
// Two payloads from one pass: the per-source verdict, and the flattened
// per-tier log behind it. Both go out as JSON strings because n8n's
// queryReplacement splits parameters on commas, and article titles are full of them.
const attempts = [];
for (const i of items) {
  for (const a of (i.attempts || [])) {
    attempts.push({
      source_id: i.source_id, tier: a.tier, outcome: a.outcome,
      articles_found: a.articles_found || 0,
      detail: a.detail || null, duration_ms: a.duration_ms,
    });
  }
}
return [{ json: {
  statuses: items.map(i => ({
    source_id: i.source_id, status: i.status, error: i.error || '',
    satisfied_by_tier: i.satisfied_by_tier === null || i.satisfied_by_tier === undefined ? null : i.satisfied_by_tier,
  })),
  attempts: JSON.stringify(attempts),
  attempt_count: attempts.length,
} }];`,
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
      // Health and the attempt log both hang off the same collected payload.
      // Sequential rather than parallel so a failure writing the log cannot leave
      // the verdict updated with no evidence behind it.
      'Collect statuses': { main: [[{ node: 'Record source health', type: 'main', index: 0 }]] },
      'Record source health': { main: [[{ node: 'Record fetch attempts', type: 'main', index: 0 }]] },
    },
  };
}

// ─── Workflow 2: Article Analysis ────────────────────────────────────────────

// Ranking is what makes the sheet readable: 68 sources produce far more than
// anyone wants at 5am, so each article gets a relevance score and the report
// takes the top of each section.
const ANALYSIS_PROMPT = `You are briefing BEXT, an Australian energy efficiency consultancy
working on EXISTING COMMERCIAL BUILDINGS. Victoria is their main market.

Their work is energy audits and feasibility studies, efficiency upgrades, building
decarbonisation roadmaps, electrification away from gas, business cases and
procurement, performance monitoring, and project delivery. Their clients are
commercial property owners, facility and asset managers, developers, government
organisations and institutional portfolios — offices, retail and shopping centres,
hotels, healthcare and aged care, education campuses, warehouses and logistics.

So the sharpest test is: could this change what they advise a building owner to do,
what a project costs, or what the rules require?

Score every article on the same test — how much it could change what a building
owner is advised to do, what a project costs, or what the rules require. Solar,
building performance and the wider energy market are all in scope and judged the
same way; a story is not worth more for being about solar, nor less for being
about the grid. Specificity and actionability decide the score, not the subject.

IN SCOPE — what their clients pay them to know about:
  - solar and PV: commercial and rooftop installations, behind-the-meter
    generation, batteries paired with solar, feed-in tariffs and export limits,
    grid connection and inverter standards, module supply and pricing, installed
    cost and payback, accreditation, and the rebates and schemes that fund them
  - energy efficiency, building performance, NABERS, Commercial Building Disclosure,
    the National Construction Code, GEMS and energy rating
  - distributed and consumer energy resources, virtual power plants, demand response
  - renewables generation, transmission, grid connection and market rule changes
  - Victorian schemes above all: Victorian Energy Upgrades, Solar Victoria,
    SEC Victoria, VicGrid, DEECA, Essential Services Commission
  - regulators acting on the market: AER, AEMC, AEMO, Clean Energy Regulator,
    ARENA, CEFC, ACCC where it concerns energy
  - climate and emissions policy, NGER, carbon reporting, corporate decarbonisation
  - grants and funding programs their clients could apply for
  - electrification of buildings and industry, gas substitution, heat pumps

OUT OF SCOPE — score these exactly 0 however reputable the source. A 0 is the one
score dropped from the sheet, so reserve it for articles with no energy, building
or climate bearing at all — genuinely the wrong subject, not merely weak:
  - mining and resource extraction that is not about energy supply
  - legislation with no energy, building or climate content — tax, industrial
    relations, foreign relations, health, tobacco, corporate governance
  - recruitment notices, graduate programs, award announcements, obituaries,
    conference and trade show promotion, routine agency housekeeping
  - general science or R&D funding with no energy or building application
  - civil construction, roads, bridges, water and transport unless the story is
    about their energy performance
  - opinion and personal essays carrying no regulatory, technical or market fact

Being on-topic is not the same as being useful. Two traps in particular:

  - A regulator publishing something does not make it a regulatory change. An
    AER or AEMC decision, determination, guideline, exemption or rule change is
    high value, and so is a speech or address signalling where regulation is
    heading, because that is what lets an adviser get ahead of it. A Q&A, an
    explainer restating existing process, a graduate program, an award or an
    annual report is not, however central that regulator is.

  - Early-stage laboratory research scores below 50 even when the subject is
    solar or storage. A new cell chemistry or a lab efficiency record changes
    nothing a consultant advises this year. Research earns 55 or more only when
    a practitioner could act on it now — a testing method they could use, a cost
    curve that changes a business case, a field trial with deployable results.

    A perovskite efficiency record in a laboratory is a solar story that changes
    nothing a consultant advises this year, and ranks accordingly. Ask what a
    client would do differently on Monday, not what the article is about.

A source being monitored does not make everything it publishes relevant. The
government and parliamentary feeds carry the whole of government, and most of it
has nothing to do with energy. Judge the article, never the publisher.

For each article below, return a JSON object with:
  id               the article id, unchanged
  summary          two sentences, plain English, what happened and why it matters to them
  relevance_score  0-100.
                     80-100  Australian regulatory change, Victorian schemes, market
                             rule changes, or funding they could act on this week
                     55-79   solid industry news they should know: projects, technology,
                             policy direction, credible research with practical bearing
                     20-54   tangential — real energy content but remote from their work,
                             or overseas news with no Australian read-across
                     1-19    weak but on-subject — thin energy/building content, routine
                             notices, marginal read-across. Kept in the full digest as
                             noise, not discarded
                     0       irrelevant — no energy, building or climate bearing at all
                             (see OUT OF SCOPE). This is the only score dropped
  topics           up to 4 short lowercase tags
  entities         named organisations, schemes or people mentioned

Be decisive. The one cut that matters is 0 versus 1 — is this the wrong subject
entirely, or merely weak but on-subject. Everything from 1 up is kept and ranked
by this number, so score honestly across the range; only a genuine 0 is dropped.

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
        // R015: a SELECT that matches nothing emits nothing, and the Code node
        // downstream of nothing never runs — the workflow stops dead on a quiet
        // cycle and reports success. It must keep talking even when empty.
        alwaysOutputData: true,
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
// Relevance is a filter, not just a sort order.
//
// Until 19 Aug 2026 this published everything from the prior day and used the
// score only in ORDER BY, so the sheet ran to 92 items and carried a tobacco
// bill scoring 0, a copper-gold project at 15 and a graduate recruitment notice
// at 20. The client asked for the non-industry items to be culled.
//
// The scorer was already right. On the day complained about, every item flagged
// as irrelevant scored 20 or less, and everything genuinely useful — the VNI
// West reversal at 92, the offshore wind auction at 85, the Mortlake BESS at 82,
// the bushfire outlook and the ENA regulator keynote at 60 — scored 55 or more.
// Nothing needed re-scoring; the judgement simply was not being applied.
//
// 50 sits in the empty band between those two groups. Tunable rather than
// hardcoded because the right cut depends on how the sheet reads over a few
// weeks, not on one day's data.
const REPORT_MIN_RELEVANCE = Number(process.env.REPORT_MIN_RELEVANCE || 50);
// A backstop against a genuinely abnormal day, not a way of shortening the
// sheet — the relevance floor already does that, cutting 92 items to 15.
//
// Set to 12 originally, which quietly cost the client articles: on 20 August
// eighteen items cleared the floor in Industry Updates and only twelve were
// printed, so six relevant pieces were dropped with no trace, including one
// scoring 60. A cap that bites in normal operation is not a backstop, it is an
// undocumented second filter.
const REPORT_MAX_PER_SECTION = Number(process.env.REPORT_MAX_PER_SECTION || 80);

// The email is a comprehensive 24-hour digest: everything from the covered day
// EXCEPT the irrelevant, listed down in full, no upper cap.
//
// The client drew the line precisely — scores 1 to 15 are noise and are not
// wanted; everything 16 and above is. So the floor is 16, not the card's 40. The
// scorer places genuinely off-topic material there and below: European heatwaves
// scored 5-15, foreign non-solar items likewise, and AEMO's menu pages ("Wholesale
// Electricity Market", "Gas Bulletin Board") that the scraper takes for stories.
// Everything at 16+ — including the weak-but-on-topic 20-39 band, a China solar
// export figure, an EV market piece — goes in.
//
// The card (BEXT — Daily News Card) stays curated at 40; only the email goes wide.
const REPORT_EMAIL_MIN = Number(process.env.REPORT_EMAIL_MIN || 1);

const REPORT_SELECT = `
WITH win AS (
  SELECT date_trunc('day', now() AT TIME ZONE 'Australia/Melbourne')
           - interval '1 day' AS day_start
),
ranked AS (
  SELECT a.id, a.url, a.title,
         -- The publisher's own lead image, where they declare one. Carried here
         -- so the card layout has artwork, and image_state so an item without a
         -- picture is explicable rather than looking like a rendering fault.
         a.image_url, a.image_state::text AS image_state,
         -- What the sheet prints beside each item. published_at where the source
         -- gives one, otherwise when we first saw it; date_is_exact says which,
         -- so the sheet never presents a fetch time as a publication date.
         coalesce(a.published_at, a.fetched_at) AS shown_at,
         (a.published_at IS NOT NULL)           AS date_is_exact,
         s.name AS source_name, s.category,
         coalesce(an.summary, '') AS summary,
         an.relevance_score,
         row_number() OVER (
           PARTITION BY s.category
           ORDER BY an.relevance_score DESC, a.published_at DESC NULLS LAST
         ) AS rn
  FROM articles a
  JOIN sources s          ON s.id = a.source_id
  -- An inner join, deliberately. An article with no analysis row has not been
  -- judged, and an unjudged article must not reach the client — that is how the
  -- noise got in. Analysis runs every 30 minutes, so anything from the prior day
  -- has been scored long before 05:00.
  JOIN article_analysis an ON an.article_id = a.id
  CROSS JOIN win w
  -- Only about a quarter of these sources publish a machine-readable date, so
  -- fall back to when we first saw the article. Ingest runs hourly, which keeps
  -- that within an hour of publication for the sources that omit it.
  WHERE (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')
          >= w.day_start
    AND (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')
          <  w.day_start + interval '1 day'
    AND an.relevance_score >= ${REPORT_EMAIL_MIN}
    -- Archive material discovered in bulk is not news of the day. Scraped
    -- listings rarely carry a date, so those articles fall back to fetched_at and
    -- read as published today; that holds while a source trickles and breaks the
    -- moment a parser fix unlocks a backlog. On 23 Aug 2026 one did, and forty
    -- Clean Energy Council articles from as far back as 2022 became eligible for
    -- the next morning's sheet. See migration 022.
    AND a.report_eligible
)
SELECT id, url, title, image_url, image_state, shown_at, date_is_exact, source_name, category,
       summary, relevance_score,
       -- Carried on every row so the footer can state coverage without a
       -- second query: how many sources are being pulled right now.
       (SELECT count(*) FROM sources WHERE active) AS sources_monitored
FROM ranked
-- The per-section cap is the only ceiling now, and it is a backstop against one
-- category flooding the page — not a length. The overall top-30 cap was removed
-- when the email became a comprehensive digest: the client asked for everything
-- above the filter, listed down, so a busy day is no longer truncated.
WHERE rn <= ${REPORT_MAX_PER_SECTION}
ORDER BY category, relevance_score DESC, shown_at DESC`;

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
        id: 'deliv', name: 'Check deliverability', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(170, 180),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `
// Why this exists: the sheet spent weeks in Gmail's spam folder while every
// dashboard read healthy, because "the workflow ran" is not "the mail arrived".
// These are the settings that decide whether a receiver trusts the message, and
// they now travel with the report so a regression is visible the next morning.
//
// DNS over HTTPS rather than require('dns') — the Code sandbox exposes only the
// modules in NODE_FUNCTION_ALLOW_BUILTIN.
const http = this.helpers.httpRequest;
const DOMAIN = String($env.REPORT_SENDER || '').split('@')[1] || '';

const lookup = async (name, type) => {
  try {
    const r = await http({
      method: 'GET', url: 'https://dns.google/resolve',
      qs: { name: name, type: type }, json: true, timeout: 15000,
    });
    return (r.Answer || []).map(a => String(a.data || '').replace(/^"|"$/g, ''));
  } catch (e) { return []; }
};

const checks = [];
if (!DOMAIN) {
  checks.push({ name: 'sender', ok: false, detail: 'REPORT_SENDER not set' });
} else {
  const spf = (await lookup(DOMAIN, 'TXT')).find(t => /^v=spf1/i.test(t)) || '';
  checks.push({
    name: 'SPF',
    ok: /-all/.test(spf) && /mailchannels|ip4:/i.test(spf),
    detail: spf ? (/-all/.test(spf) ? 'published, hard fail' : 'published, soft ~all') : 'MISSING',
  });

  const dmarc = (await lookup('_dmarc.' + DOMAIN, 'TXT')).find(t => /^v=DMARC1/i.test(t)) || '';
  checks.push({
    name: 'DMARC', ok: !!dmarc,
    detail: dmarc ? (/rua=/.test(dmarc) ? 'published with reporting' : 'published, no reporting') : 'MISSING',
  });

  const dkim = (await lookup('default._domainkey.' + DOMAIN, 'TXT')).join('');
  checks.push({ name: 'DKIM', ok: /v=DKIM1/i.test(dkim), detail: /v=DKIM1/i.test(dkim) ? 'key published' : 'MISSING' });

  const mx = await lookup(DOMAIN, 'MX');
  // A sending domain that cannot receive mail is a long-standing spam heuristic,
  // and it also means every reply to the sheet disappears.
  checks.push({ name: 'MX', ok: mx.length > 0, detail: mx.length ? 'can receive replies' : 'MISSING — replies vanish' });
}

const failed = checks.filter(c => !c.ok);
const line = checks.map(c => c.name + ' ' + (c.ok ? 'ok' : 'FAIL')).join(' · ');
// Carry the input forward. This node sits mid-chain between the brief and the
// renderer, and returning only its own fields silently dropped the entire report
// — sections, item_count, recipient — so Render HTML received a payload with no
// articles in it and died on sections.map. Four consecutive scheduled runs
// errored or crashed that way before anyone looked at an execution.
//
// A node inserted into a pipeline has to pass through what it did not produce.
return [{ json: Object.assign({}, $input.first().json, {
  deliverability: line,
  deliverability_ok: failed.length === 0,
  deliverability_detail: checks.map(c => c.name + ': ' + c.detail).join(' | '),
}) }];
`,
        },
      },
      {
        id: 'images', name: 'Fetch article images', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(140, 0),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `
// The Code sandbox withholds URL as a global; it has to be destructured from
// the url builtin or new URL() throws ReferenceError at runtime.
const { URL } = require('url');
// Lead artwork for the card layout, taken from each publisher's own og:image.
//
// Only the articles that reached the sheet are looked up — a few dozen a day
// rather than the couple of hundred ingested — and the result is written back so
// tomorrow's run does not repeat the work. A page we cannot read simply has no
// picture; the card layout is built to look right without one, because a good
// third of government and industry sites publish no og:image at all.
const d = $input.first().json;
const sections = d.sections || [];
const all = sections.flatMap(s => s.items || []);
const need = all.filter(a => !a.image_url && a.image_state !== 'none' && a.image_state !== 'blocked');

const SCRAPLING = 'http://scrapling:8090/fetch';
const helpers = this.helpers;

const pick = (html, base) => {
  // og:image first, then twitter:image. Property and content appear in either
  // order depending on the CMS, so both arrangements are matched.
  const pats = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m && m[1]) {
      try { return new URL(m[1].trim(), base).toString(); } catch (e) { /* skip */ }
    }
  }
  return null;
};

const updates = [];
const limit = 12;
const queue = need.slice(0, 60);   // a hard ceiling, so an odd day cannot stall the 05:00 send

await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
  while (queue.length) {
    const a = queue.shift();
    try {
      const r = await helpers.httpRequest({
        method: 'POST', url: SCRAPLING, json: true, timeout: 30000,
        body: { url: a.url, include_html: true, timeout: 20 },
      });
      if (!r || !r.ok) { updates.push({ url: a.url, image_url: null, image_state: 'blocked' }); continue; }
      const img = pick(r.html || '', a.url);
      a.image_url = img;
      updates.push({ url: a.url, image_url: img, image_state: img ? 'found' : 'none' });
    } catch (e) {
      updates.push({ url: a.url, image_url: null, image_state: 'blocked' });
    }
  }
}));

const found = updates.filter(u => u.image_state === 'found').length;
return [{ json: Object.assign({}, d, {
  sections,
  image_updates: JSON.stringify(updates),
  image_summary: found + ' of ' + all.length + ' items have artwork',
}) }];
`,
        },
      },
      {
        id: 'saveimages', name: 'Save article images', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(140, 200),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // Written back so a rerun, or tomorrow's sheet carrying the same story,
          // costs nothing.
          query: `UPDATE articles a SET image_url = v.image_url,
       image_state = v.image_state::article_image_state
FROM (SELECT * FROM json_to_recordset($1::json)
      AS x(url text, image_url text, image_state text)) v
WHERE a.url = v.url`,
          options: { queryReplacement: '={{ $json.image_updates }}' },
        },
      },
      {
        id: 'render', name: 'Render HTML', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(280, 0),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: `
const d = $input.first().json;
// Carried from the deliverability node so the footer can state, every morning,
// whether the settings that decide inbox placement are still in order.
let deliv = 'not checked', delivOk = true;
try {
  const dc = $("Check deliverability").first().json;
  deliv = dc.deliverability || deliv;
  delivOk = dc.deliverability_ok !== false;
} catch (e) { /* the sheet must go out even if the check did not run */ }
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
//
// The layout is a card grid, and it is built from nested tables rather than CSS
// grid or flexbox. That is not a stylistic choice: Outlook renders through Word,
// which supports neither, and a flexbox grid there collapses into one column of
// full-width images. Tables are the only construct every mail client agrees on.
//
// Two cards per row. Three fits the eye on a wide screen but leaves roughly
// 200px per card at the 680px width mail clients allow, which is too narrow for
// a headline plus a source line.
const CARDS_PER_ROW = 2;

// The category strip that stands in for a photograph.
//
// Most days the majority of items are regulators — GEMS, NABERS, the AER, the
// Minister's office — and none of them publish an og:image. A card that simply
// omits the picture ends up shorter than its neighbour, so rows do not line up
// and the sheet reads as half-finished. A tinted panel carrying the publisher's
// name fills the same space deliberately.
const artPanel = (a) => {
  const tone = { 'Australian News': '#0f766e', 'Industry Updates': '#1e40af',
                 'International Industry Updates': '#7c3aed' }[a.category] || '#0f766e';
  return \`
    <div style="height:132px;background:\${tone};border-radius:5px 5px 0 0;
                mso-line-height-rule:exactly;line-height:132px;text-align:center">
      <span style="font:600 12px Arial,sans-serif;letter-spacing:.08em;
                   text-transform:uppercase;color:#ffffff;opacity:.92">\${esc(a.source_name)}</span>
    </div>\`;
};

const art = (a, h) => (a.image_url
  ? \`<a href="\${esc(a.url)}" style="text-decoration:none"><img src="\${esc(a.image_url)}"
       width="100%" alt="" style="display:block;width:100%;max-width:100%;height:\${h}px;
       object-fit:cover;border-radius:5px 5px 0 0;background:#e5e7eb"></a>\`
  : artPanel(a));

const meta = (a) => \`
  <div style="font:11px/1.4 Arial,sans-serif;color:#9ca3af;margin:6px 0 7px">
    \${esc(a.source_name)} · \${esc(itemDate(a))}
  </div>\`;

const headline = (a, size) => \`
  <a href="\${esc(a.url)}" style="font:600 \${size}px/1.35 Arial,sans-serif;color:#0f766e;
     text-decoration:none">\${esc(a.title)}</a>\`;

const summary = (a, size) => (a.summary
  ? \`<div style="font:\${size}px/1.55 Arial,sans-serif;color:#374151">\${esc(a.summary)}</div>\`
  : '');

const SHELL = 'border:1px solid #e5e7eb;border-radius:6px;background:#fff';

/** Half-width card, used when two sit side by side. */
const card = (a) => \`
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="\${SHELL}">
    <tr><td>\${art(a, 132)}</td></tr>
    <tr><td style="padding:13px 15px 16px">
      \${headline(a, 14)}\${meta(a)}\${summary(a, 12)}
    </td></tr>
  </table>\`;

/**
 * Full-width card: picture beside the text rather than above it.
 *
 * Used for a section holding a single item, and for the odd item at the end of a
 * section. Previously those rendered as a half-width card with an empty cell
 * next to them, which is what made the sheet look unfinished — a lone story with
 * dead space beside it reads as a layout that failed, not a layout that chose.
 */
const wideCard = (a) => \`
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="\${SHELL}">
    <tr>
      \${a.image_url ? \`<td valign="top" width="220" style="width:220px">
        <a href="\${esc(a.url)}" style="text-decoration:none"><img src="\${esc(a.image_url)}"
           width="220" alt="" style="display:block;width:220px;height:100%;min-height:150px;
           object-fit:cover;border-radius:6px 0 0 6px;background:#e5e7eb"></a>
      </td>\` : \`<td valign="top" width="6" style="width:6px;background:#0f766e;
                  border-radius:6px 0 0 6px">&nbsp;</td>\`}
      <td valign="top" style="padding:15px 18px 17px">
        \${headline(a, 15)}\${meta(a)}\${summary(a, 12.5)}
      </td>
    </tr>
  </table>\`;

const grid = (items) => {
  const rows = [];
  for (let i = 0; i < items.length; i += CARDS_PER_ROW) {
    const pair = items.slice(i, i + CARDS_PER_ROW);
    if (pair.length === 1) {
      // A lone card spans the table instead of leaving a hole beside it.
      rows.push(\`<tr><td colspan="\${CARDS_PER_ROW}" style="padding:0 0 14px">
        \${wideCard(pair[0])}</td></tr>\`);
      continue;
    }
    rows.push(\`<tr>\` + pair.map((a, n) => \`
      <td valign="top" width="50%" style="padding:0 \${n === 0 ? '7px' : '0'} 14px \${n === 0 ? '0' : '7px'}">
        \${card(a)}
      </td>\`).join('') + \`</tr>\`);
  }
  return \`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="width:100%;table-layout:fixed">\${rows.join('')}</table>\`;
};

const body = d.empty
  ? '<p style="color:#6b7280">No qualifying articles published on this day.</p>'
  : d.sections.map(sec => \`
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
             style="margin:30px 0 14px">
        <tr>
          <td style="border-bottom:2px solid #14b8a6;padding-bottom:7px">
            <span style="font:600 15px/1.3 Arial,sans-serif;color:#111827">\${esc(sec.name)}</span>
          </td>
          <td align="right" style="border-bottom:2px solid #14b8a6;padding-bottom:7px">
            <span style="font:11px/1.3 Arial,sans-serif;color:#9ca3af">\${sec.items.length} item\${sec.items.length === 1 ? '' : 's'}</span>
          </td>
        </tr>
      </table>
      \` + grid(sec.items)
    ).join('');

const html = \`<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6">
<div style="max-width:860px;margin:0 auto;background:#fff;padding:28px 32px">
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
    <br>Delivery: \${esc(deliv)}\${delivOk ? '' : ' — this sheet may be filtered; see docs/INFRASTRUCTURE.md'}
    Grants / Funding and LinkedIn sections are covered in a separate report.
  </div>
</div></body></html>\`;

// The plain-text alternative. Not a courtesy: a message with only an HTML part
// is a long-standing bulk-mail signal, and some clients render this instead.
const text = d.empty
  ? 'No qualifying articles published on this day.'
  : [
      'BEXT CONSULTANCY - INDUSTRY DAILY',
      coverage,
      d.item_count + ' items across ' + d.sections.length + ' sections',
      d.intro ? '\\n' + d.intro : '',
    ].concat(d.sections.map(sec =>
      '\\n' + sec.name.toUpperCase() + '\\n' +
      sec.items.map(a =>
        '- ' + a.title + '\\n  ' + a.source_name + ' - ' + itemDate(a) +
        (a.summary ? '\\n  ' + a.summary : '') + '\\n  ' + a.url
      ).join('\\n\\n')
    )).concat([ '\\nGenerated automatically from ' + (d.sources_monitored || 0) +
      ' monitored sources.' ]).filter(Boolean).join('\\n');

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
return [{ json: { html, text, items, subject: 'BEXT Industry Daily — ' + coverage,
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
          // A display name rather than a bare address. Mail from a naked machine
          // address reads as automated to a filter and to a person.
          fromEmail: '={{ "BEXT Consultancy <" + $env.REPORT_SENDER + ">" }}',
          toEmail: '={{ $("Render HTML").first().json.recipient }}',
          subject: '={{ $("Render HTML").first().json.subject }}',
          // Both parts, not HTML alone. A single-part text/html message with no
          // plain-text alternative is one of the oldest bulk-mail signals there is,
          // and the sheet reads perfectly well as text.
          emailFormat: 'both',
          text: '={{ $("Render HTML").first().json.text }}',
          html: '={{ $("Render HTML").first().json.html }}',
          options: {
            // Replies went to a mailbox on a domain with no MX record, so they
            // vanished. Point them at one someone actually reads.
            replyTo: '={{ $env.REPORT_REPLY_TO || $env.MS_SENDER_UPN }}',
          },
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
      'Hermes writes the brief': { main: [[{ node: 'Check deliverability', type: 'main', index: 0 }]] },
      // Artwork is looked up after the items are chosen, so only what reaches the
      // sheet costs a fetch, and written back before rendering so a rerun is free.
      'Check deliverability': { main: [[{ node: 'Fetch article images', type: 'main', index: 0 }]] },
      'Fetch article images': {
        main: [[
          { node: 'Save article images', type: 'main', index: 0 },
          { node: 'Render HTML', type: 'main', index: 0 },
        ]],
      },
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

  // Every mailbox that could host a meeting must answer getAllTranscripts.
  // Meeting Intake's discovery skips an unreadable host with a bare continue
  // and still reports success, so one lapsed Teams application access policy
  // makes that person's meetings vanish with nothing going red. R031.
  const HOSTS = ($env.MEETING_HOSTS || UPN).split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
  const seenTranscripts = [];
  for (const host of HOSTS) {
    await step('transcripts readable: ' + host, async () => {
      const hu = await graph('/users/' + encodeURIComponent(host) + '?$select=id');
      const tr = await graph('/users/' + hu.id + '/onlineMeetings/getAllTranscripts('
        + 'meetingOrganizerUserId=' + encodeURIComponent("'" + hu.id + "'") + ')');
      for (const t of (tr.value || [])) seenTranscripts.push(t);
      return (tr.value || []).length + ' transcript(s) visible';
    });
  }

  // The reconciliation. Everything above asks "would it work?"; this asks the
  // only question that matters — did every meeting Graph can see actually get
  // minuted? It is the check that would have caught the recurring-meeting bug
  // (R030) the next morning instead of a week later, because the failure there
  // was a transcript sitting in Graph with no row and every run green.
  await step('every transcript is minuted', async () => {
    const done = new Set($input.all()
      .map(function (i) { return i.json.transcript_id; }).filter(Boolean));
    const GRACE_MS = 30 * 60000;          // a run in flight is not a miss
    const WINDOW_MS = 7 * 24 * 3600000;   // matches MEETING_LOOKBACK_HOURS
    const missing = seenTranscripts.filter(function (t) {
      const age = Date.now() - new Date(t.createdDateTime).getTime();
      return age > GRACE_MS && age < WINDOW_MS && !done.has(t.id);
    });
    if (missing.length) {
      const oldest = missing.map(function (m) { return m.createdDateTime; }).sort()[0];
      throw new Error(missing.length + ' transcript(s) with no minutes - oldest ' + oldest);
    }
    return seenTranscripts.length + ' transcript(s) all accounted for';
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
        id: 'seen', name: 'Load minuted transcripts', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-200, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        // alwaysOutputData, because a node emitting no items stops the workflow
        // dead (R015) and an empty table is the normal state of a new install.
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          query: `SELECT transcript_id FROM meeting_minutes
 WHERE transcript_id IS NOT NULL
   AND created_at > now() - interval '30 days'`,
          options: {},
        },
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
      'Daily 06:00': { main: [[{ node: 'Load minuted transcripts', type: 'main', index: 0 }]] },
      'Load minuted transcripts': { main: [[{ node: 'Check Graph', type: 'main', index: 0 }]] },
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
// URL as well as URLSearchParams: the sandbox withholds both, and putBinary
// parses the upload address with new URL(). Destructuring only URLSearchParams
// left every upload throwing ReferenceError, which put() swallowed into
// failures -- so the visible symptom was a 404 on a folder nothing had created.
const { URLSearchParams, URL } = require('url');

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
const ALREADY_SENT = new Set(
  inputRows.filter(r => r.kind === 'sent').map(r => r.a).filter(Boolean));
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
// A host we cannot read is not the same as a host with no meetings, and the two
// used to be indistinguishable: both took a bare continue and the run reported
// success. One lapsed Teams application access policy would silently retire a
// person's entire meeting history. Collected here and judged after the loop.
const hostErrors = [];
for (const upn of ORGANISERS) {
  let org;
  try { org = await graph('/users/' + encodeURIComponent(upn) + '?$select=id,displayName'); }
  catch (e) { hostErrors.push(upn + ': ' + String(e.message || e).slice(0, 120)); continue; }
  let list;
  try {
    list = await graph('/users/' + org.id + '/onlineMeetings/getAllTranscripts('
      + 'meetingOrganizerUserId=' + encodeURIComponent("'" + org.id + "'") + ')');
  } catch (e) { hostErrors.push(upn + ': ' + String(e.message || e).slice(0, 120)); continue; }
  for (const t of (list.value || [])) {
    if (Date.now() - new Date(t.createdDateTime).getTime() > WINDOW_MS) continue;
    // Keyed on the TRANSCRIPT, not the meeting. A recurring series reuses one
    // meetingId across every occurrence, so keying on that marked occurrence 2
    // as already done and skipped it forever — silently, because a skipped
    // candidate is not an error. See docs/REGRESSIONS.md R030.
    if (done.has(t.id)) continue;
    candidates.push({
      organiserId: org.id, organiserUpn: upn, organiserName: org.displayName,
      transcriptId: t.id, meetingId: t.meetingId, createdDateTime: t.createdDateTime,
    });
  }
}

// Every host unreadable means discovery learned nothing, and returning an empty
// list would report that as "no new meetings" — the failure this whole pipeline
// keeps making. Nothing downstream is lost by throwing, because there are no
// candidates to lose. A PARTIAL failure carries on, and BEXT — Graph Health
// reconciles it against Graph within the day (R031).
if (hostErrors.length === ORGANISERS.length && ORGANISERS.length > 0) {
  throw new Error('no meeting host is readable - ' + hostErrors.join(' | '));
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

    // Every upload is caught into failures rather than thrown, so that a bad
    // write does not cost the draft. The consequence is that when they ALL fail,
    // the next thing to touch the folder is this lookup — which 404s, because
    // nothing created it. That 404 is what gets recorded, and it describes a
    // missing folder rather than the upload errors that are the actual fault.
    //
    // Surface the real reasons here, before the misleading symptom.
    if (failures.length) {
      throw new Error('filing failed (' + failures.length + '): ' + failures.join(' | ').slice(0, 400));
    }

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
    if (SEND_TO && ALREADY_SENT.has(cand.transcriptId)) {
      // Reprocessed for some other reason — refile the documents, but do not mail
      // the client a second copy of the same minutes. Not a failure: the record is
      // fine and the card should still post. sent_at is left null here and the
      // upsert coalesces it, so the original send time survives.
      sentAt = null;
    } else if (SEND_TO) {
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
      transcript_id: cand.transcriptId,
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
      transcript_id: cand.transcriptId,
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
          // The exclusion window MUST be at least as long as the discovery window.
          //
          // Discovery looks back MEETING_LOOKBACK_HOURS (7 days). This list used
          // to look back 3. Anything between the two aged out of "already done"
          // while still being discoverable, so it was reprocessed on every tick —
          // refiling the documents, reposting the card, and re-sending the minutes
          // email to the client every fifteen minutes. Eight went out before it
          // was caught.
          //
          // 90 days is deliberately far beyond any plausible discovery window, so
          // widening the lookback again cannot reopen this. The list stays small
          // because it holds ids, not rows.
          // Both lists key on transcript_id, NOT meeting_id. A recurring series
          // shares one meeting_id across occurrences, so a meeting_id exclusion
          // list retires the whole series after its first occurrence — which is
          // exactly what happened to the 25 Aug weekly. R030.
          query: `SELECT 'done' AS kind, transcript_id AS a, NULL::text AS b, NULL::text AS c,
                         NULL::text[] AS d
  FROM meeting_minutes
 WHERE status <> 'failed'
   AND transcript_id IS NOT NULL
   AND created_at > now() - interval '90 days'
UNION ALL
-- Every meeting whose minutes email has already gone out, whatever its status.
-- This is the backstop: the window arithmetic above can be wrong again, but a
-- client must never receive the same minutes twice.
SELECT 'sent', transcript_id, NULL, NULL, NULL::text[]
  FROM meeting_minutes WHERE sent_at IS NOT NULL AND transcript_id IS NOT NULL
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
  (transcript_id, meeting_id, subject, organiser_upn, started_at, ended_at, attendees, status,
   transcript_path, minutes_path, draft_message_id, extracted, model, error,
   folder_url, minutes_url, summary_url, transcript_url, posted_at, post_error,
   minutes_pdf_url, summary_pdf_url, transcript_pdf_url, sent_at)
SELECT transcript_id, meeting_id, subject, organiser_upn, started_at, ended_at,
       coalesce(attendees, '{}'), status::minutes_status,
       transcript_path, minutes_path, draft_message_id, extracted, model, error,
       folder_url, minutes_url, summary_url, transcript_url, posted_at, post_error,
       minutes_pdf_url, summary_pdf_url, transcript_pdf_url, sent_at
FROM json_to_recordset($1::json) AS x(
  transcript_id text, meeting_id text, subject text, organiser_upn text,
  started_at timestamptz, ended_at timestamptz, attendees text[], status text,
  transcript_path text, minutes_path text, draft_message_id text,
  extracted jsonb, model text, error text,
  folder_url text, minutes_url text, summary_url text, transcript_url text,
  minutes_pdf_url text, summary_pdf_url text, transcript_pdf_url text, sent_at timestamptz,
  posted_at timestamptz, post_error text)
-- Conflict on transcript_id (migration 013), because meeting_id is no longer
-- unique: a recurring series reuses it for every occurrence.
--
-- The index is PARTIAL (WHERE transcript_id IS NOT NULL), which lets the
-- dropped-file path carry a null id. Postgres will not match a partial index
-- unless the inference repeats its predicate, so omitting the WHERE here fails
-- with "no unique or exclusion constraint matching the ON CONFLICT specification".
ON CONFLICT (transcript_id) WHERE transcript_id IS NOT NULL DO UPDATE SET
  status = EXCLUDED.status, minutes_path = EXCLUDED.minutes_path,
  meeting_id = EXCLUDED.meeting_id,
  draft_message_id = EXCLUDED.draft_message_id, extracted = EXCLUDED.extracted,
  error = EXCLUDED.error, folder_url = EXCLUDED.folder_url,
  minutes_url = EXCLUDED.minutes_url, summary_url = EXCLUDED.summary_url,
  minutes_pdf_url = EXCLUDED.minutes_pdf_url,
  summary_pdf_url = EXCLUDED.summary_pdf_url,
  transcript_pdf_url = EXCLUDED.transcript_pdf_url,
  -- Never clear a send that already happened: a later reprocess writes null here,
  -- and overwriting would re-arm the duplicate-send guard that reads this column.
  sent_at = COALESCE(EXCLUDED.sent_at, meeting_minutes.sent_at),
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

// ─── Workflow 8: Self Heal ───────────────────────────────────────────────────
//
// Rings 1 and 2 of docs/SELF-HEALING.md, in the half that n8n can do to itself.
//
// What it may do here: classify a failed execution, log it, retry it, reactivate
// a workflow, and post the rest to Teams with the diagnosis already written.
//
// What it deliberately cannot do here: restart a container, push workflow JSON
// from the repo, or touch the host. Those need child_process and docker, and the
// only way to give a Code node docker is to mount /var/run/docker.sock into
// bext-n8n — which is root on a host that also runs Premier Fitness. Refused.
// n8n/self-heal.js does those, under an operator's SSH key, with an explicit
// container allowlist. Same rules file, same incident table, same ids.

const SELF_HEAL_CODE = `
// The sandbox withholds URL and URLSearchParams as globals (R001, R002b).
const { URL, URLSearchParams } = require('url');

// --- shared rules ---
${HEAL_RULES_SRC}
// --- end shared rules ---

// The code runs inside the n8n container, so it calls its own API on loopback.
// $env.N8N_URL is not set in the container (it has N8N_HOST / WEBHOOK_URL), and
// going out to the public host would round-trip through traefik and TLS for no
// reason. localhost:5678 is where n8n listens (N8N_PORT).
const base = 'http://localhost:5678';
const key = $env.N8N_API_KEY;
if (!key) throw new Error('N8N_API_KEY is not set in the container — see infra/docker-compose.yml');

// The Code sandbox does not expose fetch, and the http builtin is not on the
// allow-list (NODE_FUNCTION_ALLOW_BUILTIN is crypto,url,https,dns) — so a plain
// HTTP client is out. n8n's own helper is the way to make an HTTP call from a
// Code node, the same as every other workflow in this repo. It returns the
// parsed body and throws on a non-2xx, so there is no .ok/.json() to handle.
const helpers = this.helpers;
const api = async (route, init) => {
  init = init || {};
  return helpers.httpRequest({
    method: init.method || 'GET',
    url: base + '/api/v1/' + route,
    headers: Object.assign({ 'X-N8N-API-KEY': key, 'Content-Type': 'application/json' }, init.headers || {}),
    body: init.body ? JSON.parse(init.body) : undefined,
    json: true,
  });
};

// workflow name -> id, so validation can look up a workflow's later runs.
const wfList = await api('workflows?limit=100');
const idByName = {};
for (const w of (wfList.data || [])) idByName[w.name] = w.id;

const out = [];

// ── VALIDATION PASS — did last cycle's action actually work? ─────────────────
// The prior cycle recorded its actions as 'attempted', never 'healed'. An action
// is only healed if the thing it fixed recovered: for retry_execution and
// reactivate_workflow that means the workflow produced a SUCCESSFUL run AFTER the
// incident (EXECUTIONS_DATA_SAVE_ON_SUCCESS is 'all', so successes are visible).
// Not yet recovered → wait, re-checked next cycle, up to a ceiling; past it, give
// up and escalate. The healer validates its own work rather than trusting it —
// which is the whole reason the two sandbox faults that shipped green were caught
// only by a live run.
const GIVE_UP_MIN = 120;
// Every incident seen in the last 6 hours. seen is the dedup set for detection
// below; pending is the subset still awaiting validation (attempted, and old
// enough that a retried run has had time to happen).
const recent = $input.all().map(i => i.json).filter(r => r && r.execution_id);
const seen = new Set(recent.map(r => String(r.execution_id)));
// Workflows already escalated in the window. A persistently broken workflow throws a
// fresh execution id every cycle, which would escalate every cycle even though the
// execution-level dedup holds. So a repeat failure of an already-flagged workflow is
// still RECORDED (the dashboard should show the frequency) but not re-posted to Teams.
const escalatedWorkflows = new Set(recent.filter(r => r.action === 'escalate').map(r => r.workflow));
const pending = recent.filter(r => r.id && r.outcome === 'attempted'
  && (Date.now() - new Date(r.detected_at).getTime()) / 60000 > 3);
for (const p of pending) {
  const ageMin = (Date.now() - new Date(p.detected_at).getTime()) / 60000;
  const wfId = idByName[p.workflow];
  let recovered = false;
  if (wfId) {
    const ok = await api('executions?workflowId=' + wfId + '&status=success&limit=1&includeData=false');
    const newest = (ok.data || [])[0];
    recovered = !!(newest && new Date(newest.startedAt).getTime() > new Date(p.detected_at).getTime());
  }
  if (recovered) {
    out.push({ json: { id: p.id, validated: true, outcome: 'healed', workflow: p.workflow,
      execution_id: p.execution_id, rule_id: p.rule_id, signature: p.signature, action: p.action,
      hint: null, detail: (p.detail || '') + ' | validated: recovered' } });
  } else if (ageMin > GIVE_UP_MIN) {
    // The action did not hold. Flip to escalate so a human is told the fix failed.
    out.push({ json: { id: p.id, validated: true, outcome: 'failed', workflow: p.workflow,
      execution_id: p.execution_id, rule_id: p.rule_id, signature: p.signature, action: 'escalate',
      hint: null, detail: (p.detail || '') + ' | validated: did NOT recover after ' + Math.round(ageMin) + ' min' } });
  }
  // else: still inside the grace window — leave it 'attempted', re-check next cycle.
}

// ── DETECTION + ACTION PASS ──────────────────────────────────────────────────
// Only failures. EXECUTIONS_DATA_SAVE_ON_ERROR is 'all', so this list is complete
// for failures — and blind to a workflow that ran clean and produced nothing.
// That blindness is why the heartbeat monitors exist; do not infer an outage from
// an empty list here. Doing exactly that is R015, walked into twice per R024.
const runs = await api('executions?status=error&limit=50&includeData=false');
const cutoff = Date.now() - 60 * 60 * 1000;
// One action per pass. The healer nudges; it does not thrash.
let acted = 0;

for (const e of (runs.data || [])) {
  const at = new Date(e.stoppedAt || e.startedAt).getTime();
  if (at < cutoff) continue;
  // Already recorded this execution in the last 6 hours — do not detect, act, or
  // escalate it again. This is what stops the same failure being re-posted to Teams
  // every 15 minutes.
  if (seen.has(String(e.id))) continue;

  const workflowName = (e.workflowData && e.workflowData.name) || String(e.workflowId);
  const failure = {
    error: [e.error, e.message].filter(Boolean).join(' '),
    lastNodeExecuted: e.lastNodeExecuted,
    workflowName: workflowName,
  };
  const rule = classify(failure);

  // Anything the script owns (containers, redeploys, tokens) is named and handed
  // over, not attempted. Recognising a failure and being allowed to fix it are
  // different permissions.
  const runnable = { retry_execution: 1, reactivate_workflow: 1 };
  const action = rule && runnable[rule.action] ? rule.action : 'escalate';

  const row = {
    id: null, validated: false,
    workflow: workflowName, execution_id: String(e.id),
    rule_id: rule ? rule.id : null,
    signature: (failure.error || '').slice(0, 500),
    action: action, outcome: 'detected',
    detail: rule ? rule.title : 'unclassified — ring 3',
    hint: (rule && rule.hint) || null,
    // Notify only the first time a workflow is escalated in the window.
    notify: action !== 'escalate' || !escalatedWorkflows.has(workflowName),
  };
  if (action === 'escalate') escalatedWorkflows.add(workflowName);

  if (action !== 'escalate' && acted < 1) {
    acted += 1;
    row.outcome = 'attempted';
    try {
      if (action === 'retry_execution') {
        await api('executions/' + e.id + '/retry', { method: 'POST' });
        row.detail = 'retried execution ' + e.id + ' — validating next cycle';
      } else {
        // Activating through the API does not register the trigger until n8n
        // restarts. So this never claims success — the validation pass is what
        // promotes it to healed, by seeing the workflow actually run.
        await api('workflows/' + e.workflowId + '/activate', { method: 'POST' });
        row.detail = 'reactivated ' + workflowName + ' — validating next cycle';
      }
    } catch (err) {
      row.outcome = 'failed';
      row.detail = String(err.message).slice(0, 400);
      row.action = 'escalate';
    }
  } else if (action !== 'escalate') {
    row.outcome = 'suppressed';
    row.detail = 'one action per pass; next cycle';
  }

  out.push({ json: row });
}

return out.length ? out : [{ json: { id: null, validated: false, workflow: 'none',
  execution_id: null, rule_id: null, signature: null, action: 'escalate',
  outcome: 'detected', detail: 'nothing failed', hint: null } }];
`;

const SELF_HEAL_ESCALATE_CODE = `
const https = require('https');
const { URL } = require('url');

// Reads the healer's own output rows (branched straight from the code node, NOT
// from the Postgres node — that returns only counts, which is why the previous
// version silently posted nothing). Two things are news to a human:
//   - a freshly detected failure with no automatic action ('detected' + escalate)
//   - a fix that was attempted and did NOT hold ('failed', flipped by validation)
const rows = $input.all().map(i => i.json).filter(r =>
  r && r.workflow !== 'none' && r.action === 'escalate' && r.notify !== false &&
  (r.outcome === 'detected' || r.outcome === 'failed'));

if (!rows.length) return [{ json: { posted: 0 } }];

const hook = $env.TEAMS_DAILY_WEBHOOK_URL;
if (!hook) return [{ json: { posted: 0, note: 'no Teams webhook configured' } }];

const lines = rows.map(r => {
  const head = r.validated
    ? 'a fix was attempted and did not hold'
    : (r.rule_id ? r.rule_id + ' — ' + r.detail : 'unclassified — a failure mode with no rule yet');
  const fix = r.hint ? '\\n  Fix: ' + r.hint
    : (r.validated ? '' : '\\n  No known fix. Ring 3: diagnose it, then add the rule.');
  return '**' + r.workflow + '** (execution ' + r.execution_id + ')\\n  ' + head + fix
    + '\\n  ' + String(r.detail || r.signature || '').slice(0, 300);
});

const body = JSON.stringify({
  title: 'Self-heal: ' + rows.length + ' need you',
  text: lines.join('\\n\\n'),
});

await new Promise((resolve, reject) => {
  const u = new URL(hook);
  const req = https.request({
    hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, res => { res.resume(); res.on('end', resolve); });
  req.on('error', reject);
  req.write(body);
  req.end();
});

return [{ json: { posted: rows.length } }];
`;

// Loads every incident from the last 6 hours, for two jobs the code node does with
// it: VALIDATE the ones still 'attempted', and DEDUPE — an execution already recorded
// must not be re-detected and re-escalated every 15 minutes (the cry-wolf flood that
// trains people to ignore the channel). The 6h window bounds the row count; a failure
// older than that has long since been escalated or aged out. alwaysOutputData so a
// quiet cycle still passes one item on and the code node runs — R015.
const SELF_HEAL_LOAD_UNVALIDATED = `SELECT id, workflow, execution_id, rule_id, signature,
       action::text AS action, outcome::text AS outcome, detail,
       detected_at::text AS detected_at
  FROM incidents
 WHERE detected_at > now() - interval '6 hours'
   AND workflow <> 'none'
 ORDER BY detected_at DESC
 LIMIT 500`;

// One statement does both jobs: rows carrying an id are validation verdicts (UPDATE),
// rows without one are freshly detected incidents (INSERT, deduped on execution_id).
// The enum casts are not decoration — an uncast text into an enum column is R003, the
// failure that made Graph Health report seven failures and zero successes.
const SELF_HEAL_UPSERT = `WITH input AS (
  SELECT * FROM json_to_recordset($1::json) AS x(
    id bigint, workflow text, execution_id text, rule_id text,
    signature text, action text, outcome text, detail text)
),
upd AS (
  UPDATE incidents i
     SET outcome = x.outcome::incident_outcome,
         detail = x.detail,
         resolved_at  = CASE WHEN x.outcome IN ('healed','failed') THEN now() ELSE i.resolved_at END,
         escalated_at = CASE WHEN x.outcome = 'failed' THEN now() ELSE i.escalated_at END
    FROM input x
   WHERE x.id IS NOT NULL AND i.id = x.id
  RETURNING i.id
),
ins AS (
  INSERT INTO incidents (workflow, execution_id, rule_id, signature, action, outcome, detail)
  SELECT x.workflow, nullif(x.execution_id,''), nullif(x.rule_id,''), x.signature,
         x.action::heal_action, x.outcome::incident_outcome, x.detail
    FROM input x
   WHERE x.id IS NULL AND x.workflow <> 'none'
     AND NOT EXISTS (SELECT 1 FROM incidents i
                     WHERE x.execution_id IS NOT NULL AND i.execution_id = nullif(x.execution_id,''))
  RETURNING id
)
SELECT (SELECT count(*) FROM upd) AS validated, (SELECT count(*) FROM ins) AS created`;

function selfHealWorkflow() {
  return {
    name: 'BEXT — Self Heal',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'trigger', name: 'Every 15 minutes', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-560, 0), alwaysOutputData: true,
        parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } },
      },
      {
        id: 'pending', name: 'Load unvalidated', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-360, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        // Empty on a healthy cycle; alwaysOutputData so the code node still runs.
        alwaysOutputData: true,
        parameters: { operation: 'executeQuery', query: SELF_HEAL_LOAD_UNVALIDATED },
      },
      {
        id: 'heal', name: 'Classify, heal and validate', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(-140, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: SELF_HEAL_CODE },
      },
      {
        id: 'record', name: 'Record incidents', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(120, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery', query: SELF_HEAL_UPSERT,
          options: { queryReplacement: '={{ JSON.stringify($input.all().map(i => i.json)) }}' },
        },
      },
      {
        id: 'escalate', name: 'Escalate to Teams', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(120, 200),
        alwaysOutputData: true,
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: SELF_HEAL_ESCALATE_CODE },
      },
      heartbeat('KUMA_PUSH_SELF_HEAL', 360, 0),
    ],
    connections: {
      'Every 15 minutes': { main: [[{ node: 'Load unvalidated', type: 'main', index: 0 }]] },
      'Load unvalidated': { main: [[{ node: 'Classify, heal and validate', type: 'main', index: 0 }]] },
      // The code node's rows go to BOTH the recorder and the escalator. Escalate
      // must read the rows themselves, not the recorder's row-count output.
      'Classify, heal and validate': { main: [[
        { node: 'Record incidents', type: 'main', index: 0 },
        { node: 'Escalate to Teams', type: 'main', index: 0 },
      ]] },
      'Record incidents': { main: [[{ node: 'Heartbeat', type: 'main', index: 0 }]] },
    },
  };
}

// ─── Workflow 9: Contract Test ───────────────────────────────────────────────
//
// Catches at 02:00 what would otherwise be found at 05:00 by a client.
//
// n8n/preflight.js already asserts everything readable from the repo. This
// asserts the things only the running container can see, which is precisely
// where our worst failures have lived:
//
//   R014 — config that existed in .env, in the repo compose, everywhere except
//          the running container. MEETING_HOSTS was empty inside n8n for days.
//   R022 — a require() the sandbox blocks. Fine locally, dead at runtime.
//   R001 — a Code node that parses on a laptop and throws in the sandbox.
//
// It reads and reports. It changes nothing.

const CONTRACT_TEST_CODE = `
// This node names URLSearchParams and URL as data — they are the two symbols it
// hunts for in everyone else's code. R001 cannot tell a mention from a use, and
// that is the right bias for a check whose job is catching this class: better it
// insists here, where the require costs nothing, than let a real one through.
const { URLSearchParams, URL } = require('url');

// The code runs inside the n8n container, so it calls its own API on loopback.
// $env.N8N_URL is not set in the container (it has N8N_HOST / WEBHOOK_URL), and
// going out to the public host would round-trip through traefik and TLS for no
// reason. localhost:5678 is where n8n listens (N8N_PORT).
const base = 'http://localhost:5678';
const key = $env.N8N_API_KEY;
if (!key) throw new Error('N8N_API_KEY is not set in the container');

// The sandbox exposes neither fetch nor the http builtin; use n8n's helper.
const list = await this.helpers.httpRequest({
  url: base + '/api/v1/workflows?limit=100',
  headers: { 'X-N8N-API-KEY': key },
  json: true,
});

const failures = [];

// 1 — the config the container actually has, not the config we believe it has.
const REQUIRED = ['MEETING_HOSTS', 'GEMINI_API_KEY', 'TEAMS_DAILY_WEBHOOK_URL',
                  'KUMA_PUSH_BASE', 'N8N_API_KEY'];
for (const k of REQUIRED) {
  if (!$env[k]) failures.push('env ' + k + ' is empty INSIDE the container (R014)');
}

// 2 — every Code node still parses in this sandbox, on this n8n version.
// new Function throws on a syntax error without running a line of it.
for (const w of (list.data || [])) {
  if (w.name === 'BEXT — Contract Test') continue;
  for (const n of (w.nodes || [])) {
    const code = n.parameters && n.parameters.jsCode;
    if (!code) continue;
    try {
      new Function('return (async () => {' + code + '})');
    } catch (err) {
      failures.push(w.name + ' / ' + n.name + ' does not parse: ' + err.message);
    }
    // 3 — the two symbols the sandbox withholds. Using either without
    // destructuring it from 'url' is R001/R002b, and it only shows at runtime.
    for (const sym of ['URLSearchParams', 'URL']) {
      const used = new RegExp('\\\\bnew ' + sym + '\\\\b|\\\\b' + sym + '\\\\s*\\\\(').test(code);
      const bound = new RegExp('\\\\{[^}]*\\\\b' + sym + '\\\\b[^}]*\\\\}\\\\s*=\\\\s*require\\\\(.url.\\\\)').test(code);
      if (used && !bound) failures.push(w.name + ' / ' + n.name + ' uses ' + sym + ' unbound (R001/R002b)');
    }
  }
}

// 4 — every scheduled workflow still carries its heartbeat. Losing one is
// silent: the workflow keeps working and the deadman stops being a deadman.
for (const w of (list.data || [])) {
  const scheduled = (w.nodes || []).some(n => n.type === 'n8n-nodes-base.scheduleTrigger');
  if (!scheduled) continue;
  const beats = (w.nodes || []).some(n => n.name === 'Heartbeat');
  if (!beats) failures.push(w.name + ' is scheduled but has no Heartbeat node');
}

return [{ json: {
  ok: failures.length === 0,
  checked: (list.data || []).length,
  failures: failures,
  detail: failures.length ? failures.join(' | ').slice(0, 900) : 'all contracts hold',
} }];
`;

function contractTestWorkflow() {
  return {
    name: 'BEXT — Contract Test',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'trigger', name: 'Daily 02:00 AEST', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-400, 0),
        // Three hours before the report, so a failure here is still fixable
        // before the client sees anything.
        parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 2 * * *' }] } },
      },
      {
        id: 'assert', name: 'Assert contracts', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(-180, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: CONTRACT_TEST_CODE },
      },
      {
        id: 'record', name: 'Record result', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(60, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          // ::health_status, for the same reason as everywhere else: R003.
          query: `INSERT INTO integration_health (service, status, detail)
VALUES ('contract-test', ($1::text)::health_status, $2::text)`,
          options: {
            queryReplacement: '={{ $json.ok ? "up" : "down" }},={{ $json.detail }}',
          },
        },
      },
      // Only reached when the assertions ran. A contract test that pings even
      // when it failed to run would be a monitor reporting on itself, which is
      // the failure Graph Health had: the alarm was the broken thing.
      heartbeat('KUMA_PUSH_CONTRACT_TEST', 300, 0),
    ],
    connections: {
      'Daily 02:00 AEST': { main: [[{ node: 'Assert contracts', type: 'main', index: 0 }]] },
      'Assert contracts': { main: [[{ node: 'Record result', type: 'main', index: 0 }]] },
      'Record result': { main: [[{ node: 'Heartbeat', type: 'main', index: 0 }]] },
    },
  };
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

// Where each scheduled workflow's heartbeat hangs, and why that node.
//
// The anchor must be the last node that runs on EVERY cycle, not the last node
// that runs on a good cycle. Get this wrong in the obvious direction — hang it
// off the end of a conditional branch — and the deadman only pings when that
// branch fires, so a quiet day reads as an outage and within a week nobody
// believes the monitor. Alarm fatigue is the failure mode docs/REGRESSIONS.md
// keeps warning about: "a workflow that is expected to be red trains everyone
// to ignore red".
//
// Graph Health is the sharp case. Its chain ends `Record health` -> `Only when
// broken` (an IF) -> `Alert by email`. Anchoring on the terminal node would ping
// only when Graph is BROKEN — the monitor exactly inverted. It anchors on
// `Record health`, which runs either way.
const HEARTBEATS = {
  'BEXT — Source Ingest':    { anchor: 'Record fetch attempts', env: 'KUMA_PUSH_SOURCE_INGEST' },
  'BEXT — Article Analysis': { anchor: 'Save analysis',         env: 'KUMA_PUSH_ARTICLE_ANALYSIS' },
  'BEXT — Daily Report':     { anchor: 'Record result',         env: 'KUMA_PUSH_DAILY_REPORT' },
  'BEXT — Daily News Card':  { anchor: 'Record result',         env: 'KUMA_PUSH_DAILY_NEWS_CARD' },
  'BEXT — Graph Health':     { anchor: 'Record health',         env: 'KUMA_PUSH_GRAPH_HEALTH' },
  'BEXT — Meeting Intake':   { anchor: 'Load processed meetings', env: 'KUMA_PUSH_MEETING_INTAKE' },
  // Self Heal, Contract Test and the three content workflows wire their own
  // heartbeat, because they poll on a short interval and do work only
  // occasionally. Anchoring the ping on a work node would leave the monitor
  // silent through every idle poll and read every quiet stretch as an outage —
  // R024 inverted. They ping off the trigger instead, so the deadman proves the
  // poller is alive; whether a queued cycle is stuck is Contract Test's job.
};

function withHeartbeat(wf) {
  const scheduled = (wf.nodes || []).some(n => n.type === 'n8n-nodes-base.scheduleTrigger');
  if (!scheduled) return wf;
  if ((wf.nodes || []).some(n => n.name === 'Heartbeat')) return wf;

  const spec = HEARTBEATS[wf.name];
  // Deliberately fatal. A new scheduled workflow that ships without a deadman is
  // invisible in exactly the way the 05:00 report was invisible, and the way to
  // stop that recurring is to make it impossible to build, not to remember.
  if (!spec) throw new Error(`${wf.name} is scheduled but has no HEARTBEATS entry — add one, or it ships unmonitored`);

  const anchor = (wf.nodes || []).find(n => n.name === spec.anchor);
  if (!anchor) throw new Error(`${wf.name}: heartbeat anchor "${spec.anchor}" is not a node in this workflow`);

  // A Postgres insert that wrote nothing emits nothing, and a node downstream of
  // nothing never runs — R015. The anchor has to keep talking even on an empty
  // cycle or the deadman is a liar.
  anchor.alwaysOutputData = true;

  const [ax, ay] = anchor.position || [0, 0];
  wf.nodes.push(heartbeat(spec.env, ax + 240, ay));
  const existing = (wf.connections[spec.anchor] && wf.connections[spec.anchor].main) || [];
  const first = existing[0] || [];
  wf.connections[spec.anchor] = {
    main: [[...first, { node: 'Heartbeat', type: 'main', index: 0 }], ...existing.slice(1)],
  };
  return wf;
}

async function deploy(input) {
  const wf = withHeartbeat(input);
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

const NEWSLETTER_CODE = `
// The Code sandbox withholds URL as a global; it has to be destructured from
// the url builtin or new URL() throws ReferenceError at runtime.
const { URL } = require('url');

// --- shared parser ---
${INGEST_SRC}
// --- end shared parser ---

// --- model-backed reader ---
${HERMES_SRC}
// --- end model-backed reader ---

const helpers = this.helpers;

// Mail that is plainly not a newsletter. Cheap to exclude here rather than
// spending forty seconds of model time discovering it.
const NOT_NEWS = /^(re|fwd|out of office|undeliverable|delivery status|password|verify your|confirm your|receipt|invoice|your order)\\b/i;

// Tracking wrappers are the norm in newsletters, and the real URL is usually a
// parameter inside them. Storing the wrapper would defeat deduplication, since
// the same article arrives with a different tracking id every time.
const unwrap = (u) => {
  try {
    const parsed = new URL(u);
    for (const key of ['url', 'u', 'target', 'redirect', 'link', 'dest']) {
      const inner = parsed.searchParams.get(key);
      if (inner && /^https?:\\/\\//i.test(inner)) return inner.split('#')[0];
    }
    // Strip the campaign parameters so two sends of one article agree.
    for (const junk of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','mc_cid','mc_eid']) {
      parsed.searchParams.delete(junk);
    }
    return parsed.toString().split('#')[0];
  } catch (e) { return u; }
};

const rows = [];
const messages = [];

// The IMAP node does not hand back a plain string. Depending on the message it
// is { value: [{ address, name }], text }, or a bare string, or only present in
// the raw headers. String() on the object form yields "[object Object]", which
// matched no sender pattern and quietly filed every newsletter under the
// catch-all source — found on the first real message through the pipeline.
const addressOf = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return addressOf(v[0]);
  if (v.address) return String(v.address);
  if (Array.isArray(v.value) && v.value.length) return addressOf(v.value[0]);
  if (v.text) return String(v.text);
  return '';
};
// A From header is "Name <addr@host>" as often as it is bare; keep the address.
const bareAddress = (s) => {
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : String(s)).trim().toLowerCase();
};

for (const item of $input.all()) {
  const j = item.json;
  const from = bareAddress(addressOf(j.from) || addressOf(j.headers && j.headers.from));
  const subject = String(j.subject || '');
  const messageId = String((j.headers && j.headers['message-id']) || j.messageId || '').trim()
    || (from + '|' + subject + '|' + String(j.date || ''));
  const html = String(j.textHtml || j.html || j.textPlain || j.text || '');

  if (!html || NOT_NEWS.test(subject.trim())) continue;

  // Which source this belongs to is resolved in SQL, by matching the sending
  // address against newsletter_senders. Doing it there rather than here means
  // adding a publisher is one row, not a code change and a redeploy.
  //
  // Every message is read regardless of whether the sender is known. A
  // newsletter subscribed to next month should work immediately, and a publisher
  // quietly changing its sending domain is exactly the failure that goes
  // unnoticed for weeks.
  const domain = (from.match(/@([a-z0-9.-]+)/) || [null, 'mail.invalid'])[1];
  const h = await hermesExtract({
    html, baseUrl: 'https://' + domain, http: helpers.httpRequest,
  });

  const kept = [];
  for (const a of h.articles) {
    const url = unwrap(a.url);
    if (!/^https?:\\/\\//i.test(url)) continue;
    kept.push({ url: url, title: a.title, from_address: from.slice(0, 200), published_at: j.date || null });
  }

  messages.push({
    message_id: messageId.slice(0, 400),
    from_address: from.slice(0, 200),
    subject: subject.slice(0, 400),
    received_at: j.date || null,
    links_found: h.considered || 0,
    articles_kept: kept.length,
  });
  for (const k of kept) rows.push(k);
}

return [{ json: {
  payload: JSON.stringify(rows),
  messages: JSON.stringify(messages),
  article_count: rows.length,
  message_count: messages.length,
} }];
`;

/**
 * Tier 0 — articles that arrive by post rather than being fetched.
 *
 * Four sources cannot be scraped at all: Reuters answers 401, the IEA 403, and
 * AFR and The Australian serve a truncated page behind "already a subscriber".
 * All four publish a free newsletter carrying the same headlines, so the
 * articles come in through the mailbox instead and land in the same table.
 *
 * For sources that scrape perfectly well this is still worth running. An index
 * page shows what the publisher features right now and rolls items off as new
 * ones arrive; between hourly fetches a story can appear and be pushed under.
 * The newsletter is an independent second record of what was published, which is
 * the shape of several articles the client reported missing on 21 August. The
 * content hash already deduplicates a story that arrives by both routes.
 */
const newsletterIntakeWorkflow = () => ({
  name: 'BEXT — Newsletter Intake',
  nodes: [
    {
      id: 'imap', name: 'Watch the mailbox', type: 'n8n-nodes-base.emailReadImap',
      typeVersion: 2, position: pos(-320, 0),
      credentials: { imap: { id: IMAP_CRED, name: 'BEXT Newsletter Mailbox' } },
      parameters: {
        // UNSEEN only. Marking as read is what stops the same newsletter being
        // reprocessed every poll; newsletter_messages.message_id is the backstop
        // for when a client marks something unread by hand.
        // forceReconnect at 10 minutes, not the default 60. The node holds an
        // IMAP IDLE connection open between polls, and iFastNet's server drops an
        // idle connection well before an hour — which surfaced as "IMAP connection
        // closed unexpectedly. Will try to reactivate." on a loop. Reconnecting
        // before the server times the connection out keeps it steady.
        format: 'resolved',
        options: { customEmailConfig: '["UNSEEN"]', forceReconnect: 10 },
      },
    },
    {
      id: 'classify', name: 'Read the newsletter', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: pos(-80, 0),
      parameters: {
        mode: 'runOnceForAllItems', language: 'javaScript',
        jsCode: NEWSLETTER_CODE,
      },
    },
    {
      id: 'insert', name: 'Insert articles', type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5, position: pos(180, -80),
      credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
      parameters: {
        operation: 'executeQuery',
        // The sending address is matched to a source here rather than in the Code
        // node, so registering a new publisher is one row in newsletter_senders.
        // Mail from a sender we do not recognise is still stored, against the
        // catch-all source — losing it would defeat the point of reading everything.
        query: `INSERT INTO articles (source_id, url, title, published_at)
SELECT coalesce(
         (SELECT s.id FROM newsletter_senders ns
            JOIN sources s ON s.slug = ns.source_slug
           WHERE ns.active AND x.from_address ILIKE ns.from_pattern
           LIMIT 1),
         (SELECT id FROM sources WHERE slug = 'newsletter-other')
       ),
       x.url, x.title, x.published_at
FROM json_to_recordset($1::json) AS x(
  url text, title text, from_address text, published_at timestamptz)
WHERE x.url IS NOT NULL
ON CONFLICT (url) DO NOTHING`,
        options: { queryReplacement: '={{ $json.payload }}' },
      },
    },
    {
      id: 'seen', name: 'Record the message', type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5, position: pos(180, 100),
      credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
      parameters: {
        operation: 'executeQuery',
        // Message-ID is the only stable key a mail server gives us. Without this
        // a re-poll re-imports the same edition and the daily sheet doubles up.
        query: `INSERT INTO newsletter_messages
  (message_id, source_slug, from_address, subject, received_at, links_found, articles_kept)
SELECT x.message_id,
       (SELECT ns.source_slug FROM newsletter_senders ns
         WHERE ns.active AND x.from_address ILIKE ns.from_pattern LIMIT 1),
       x.from_address, x.subject, x.received_at, x.links_found, x.articles_kept
FROM json_to_recordset($1::json) AS x(
  message_id text, from_address text, subject text,
  received_at timestamptz, links_found int, articles_kept int)
ON CONFLICT (message_id) DO NOTHING`,
        options: { queryReplacement: '={{ $json.messages }}' },
      },
    },
  ],
  connections: {
    'Watch the mailbox': { main: [[{ node: 'Read the newsletter', type: 'main', index: 0 }]] },
    'Read the newsletter': {
      main: [[
        { node: 'Insert articles', type: 'main', index: 0 },
        { node: 'Record the message', type: 'main', index: 0 },
      ]],
    },
  },
  settings: { executionOrder: 'v1' },
});

const NEWS_CARD_CODE = `
// --- card builder, generated from n8n/lib/news-card.js — do not edit here ---
${NEWS_CARD_SRC}
// --- end card builder ---

// --- fetch list, generated from n8n/lib/fetch-list.js — do not edit here ---
${FETCH_LIST_SRC}
// --- end fetch list ---

const rows = $input.all().map(i => i.json);
if (!rows.length || !rows[0].report_date) {
  return [{ json: { skip: true, detail: 'no sent report to accompany' } }];
}

const day = rows[0].report_date;
const coverage = new Date(day).toLocaleDateString('en-AU',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Melbourne' });

const FLOOR = Number($env.REPORT_MIN_RELEVANCE || 40);

// Everything that cleared the floor, best first.
const qualifying = rows
  .filter(r => r.relevance_score >= FLOOR)
  .sort((a, b) => b.relevance_score - a.relevance_score);

// Solar leads the card because it is the business. Detected from the text rather
// than from the source, since solar stories arrive from regulators, the trade
// press and the Minister's office alike — and a source-based split would put a
// PV standards change under "energy" merely because the AER published it.
// Escaped as \\\\b because this lives inside a template literal: a single \\b is
// read as a backspace character before it ever reaches the regex, so the pattern
// silently requires a backspace before "solar" and matches nothing. It reported
// "0 solar" on a day carrying a new inverter standard and a PV module changeover.
const SOLAR = /\\b(solar|photovoltaic|pv|rooftop|inverter|feed-?in|batter(y|ies)|storage|behind[- ]the[- ]meter|solar panel)\\b/i;
const isSolar = r => SOLAR.test(String(r.title || '') + ' ' + String(r.summary || ''));

const solar = qualifying.filter(isSolar).slice(0, 5);
const solarUrls = new Set(solar.map(r => r.url));
// The rest of the energy material. Prioritising solar orders the card; it does
// not remove anything, which the client was explicit about.
const energy = qualifying.filter(r => !solarUrls.has(r.url)).slice(0, 15);

const shown = solar.length + energy.length;

// The "View more" button opens the full list from the dashboard, gated by a
// token in the URL. SharePoint could not serve it — anonymous sharing is disabled
// and an org link needs a Microsoft session the Teams in-app browser lacks — so
// the list lives on the dashboard, which is where the client asked for it anyway.
const viewUrl = 'https://bext.dev-environment.site/api/fetched?date=' + day
  + '&token=' + ($env.FETCH_VIEW_TOKEN || '');

const card = buildNewsCard({
  coverage,
  solar,
  energy,
  moreCount: Math.max(0, rows.length - shown),
  counts: {
    fetched: rows.length,
    sources_contributing: new Set(rows.map(r => r.source_name)).size,
    sources_monitored: rows[0].sources_monitored,
  },
  pdfUrl: viewUrl,
  reportUrl: 'https://bext.dev-environment.site/reports',
});

const listHtml = buildFetchList(rows, {
  coverage, floor: FLOOR, sources_monitored: rows[0].sources_monitored,
});

return [{ json: {
  skip: false,
  report_date: day,
  coverage,
  card,
  listHtml,
  counts: { fetched: rows.length, solar: solar.length, energy: energy.length, shown: shown },
} }];
`;

const NEWS_POST_CODE = `
// Post the card to the channel. The "View more" button already points at the
// dashboard fetch list (set in the previous node); the list itself was stored to
// the reports row by the node between, so it is there when the button is clicked.
//
// SharePoint used to host the list as a PDF, and it did not open for the client:
// the site disables anonymous sharing and an org link needs a Microsoft session
// the Teams in-app browser does not carry. The dashboard route has neither
// constraint.
// Named explicitly: this node runs after the Postgres store, and a Postgres node
// emits its query result, not the payload. $input here would be the UPDATE's
// output, with no card in it.
const d = $('Build card and list').first().json;
if (d.skip) return [{ json: { ok: true, detail: 'skipped: ' + d.detail } }];

const helpers = this.helpers;
const hook = $env.TEAMS_DAILY_WEBHOOK_URL;
if (!hook) return [{ json: { ok: false, detail: 'TEAMS_DAILY_WEBHOOK_URL not set' } }];

await helpers.httpRequest({
  method: 'POST', url: hook, json: true, timeout: 60000,
  body: { type: 'message', attachments: [
    { contentType: 'application/vnd.microsoft.card.adaptive', content: d.card } ] },
});

return [{ json: { ok: true, detail:
  d.counts.solar + ' solar, ' + d.counts.energy + ' energy, ' + d.counts.fetched + ' fetched' } }];
`;

/**
 * Tier: the Teams channel gets the day's news as a card, after the email goes.
 *
 * Separate from the daily report rather than appended to it. A failure posting a
 * card must not fail the send that already succeeded, and the channel post is
 * worth retrying on its own — the report is not.
 *
 * Fires at 05:20, twenty minutes behind the report, so the reports row it reads
 * is committed and the article images are cached.
 */
const dailyNewsCardWorkflow = () => ({
  name: 'BEXT — Daily News Card',
  nodes: [
    {
      id: 'cron', name: 'Daily 05:20 AEST', type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2, position: pos(-340, 0),
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '20 5 * * *' }] } },
    },
    {
      id: 'load', name: 'Load the day', type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5, position: pos(-120, 0),
      credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
      parameters: {
        operation: 'executeQuery',
        // Everything fetched for the reported day, with what the client received
        // marked. One query: the card needs the top of it, the PDF needs all of it.
        // A report is dated the morning it is SENT and covers the day BEFORE, so
        // matching articles against report_date finds none of the ones the client
        // actually received. Bind to the same window the report itself used.
        query: `WITH day AS (
  SELECT report_date, report_date - 1 AS covers
    FROM reports WHERE status = 'sent' ORDER BY report_date DESC LIMIT 1
)
SELECT (SELECT report_date::text FROM day) AS report_date,
       (SELECT covers::text FROM day)      AS covers,
       a.title, a.url, s.name AS source_name, s.category,
       coalesce(an.relevance_score, 0)                            AS relevance_score,
       coalesce(an.summary, '')                                   AS summary,
       coalesce(a.published_at, a.fetched_at)                      AS shown_at,
       (a.published_at IS NOT NULL)                                AS date_is_exact,
       (ri.article_id IS NOT NULL)                                 AS in_report,
       ri.rank,
       (SELECT count(*) FROM sources WHERE active)                 AS sources_monitored,
       (SELECT html FROM reports r2, day WHERE r2.report_date = day.report_date) IS NOT NULL AS have_report
  FROM articles a
  JOIN sources s ON s.id = a.source_id
  LEFT JOIN article_analysis an ON an.article_id = a.id
  LEFT JOIN report_items ri ON ri.article_id = a.id
  CROSS JOIN day
 WHERE a.report_eligible
   AND (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date
       = day.covers
 ORDER BY ri.rank NULLS LAST, an.relevance_score DESC NULLS LAST`,
        options: {},
      },
    },
    {
      id: 'render', name: 'Build card and list', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: pos(120, 0),
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: NEWS_CARD_CODE },
    },
    {
      id: 'store', name: 'Store fetch list', type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5, position: pos(360, 0),
      credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
      parameters: {
        operation: 'executeQuery',
        // The dashboard route the card links to reads this. Stored before the card
        // is posted so the list is there the instant someone clicks the button.
        // json_to_recordset, not queryReplacement: the HTML is full of commas and
        // queryReplacement splits parameters on them.
        query: `UPDATE reports SET fetch_list_html = v.html
FROM (SELECT * FROM json_to_recordset($1::json) AS x(report_date date, html text)) v
WHERE reports.report_date = v.report_date`,
        options: { queryReplacement: '={{ JSON.stringify([{ report_date: $json.report_date, html: $json.listHtml }]) }}' },
      },
    },
    {
      id: 'post', name: 'Post to Teams', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: pos(600, 0),
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: NEWS_POST_CODE },
    },
    {
      id: 'record', name: 'Record result', type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5, position: pos(840, 0),
      credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
      parameters: {
        operation: 'executeQuery',
        query: `INSERT INTO integration_health (service, status, detail)
SELECT 'daily_news_card', status::health_status, detail
FROM json_to_recordset($1::json) AS x(status text, detail text)`,
        options: { queryReplacement: '={{ JSON.stringify([{ status: $json.ok ? "up" : "down", detail: $json.detail }]) }}' },
      },
    },
  ],
  connections: {
    'Daily 05:20 AEST': { main: [[{ node: 'Load the day', type: 'main', index: 0 }]] },
    'Load the day': { main: [[{ node: 'Build card and list', type: 'main', index: 0 }]] },
    'Build card and list': { main: [[{ node: 'Store fetch list', type: 'main', index: 0 }]] },
    'Store fetch list': { main: [[{ node: 'Post to Teams', type: 'main', index: 0 }]] },
    'Post to Teams': { main: [[{ node: 'Record result', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ─── Content generation ──────────────────────────────────────────────────────
//
// Three workflows turn the daily news feed into one LinkedIn post a fortnight,
// with a human in the middle. The shape of the cycle and the reason for every
// table are in db/migrations/025_content_generation.sql; the short version:
//
//   Content Topics  scans 14 days, ranks three topic options            (machine)
//   [ a human picks one and adds the BEXT perspective, in the dashboard ]
//   Content Drafts  writes two variants, scrubs, audits, fact-checks     (machine)
//   [ a human edits and approves one, in the dashboard ]
//   LinkedIn Publish  posts it, or (manual mode) nudges the human to      (machine)
//
// The dashboard never calls Gemini. It writes a content_cycles row and pings a
// webhook; all the model work lives here, so it inherits the same retry,
// heartbeat and self-heal behaviour as every other BEXT pipeline. Each workflow
// also carries a slow poll as a backstop, so a missed webhook delays a cycle by
// a couple of minutes rather than stranding it.

// The prompts are plain strings, JSON.stringify'd into the node, so no template
// literal quoting has to survive the inlining.
const TOPICS_PROMPT =
  'You are BEXT Consultancy planning LinkedIn content. Below are the news items '
  + 'this pipeline scored as relevant to an Australian commercial-buildings energy '
  + 'and sustainability consultancy over the past fortnight, each with its source '
  + 'and relevance score.\n\n'
  + 'Propose exactly THREE topic options for a single LinkedIn post, ranked, best '
  + 'first. Each option must:\n'
  + '  - draw on one or more of the items below, by their id\n'
  + '  - say, in a sentence, why it is worth BEXT being seen to have a view on it\n'
  + '  - name the angle BEXT would take, distinct from what the articles merely report\n'
  + '  - never rely on a fact that is not in the supplied items\n\n'
  + 'Rank by what a commercial building owner could act on: solar and PV first, then '
  + 'building performance and compliance, then the wider energy market.\n\n'
  + 'Return JSON only: { "topics": [ { "rank": 1, "title": "...", "rationale": "...", '
  + '"angle": "...", "article_ids": [12, 44], "score": 82 }, ... ] }.';

const DRAFTS_PROMPT_HEAD =
  'You are writing a single LinkedIn post for BEXT Consultancy. The selected topic, '
  + 'the human perspective to honour, the source material, and the voice and formula '
  + 'to use are all below. Write ONE post.\n\n'
  + 'Hard requirements:\n'
  + '  - The first 210 characters must stand alone as a hook, before the "... see more" fold.\n'
  + '  - 900 to 1300 characters total. Double line breaks between ideas, not single.\n'
  + '  - Every material fact must come from the source material. Do not invent a figure, '
  + 'a date, a rebate amount or an eligibility rule.\n'
  + '  - No external link in the body. Name the destination separately.\n'
  + '  - Obey the voice rules exactly, including the banned words.\n\n'
  + 'Return JSON only: { "hook": "...", "body": "full post text including the hook", '
  + '"hashtags": ["solar"], "visual_concept": "what image runs with it", '
  + '"cta": "the restrained call to action", "destination_url": "https://... or null", '
  + '"claims": ["each material factual sentence, verbatim from the body"] }.';

// The Gemini call, retry ladder and JSON parse, shared verbatim by both content
// workflows. Same transient handling as the article scorer and the meeting
// extractor: Gemini drops connections often enough that one attempt loses a run.
const GEMINI_CALL = `
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_KEY = $env.GEMINI_API_KEY;
const geminiJSON = async (prompt, helpers) => {
  const TRANSIENT = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network|aborted/i;
  let res, lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      res = await helpers.httpRequest({
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + GEMINI_KEY,
        json: true, timeout: 180000,
        body: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
        },
      });
      break;
    } catch (e) {
      lastErr = e;
      const st = e && (e.statusCode || (e.response && e.response.statusCode));
      const retryable = st === 429 || (st >= 500 && st < 600)
        || (!st && TRANSIENT.test(String((e && (e.message || e.code)) || '')));
      if (attempt === 4 || !retryable) throw e;
      await new Promise(r => setTimeout(r, [2000, 8000, 20000][attempt - 1]));
    }
  }
  if (!res) throw lastErr;
  const raw = (res && res.candidates && res.candidates[0] && res.candidates[0].content
    && res.candidates[0].content.parts && res.candidates[0].content.parts[0]
    && res.candidates[0].content.parts[0].text) || '{}';
  try { return JSON.parse(raw); }
  catch (e) { throw new Error('Gemini returned unparseable JSON: ' + String(raw).slice(0, 200)); }
};
`;

// ── Workflow: Content Topics ─────────────────────────────────────────────────

const TOPICS_CODE = `
const helpers = this.helpers;
${GEMINI_CALL}
// The claimed cycle rides through on the first item; the articles are the rest.
const all = $input.all().map(i => i.json);
const cycle = all[0] && all[0].__cycle ? all[0].__cycle : (all[0] || {});
const articles = all.filter(a => a && a.id).map(a => ({
  id: a.id, title: a.title, url: a.url, source: a.source_name,
  score: a.relevance_score, summary: a.summary,
  topics: a.topics, published_at: a.published_at,
}));

if (!articles.length) {
  // Nothing in the window. Not an error, a quiet fortnight, but the cycle cannot
  // produce topics, so it is marked and the human is spared an empty page.
  return [{ json: { cycle_id: cycle.id, empty: true, topics: '[]', topic_count: 0,
                    status: 'failed', error: 'No eligible articles in the 14-day window.' } }];
}

const catalogue = articles.map(a =>
  '[' + a.id + '] (' + (a.source || 'source') + ', score ' + (a.score == null ? '?' : a.score) + ') '
  + (a.title || '') + ' :: ' + String(a.summary || '').slice(0, 300)
).join('\\n');

const out = await geminiJSON(${JSON.stringify(TOPICS_PROMPT)} + '\\n\\nITEMS:\\n' + catalogue, helpers);
// Postgres returns bigint ids as strings; Gemini returns them as numbers.
// Compare and store as strings on both sides so the guard does not drop every
// real id as if it were hallucinated.
const valid = new Set(articles.map(a => String(a.id)));
const topics = (out.topics || []).slice(0, 3).map((t, i) => ({
  rank: t.rank || (i + 1),
  title: String(t.title || '').slice(0, 300),
  rationale: String(t.rationale || '').slice(0, 1000),
  angle: String(t.angle || '').slice(0, 500),
  // Keep only ids the model was actually given, so a hallucinated id cannot
  // point the fact-checker at an article that was never in the window.
  article_ids: (t.article_ids || []).map(id => String(id)).filter(id => valid.has(id)),
  score: typeof t.score === 'number' ? Math.max(0, Math.min(100, t.score)) : null,
})).filter(t => t.article_ids.length);

if (!topics.length) {
  return [{ json: { cycle_id: cycle.id, empty: true, topics: '[]', topic_count: 0,
                    status: 'failed', error: 'The model proposed no topic grounded in the supplied sources.' } }];
}
return [{ json: { cycle_id: cycle.id, topics: JSON.stringify(topics), topic_count: topics.length, status: 'topics_ready' } }];
`;

function contentTopicsWorkflow() {
  return {
    name: 'BEXT — Content Topics',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        // Opens a cycle on its own every second Monday, so the fortnightly rhythm
        // does not depend on anyone remembering to press the button.
        id: 'fortnightly', name: 'Fortnightly', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-620, -140),
        // 06:10 on Mondays; the SQL only opens a cycle on even ISO weeks, so it
        // fires fortnightly without n8n needing a two-week cron it does not have.
        parameters: { rule: { interval: [{ field: 'cronExpression', expression: '10 6 * * 1' }] } },
      },
      {
        id: 'open', name: 'Open a cycle', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-400, -140),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // Even ISO weeks only, so a weekly trigger yields a fortnightly cycle.
          // Idempotent on the fortnight: a re-fire cannot open a second scheduled
          // cycle within ten days of the last one.
          query: `INSERT INTO content_cycles (window_start, window_end, trigger, status)
SELECT (current_date - interval '14 days')::date, current_date, 'schedule', 'queued_topics'
WHERE (extract(week from current_date)::int % 2) = 0
  AND NOT EXISTS (
    SELECT 1 FROM content_cycles
    WHERE trigger = 'schedule' AND created_at > now() - interval '10 days')`,
          options: {},
        },
      },
      {
        // The dashboard pings here after inserting a manual cycle, to skip the poll.
        id: 'hook', name: 'Cycle request', type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: pos(-620, 40),
        webhookId: 'a4d2f8c1-6b3e-4a90-9c22-7f10e5b8d234',
        parameters: {
          httpMethod: 'POST', path: 'content-topics',
          authentication: WEBHOOK_CRED ? 'headerAuth' : 'none',
          responseMode: 'onReceived', options: {},
        },
        credentials: WEBHOOK_CRED
          ? { httpHeaderAuth: { id: WEBHOOK_CRED, name: 'BEXT Webhook Auth' } }
          : undefined,
      },
      {
        id: 'poll', name: 'Every 3 minutes', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-620, 200), alwaysOutputData: true,
        parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 3 }] } },
      },
      {
        id: 'claim', name: 'Claim a cycle', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-360, 40),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // The claim is the lock: SKIP LOCKED means two triggers firing at once
          // cannot take the same cycle, so the webhook and the poll are safe to
          // race. Oldest queued cycle first.
          query: `UPDATE content_cycles SET status = 'scanning'
WHERE id = (
  SELECT id FROM content_cycles
  WHERE status = 'queued_topics'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1)
RETURNING id, window_start, window_end`,
          options: {},
        },
      },
      {
        id: 'load', name: 'Load the window', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-120, 40),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        // Keep emitting even on a quiet fortnight (zero eligible articles), so the
        // cycle reaches the ranker and is marked failed rather than stranded in
        // 'scanning'. The cycle id is recovered from the claim node, not from
        // these rows, precisely because the rows can be empty. R015.
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          // The claimed cycle id threads through queryReplacement. Two source
          // modes, chosen by whether the cycle names specific reports:
          //   report_ids set  -> "Repurpose this report": exactly that report's
          //                      items, so the button means what it says.
          //   report_ids empty -> "Start a cycle": the whole 14-day window, per
          //                      the brief ("viable sources over the previous 14
          //                      days").
          // Both keep the daily-sheet gates (report_eligible, relevance floor),
          // newest first, capped so the prompt stays within budget.
          query: `WITH c AS (
  SELECT id, window_start, window_end, report_ids FROM content_cycles WHERE id = $1
)
SELECT c.id AS __cycle_id, a.id, a.title, a.url, a.published_at,
       s.name AS source_name, an.summary, an.relevance_score, an.topics
FROM c
JOIN articles a ON a.report_eligible AND (
  CASE WHEN cardinality(c.report_ids) > 0
    THEN a.id IN (SELECT ri.article_id FROM report_items ri WHERE ri.report_id = ANY(c.report_ids))
    ELSE coalesce(a.published_at, a.fetched_at) >= c.window_start
     AND coalesce(a.published_at, a.fetched_at) < c.window_end + 1
  END)
JOIN sources s ON s.id = a.source_id
JOIN article_analysis an ON an.article_id = a.id AND an.relevance_score >= 50
ORDER BY an.relevance_score DESC, coalesce(a.published_at, a.fetched_at) DESC
LIMIT 60`,
          options: { queryReplacement: '={{ [$json.id] }}' },
        },
      },
      {
        id: 'shape', name: 'Carry the cycle', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(100, 40),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          // The cycle id comes from the claim node, not from the article rows,
          // because a quiet fortnight returns zero articles and would otherwise
          // lose it. A claim that took nothing stops the run; a claim with no
          // articles still emits one marker so the ranker can fail the cycle.
          jsCode: `const claim = $('Claim a cycle').first().json;
if (!claim || !claim.id) return [];
const rows = $input.all().map(i => i.json).filter(r => r && r.id);
if (!rows.length) return [{ json: { __cycle: { id: claim.id } } }];
const out = rows.map(r => { const c = Object.assign({}, r); delete c.__cycle_id; return { json: c }; });
out[0].json.__cycle = { id: claim.id };
return out;`,
        },
      },
      {
        id: 'rank', name: 'Rank three topics', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(320, 40),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: TOPICS_CODE },
      },
      {
        id: 'save', name: 'Save topics', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(560, 40),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          // Insert the topics and move the cycle in one statement, so a crash
          // between the two cannot leave a cycle marked ready with no topics under
          // it. On the empty/failed path the topics array is [] and the CASE moves
          // the cycle to failed with the reason instead.
          query: `WITH ins AS (
  INSERT INTO content_topics (cycle_id, rank, title, rationale, angle, article_ids, score)
  SELECT $2::bigint, t.rank, t.title, t.rationale, t.angle, t.article_ids, t.score
  FROM json_to_recordset($1::json) AS t(
    rank smallint, title text, rationale text, angle text, article_ids bigint[], score int)
  RETURNING 1
)
UPDATE content_cycles SET
  status = $3::content_cycle_status,
  error = nullif($4, ''),
  topics_at = now()
WHERE id = $2::bigint
RETURNING id, status`,
          options: { queryReplacement: '={{ [$json.topics, $json.cycle_id, $json.status, $json.error || ""] }}' },
        },
      },
      // Own heartbeat, fired off the poll rather than off a work node, so the
      // monitor pings every three minutes whether or not there was a cycle to
      // process. Its presence also makes withHeartbeat leave this workflow alone.
      heartbeat('KUMA_PUSH_CONTENT_TOPICS', -360, 220),
    ],
    connections: {
      'Fortnightly': { main: [[{ node: 'Open a cycle', type: 'main', index: 0 }]] },
      'Open a cycle': { main: [[{ node: 'Claim a cycle', type: 'main', index: 0 }]] },
      'Cycle request': { main: [[{ node: 'Claim a cycle', type: 'main', index: 0 }]] },
      'Every 3 minutes': { main: [[{ node: 'Claim a cycle', type: 'main', index: 0 }, { node: 'Heartbeat', type: 'main', index: 0 }]] },
      'Claim a cycle': { main: [[{ node: 'Load the window', type: 'main', index: 0 }]] },
      'Load the window': { main: [[{ node: 'Carry the cycle', type: 'main', index: 0 }]] },
      'Carry the cycle': { main: [[{ node: 'Rank three topics', type: 'main', index: 0 }]] },
      'Rank three topics': { main: [[{ node: 'Save topics', type: 'main', index: 0 }]] },
    },
  };
}

// ── Workflow: Content Drafts ─────────────────────────────────────────────────

const DRAFTS_CODE = `
const helpers = this.helpers;
${GEMINI_CALL}
${LI_LIB}

const all = $input.all().map(i => i.json);
const ctx = all[0] || {};
const cycle = ctx.__cycle || {};
const topic = ctx.__topic || {};
const voiceRow = ctx.__voice || {};
const recent = ctx.__recent || [];
const sources = all.filter(a => a && a.article_id).map(a => ({
  article_id: a.article_id, url: a.url, title: a.title, summary: a.summary, body: a.body,
}));

const voice = merge(voiceRow);
// Two variants: the recommended one earns comments (the reaction that compounds
// into reach), the alternative earns saves. Distinct formulas, chosen away from
// anything used recently.
const picks = pick(2, recent, voice.pillars, topic.pillar || null);
const wantGoals = ['comments', 'saves'];
const chosen = wantGoals.map((g, i) => picks[i] || picks[0]).slice(0, 2);

const sourceBlock = sources.map(s =>
  '[' + s.article_id + '] ' + (s.title || '') + '\\n' + String(s.summary || s.body || '').slice(0, 800)
).join('\\n\\n');

const drafts = [];
for (let i = 0; i < 2; i++) {
  const variant = i === 0 ? 'A' : 'B';
  const choice = chosen[i];
  const prompt = ${JSON.stringify(DRAFTS_PROMPT_HEAD)}
    + '\\n\\n' + voicePromptBlock(voice)
    + '\\n\\n' + formulaPromptBlock(choice)
    + '\\n\\nTOPIC: ' + (topic.title || '') + '\\nANGLE: ' + (topic.angle || '')
    + '\\n\\nHUMAN PERSPECTIVE TO HONOUR (do not contradict, build around it):\\n'
    + (cycle.human_perspective || '(none supplied)')
    + '\\n\\nSOURCE MATERIAL:\\n' + sourceBlock;

  let out;
  try { out = await geminiJSON(prompt, helpers); }
  catch (e) {
    // One variant failing must not sink the other. Record the failure as an empty
    // draft carrying the error, so the reviewer sees "B did not generate" rather
    // than a silently missing card.
    drafts.push({ variant: variant, formula: choice.formula, goal: choice.goal,
      hook: '', body: '', char_count: 0, hashtags: [], visual_concept: null, cta: null,
      destination_url: null, audit: { blockers: [{ rule: 'generation failed', detail: String(e.message || e) }], warnings: [] },
      recommended: false, claims: [] });
    continue;
  }

  // Scrub deterministically, then audit the scrubbed text. The model's own hook
  // is discarded in favour of the one computed from the final body, so the two
  // cannot disagree about what the post opens with.
  const scrubbed = scrub(String(out.body || ''));
  const body = scrubbed.text;
  const hook = hookOf(body);
  const hashtags = (out.hashtags || []).map(h => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 2);
  const a = audit({ body: body, hook: hook, hashtags: hashtags, destination_url: out.destination_url });
  // The scrubber's own placeholder flags join the audit warnings, so an unfilled
  // [Your Company] shows up in the same panel as everything else.
  (scrubbed.flags || []).forEach(f => a.warnings.push({ rule: f.rule, detail: f.text }));

  drafts.push({
    variant: variant, formula: choice.formula, goal: choice.goal,
    hook: hook, body: body, char_count: charCount(body), hashtags: hashtags,
    visual_concept: out.visual_concept || null, cta: out.cta || null,
    destination_url: out.destination_url || null,
    audit: { blockers: a.blockers, warnings: a.warnings, ok: a.ok },
    recommended: false,
    // The model's claim list, reconciled against the real sources. This is the
    // fact-check record: every material claim matched back or flagged.
    claims: reconcile((out.claims && out.claims.length ? out.claims : extractClaims(body)).map(c => ({ claim: c })), sources),
  });
}

// The recommended variant is the one with fewer blockers, ties broken toward the
// comments-goal draft (A). "Recommended" has to mean something, so it is the
// cleaner draft, not just the first.
const score = d => (d.audit.blockers || []).length;
if (drafts.length === 2 && score(drafts[1]) < score(drafts[0])) drafts[1].recommended = true;
else if (drafts.length) drafts[0].recommended = true;

return [{ json: { cycle_id: cycle.id, topic_id: topic.id || null,
  drafts: JSON.stringify(drafts), draft_count: drafts.length } }];
`;

function contentDraftsWorkflow() {
  return {
    name: 'BEXT — Content Drafts',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'hook', name: 'Draft request', type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: pos(-620, 0),
        webhookId: 'c7e1a9b4-2f8d-4c63-9a10-5b7e2d0f6c81',
        parameters: {
          httpMethod: 'POST', path: 'content-drafts',
          authentication: WEBHOOK_CRED ? 'headerAuth' : 'none',
          responseMode: 'onReceived', options: {},
        },
        credentials: WEBHOOK_CRED
          ? { httpHeaderAuth: { id: WEBHOOK_CRED, name: 'BEXT Webhook Auth' } }
          : undefined,
      },
      {
        id: 'poll', name: 'Every 3 minutes', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-620, 180), alwaysOutputData: true,
        parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 3 }] } },
      },
      {
        id: 'claim', name: 'Claim a selection', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-360, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        parameters: {
          operation: 'executeQuery',
          // A cycle is queued_drafts only once a human has selected a topic, so
          // this can never draft for a topic nobody chose.
          query: `UPDATE content_cycles SET status = 'drafting'
WHERE id = (
  SELECT id FROM content_cycles
  WHERE status = 'queued_drafts' AND selected_topic_id IS NOT NULL
  ORDER BY selected_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1)
RETURNING id, human_perspective, selected_topic_id`,
          options: {},
        },
      },
      {
        id: 'context', name: 'Load topic and voice', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-120, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        // Keep the chain alive if the join finds nothing (a dangling selected
        // topic): the assembler guards the empty case and the cycle is left for
        // Contract Test rather than silently stalling the run. R015.
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          // One row carrying everything the drafter needs that is not an article:
          // the cycle, the selected topic, the voice profile, and the formulas
          // used in the last fortnight so the picker can avoid repeating a shape.
          query: `SELECT
  c.id AS cycle_id, c.human_perspective,
  t.id AS topic_id, t.title AS topic_title, t.angle AS topic_angle,
  t.article_ids,
  (SELECT to_json(v) FROM linkedin_voice v WHERE v.id = 1) AS voice,
  (SELECT coalesce(json_agg(json_build_object('formula', d.formula, 'created_at', d.created_at)), '[]'::json)
     FROM linkedin_drafts d WHERE d.created_at > now() - interval '21 days') AS recent
FROM content_cycles c
JOIN content_topics t ON t.id = c.selected_topic_id
WHERE c.id = $1`,
          options: { queryReplacement: '={{ [$json.id] }}' },
        },
      },
      {
        id: 'sources', name: 'Load the sources', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(120, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        // Emit even with no matching articles, so the assembler still runs and
        // reads the context row off its own node. R015.
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          // The topic's supporting articles, full text where we have it, so the
          // fact-checker matches claims against real source sentences.
          query: `SELECT a.id AS article_id, a.url, a.title, a.body, an.summary
FROM content_topics t
JOIN articles a ON a.id = ANY(t.article_ids)
LEFT JOIN article_analysis an ON an.article_id = a.id
WHERE t.id = $1`,
          options: { queryReplacement: '={{ [$json.topic_id] }}' },
        },
      },
      {
        id: 'assemble', name: 'Assemble context', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(340, 0),
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          // Two Postgres nodes upstream: the context row (from 'Load topic and
          // voice') and the source rows (this input). Pull the context off its
          // node explicitly and fold it into the first item as markers the
          // drafter reads, then pass the source rows through.
          jsCode: `const ctxRow = $('Load topic and voice').first().json;
const sources = $input.all().map(i => i.json).filter(s => s && s.article_id);
if (!ctxRow || !ctxRow.cycle_id) return [];
const first = sources[0] ? Object.assign({}, sources[0]) : {};
first.__cycle = { id: ctxRow.cycle_id, human_perspective: ctxRow.human_perspective };
first.__topic = { id: ctxRow.topic_id, title: ctxRow.topic_title, angle: ctxRow.topic_angle, pillar: null };
first.__voice = ctxRow.voice || {};
first.__recent = ctxRow.recent || [];
const out = [{ json: first }];
for (let i = 1; i < sources.length; i++) out.push({ json: sources[i] });
return out;`,
        },
      },
      {
        id: 'draft', name: 'Write two variants', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(560, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: DRAFTS_CODE },
      },
      {
        id: 'save', name: 'Save drafts', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(800, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          // Insert both drafts, then their fact-check claims, then move the cycle
          // to drafts_ready, in one statement. json_to_recordset expands the
          // drafts; the claims are inserted by joining each draft back to its
          // freshly-minted id on the (cycle, variant) pair.
          query: `WITH d AS (
  INSERT INTO linkedin_drafts
    (cycle_id, topic_id, variant, recommended, formula, goal, hook, body, char_count,
     hashtags, visual_concept, cta, destination_url, audit)
  SELECT $2::bigint, $3::bigint, x.variant, x.recommended, x.formula, x.goal, x.hook, x.body,
     x.char_count, x.hashtags, x.visual_concept, x.cta, x.destination_url, x.audit
  FROM json_to_recordset($1::json) AS x(
    variant text, recommended boolean, formula text, goal text, hook text, body text,
    char_count int, hashtags text[], visual_concept text, cta text, destination_url text, audit jsonb)
  RETURNING id, variant
), claims AS (
  INSERT INTO content_claims (draft_id, claim, article_id, source_url, source_quote, verdict)
  SELECT d.id, c.claim, c.article_id, c.source_url, c.source_quote, c.verdict
  FROM json_to_recordset($1::json) AS x(variant text, claims json)
  JOIN d ON d.variant = x.variant
  CROSS JOIN LATERAL json_to_recordset(x.claims) AS c(
    claim text, article_id bigint, source_url text, source_quote text, verdict text)
  RETURNING 1
)
UPDATE content_cycles SET status = 'drafts_ready', drafts_at = now()
WHERE id = $2::bigint
RETURNING id`,
          options: { queryReplacement: '={{ [$json.drafts, $json.cycle_id, $json.topic_id] }}' },
        },
      },
      heartbeat('KUMA_PUSH_CONTENT_DRAFTS', -360, 200),
    ],
    connections: {
      'Draft request': { main: [[{ node: 'Claim a selection', type: 'main', index: 0 }]] },
      'Every 3 minutes': { main: [[{ node: 'Claim a selection', type: 'main', index: 0 }, { node: 'Heartbeat', type: 'main', index: 0 }]] },
      'Claim a selection': { main: [[{ node: 'Load topic and voice', type: 'main', index: 0 }]] },
      'Load topic and voice': { main: [[{ node: 'Load the sources', type: 'main', index: 0 }]] },
      'Load the sources': { main: [[{ node: 'Assemble context', type: 'main', index: 0 }]] },
      'Assemble context': { main: [[{ node: 'Write two variants', type: 'main', index: 0 }]] },
      'Write two variants': { main: [[{ node: 'Save drafts', type: 'main', index: 0 }]] },
    },
  };
}

// ── Workflow: Content Actions ────────────────────────────────────────────────
//
// The dashboard's write path. In production the dashboard reads Postgres through
// a SELECT-only proxy and has no other route to the database, so every mutation a
// human makes — start a cycle, add the perspective, select a topic, approve a
// draft, mark it published, record its performance — is an authenticated POST to
// this webhook, and n8n owns the write. The caller names an action and typed
// fields; the router picks a fixed, parameterised statement. The caller never
// supplies SQL.
//
// One json parameter per action ($1::jsonb), destructured in the statement, so
// nothing depends on n8n's comma-splitting queryReplacement.

const ACTIONS_ROUTER = `
// Whitelisted actions -> fixed SQL. The body names an action and its fields; the
// SQL is chosen here, never sent by the caller. An unknown action throws, which
// the webhook returns as an error rather than silently doing nothing.
const body = ($input.first().json && ($input.first().json.body || $input.first().json)) || {};
const action = String(body.action || '');

const SQL = {
  start_cycle:
    "INSERT INTO content_cycles (window_start, window_end, report_ids, trigger, status, requested_by, human_perspective) " +
    "SELECT (current_date - interval '14 days')::date, current_date, " +
    "  coalesce((SELECT array_agg(x::int) FROM json_array_elements_text(coalesce(($1::json)->'report_ids','[]'::json)) AS x), '{}'), " +
    "  'manual', 'queued_topics', ($1::json)->>'requested_by', ($1::json)->>'perspective' " +
    "RETURNING id, status",

  set_perspective:
    "UPDATE content_cycles SET human_perspective = ($1::json)->>'perspective' " +
    "WHERE id = (($1::json)->>'cycle_id')::bigint RETURNING id, status",

  select_topic:
    "UPDATE content_cycles SET selected_topic_id = (($1::json)->>'topic_id')::bigint, " +
    "  human_perspective = coalesce(($1::json)->>'perspective', human_perspective), " +
    "  status = 'queued_drafts', selected_at = now() " +
    "WHERE id = (($1::json)->>'cycle_id')::bigint AND status = 'topics_ready' RETURNING id, status",

  approve_draft:
    "WITH d AS ( " +
    "  UPDATE linkedin_drafts SET status='approved', " +
    "    final_copy = coalesce(nullif(($1::json)->>'final_copy',''), body), " +
    "    post_at = nullif(($1::json)->>'post_at','')::timestamptz, " +
    "    approved_at = now(), approved_by = ($1::json)->>'approved_by', updated_at = now() " +
    "  WHERE id = (($1::json)->>'draft_id')::bigint AND status IN ('draft','approved') " +
    "  RETURNING cycle_id, id ), " +
    "sib AS ( UPDATE linkedin_drafts l SET status='rejected', updated_at=now() " +
    "  FROM d WHERE l.cycle_id = d.cycle_id AND l.id <> d.id AND l.status='draft' RETURNING 1 ) " +
    "UPDATE content_cycles c SET status='approved' FROM d WHERE c.id = d.cycle_id RETURNING c.id, c.status",

  reject_draft:
    "UPDATE linkedin_drafts SET status='rejected', error = nullif(($1::json)->>'reason',''), updated_at=now() " +
    "WHERE id = (($1::json)->>'draft_id')::bigint RETURNING id, status",

  mark_published:
    "WITH d AS ( UPDATE linkedin_drafts SET status='published', published_at=now(), " +
    "    post_url = nullif(($1::json)->>'post_url',''), updated_at=now() " +
    "  WHERE id = (($1::json)->>'draft_id')::bigint RETURNING cycle_id, id ) " +
    "UPDATE content_cycles c SET status='published', published_at=now() FROM d WHERE c.id=d.cycle_id RETURNING d.id, 'published' AS status",

  resolve_claim:
    "UPDATE content_claims SET verdict = coalesce(($1::json)->>'verdict', verdict), " +
    "  note = nullif(($1::json)->>'note','') WHERE id = (($1::json)->>'claim_id')::bigint RETURNING id, verdict AS status",

  record_performance:
    "INSERT INTO linkedin_performance (draft_id, impressions, reactions, comments, reposts, clicks, followers, notes, recorded_by) " +
    "SELECT (($1::json)->>'draft_id')::bigint, " +
    "  nullif(($1::json)->>'impressions','')::int, nullif(($1::json)->>'reactions','')::int, " +
    "  nullif(($1::json)->>'comments','')::int, nullif(($1::json)->>'reposts','')::int, " +
    "  nullif(($1::json)->>'clicks','')::int, nullif(($1::json)->>'followers','')::int, " +
    "  nullif(($1::json)->>'notes',''), ($1::json)->>'recorded_by' RETURNING id, 'recorded' AS status",

  update_voice:
    "UPDATE linkedin_voice SET " +
    "  author = coalesce(nullif(($1::json)->>'author',''), author), " +
    "  audience = coalesce(nullif(($1::json)->>'audience',''), audience), " +
    "  fingerprint = coalesce(nullif(($1::json)->>'fingerprint',''), fingerprint), " +
    "  cta_style = coalesce(nullif(($1::json)->>'cta_style',''), cta_style), " +
    "  updated_at = now() WHERE id = 1 RETURNING id, 'saved' AS status",
};

const sql = SQL[action];
if (!sql) throw new Error('unknown content action: ' + action);
return [{ json: { sql: sql, params: JSON.stringify(body) } }];
`;

function contentActionsWorkflow() {
  return {
    name: 'BEXT — Content Actions',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'hook', name: 'Action request', type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: pos(-360, 0),
        webhookId: 'e2b6f4a0-9d31-4c58-8a72-1f3c6b90e457',
        parameters: {
          httpMethod: 'POST', path: 'content-actions',
          // A write endpoint, publicly reachable through traefik: it must be
          // authenticated, never obscurity. Deploy is skipped without the
          // credential rather than exposing it open.
          authentication: 'headerAuth',
          // lastNode so the RETURNING row (a new cycle id, a new status) comes
          // back to the dashboard synchronously.
          responseMode: 'lastNode', options: {},
        },
        credentials: WEBHOOK_CRED
          ? { httpHeaderAuth: { id: WEBHOOK_CRED, name: 'BEXT Webhook Auth' } }
          : undefined,
      },
      {
        id: 'route', name: 'Route action', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(-120, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ACTIONS_ROUTER },
      },
      {
        id: 'apply', name: 'Apply', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(120, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          query: '={{ $json.sql }}',
          // Single json parameter, so no field with a comma splits the statement.
          options: { queryReplacement: '={{ [$json.params] }}' },
        },
      },
    ],
    connections: {
      'Action request': { main: [[{ node: 'Route action', type: 'main', index: 0 }]] },
      'Route action': { main: [[{ node: 'Apply', type: 'main', index: 0 }]] },
    },
  };
}

// ── Workflow: LinkedIn Publish ───────────────────────────────────────────────

const PUBLISH_CODE = `
const helpers = this.helpers;
${LI_LIB}
const env = {
  LINKEDIN_PUBLISH_MODE: $env.LINKEDIN_PUBLISH_MODE,
  PUBLORA_API_KEY: $env.PUBLORA_API_KEY,
  LINKEDIN_PLATFORM_ID: $env.LINKEDIN_PLATFORM_ID,
  LINKEDIN_API_TOKEN: $env.LINKEDIN_API_TOKEN,
  LINKEDIN_AUTHOR_URN: $env.LINKEDIN_AUTHOR_URN,
  LINKEDIN_API_VERSION: $env.LINKEDIN_API_VERSION,
};
const out = [];
for (const item of $input.all()) {
  const draft = item.json;
  if (!draft || !draft.id) continue;
  const p = plan(draft, env);

  if (p.mode === 'manual') {
    // Manual is the launch default and the brief's own instruction ("approve and
    // manually publish"). The workflow does not post; it hands the finished text
    // to the human via Teams and leaves the row approved. The dashboard is where
    // they mark it published once it is up, so nothing here claims a post went
    // out that a person still has to make.
    out.push({ json: { id: draft.id, mode: 'manual', published: false,
      message: p.message, post_url: null, external_id: null, error: null } });
    continue;
  }

  try {
    const res = await helpers.httpRequest(Object.assign({ json: true, timeout: 60000 }, p.request));
    const externalId = (res && (res.id || (res.headers && res.headers['x-restli-id']))) || null;
    out.push({ json: { id: draft.id, mode: p.mode, published: true,
      external_id: externalId ? String(externalId) : null, post_url: null, error: null } });
  } catch (e) {
    out.push({ json: { id: draft.id, mode: p.mode, published: false,
      external_id: null, post_url: null, error: String((e && (e.message || e.code)) || e).slice(0, 500) } });
  }
}
return out;
`;

function linkedinPublishWorkflow() {
  return {
    name: 'BEXT — LinkedIn Publish',
    settings: { executionOrder: 'v1', timezone: 'Australia/Melbourne' },
    nodes: [
      {
        id: 'trigger', name: 'Every 15 minutes', type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2, position: pos(-400, 0), alwaysOutputData: true,
        parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } },
      },
      {
        id: 'due', name: 'Due posts', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(-180, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        // Most 15-minute runs have nothing due; the heartbeat fires off the
        // trigger regardless, so this need not keep the chain alive. R015 wants
        // it set anyway, and the publisher tolerates an empty item. R015.
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          // Approved drafts whose slot has passed. SKIP LOCKED so two overlapping
          // runs cannot both take the same post. In manual mode the row stays
          // approved (the code publishes nothing), so it would be re-selected every
          // run; the nudged_at guard stops it nagging more than once a day.
          query: `SELECT id, final_copy, body, hashtags, destination_url, post_at
FROM linkedin_drafts
WHERE status = 'approved'
  AND post_at IS NOT NULL AND post_at <= now()
  AND (nudged_at IS NULL OR nudged_at < now() - interval '20 hours')
ORDER BY post_at
FOR UPDATE SKIP LOCKED
LIMIT 10`,
          options: {},
        },
      },
      {
        id: 'publish', name: 'Publish or prepare', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(40, 0),
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: PUBLISH_CODE },
      },
      {
        id: 'record', name: 'Record result', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5, position: pos(280, 0),
        credentials: { postgres: { id: PG_CRED, name: 'BEXT Postgres' } },
        alwaysOutputData: true,
        parameters: {
          operation: 'executeQuery',
          // One statement handles all three outcomes. Auto-publish success flips
          // the row to published; a failure flips it to failed with the error;
          // manual mode leaves it approved and only stamps nudged_at, so the same
          // post is not announced to Teams twice in a day.
          query: `UPDATE linkedin_drafts d SET
  status = CASE WHEN v.published THEN 'published'::linkedin_draft_status
                WHEN v.error IS NOT NULL THEN 'failed'::linkedin_draft_status
                ELSE d.status END,
  published_at = CASE WHEN v.published THEN now() ELSE d.published_at END,
  external_id = coalesce(v.external_id, d.external_id),
  error = v.error,
  nudged_at = CASE WHEN v.mode = 'manual' THEN now() ELSE d.nudged_at END,
  updated_at = now()
FROM (SELECT * FROM json_to_recordset($1::json) AS x(
  id bigint, mode text, published boolean, external_id text, post_url text, error text)) v
WHERE d.id = v.id
RETURNING d.id, d.status`,
          options: { queryReplacement: '={{ [JSON.stringify($input.all().map(i => i.json))] }}' },
        },
      },
      {
        id: 'notify', name: 'Notify Teams', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: pos(520, 0),
        onError: 'continueRegularOutput',
        parameters: {
          mode: 'runOnceForAllItems', language: 'javaScript',
          // Manual mode posts the ready-to-publish text to the Daily report
          // channel so the human can act on it from Teams. Auto mode posts a
          // shorter "published" or "failed" line. Reuses the same Teams Workflows
          // webhook as the news card. A missing webhook is not an error here.
          jsCode: `const helpers = this.helpers;
const url = $env.TEAMS_DAILY_WEBHOOK_URL;
const items = $input.all().map(i => i.json);
if (!url) return items.map(j => ({ json: j }));
for (const it of items) {
  if (!it || !it.id) continue;   // the empty-run passthrough item carries no post
  let text;
  if (it.status === 'published') text = 'LinkedIn: post ' + it.id + ' published.';
  else if (it.status === 'failed') text = 'LinkedIn: post ' + it.id + ' FAILED to publish. ' + (it.error || '');
  else text = 'LinkedIn: a post is approved and due. Publish it manually, then close it in the dashboard. (draft ' + it.id + ')';
  try {
    await helpers.httpRequest({ method: 'POST', url: url, json: true, timeout: 30000,
      body: { type: 'message', text: text } });
  } catch (e) { /* the card is a courtesy; its failure must not fail the workflow */ }
}
return items.map(j => ({ json: j }));`,
        },
      },
      heartbeat('KUMA_PUSH_LINKEDIN_PUBLISH', -180, 180),
    ],
    connections: {
      'Every 15 minutes': { main: [[{ node: 'Due posts', type: 'main', index: 0 }, { node: 'Heartbeat', type: 'main', index: 0 }]] },
      'Due posts': { main: [[{ node: 'Publish or prepare', type: 'main', index: 0 }]] },
      'Publish or prepare': { main: [[{ node: 'Record result', type: 'main', index: 0 }]] },
      'Record result': { main: [[{ node: 'Notify Teams', type: 'main', index: 0 }]] },
    },
  };
}

(async () => {
  if (!PG_CRED) {
    console.error('Set N8N_PG_CREDENTIAL_ID in .env first.');
    process.exit(1);
  }
  await deploy(sourceIngestWorkflow());
  // Tier 0 of the ladder. Without a mailbox credential the workflow would sit
  // there failing every poll, which is worse than not deploying it — a red
  // workflow that is expected to be red trains everyone to ignore red.
  if (!IMAP_CRED) {
    console.error('N8N_IMAP_CREDENTIAL_ID not set — skipping Newsletter Intake (tier 0).');
    console.error('  In n8n: Credentials -> IMAP, name it "BEXT Newsletter Mailbox".');
    console.error('  Host imap.gmail.com, port 993, SSL on, and a Google app password');
    console.error('  from https://myaccount.google.com/apppasswords (needs 2-step verification).');
    console.error('  Then put the credential id in .env as N8N_IMAP_CREDENTIAL_ID.');
  } else {
    await deploy(newsletterIntakeWorkflow());
  }
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

  // The channel card. Skipped without its webhook, for the same reason the
  // newsletter workflow is: a workflow that fails every run trains people to
  // ignore a failing workflow.
  if (!process.env.TEAMS_DAILY_WEBHOOK_URL) {
    console.error('TEAMS_DAILY_WEBHOOK_URL not set — skipping Daily News Card.');
    console.error('  Create the Teams Workflows webhook on the Daily report channel, then:');
    console.error('  node graph/create-channel-flow.js --url --id 77d08f87-08c9-836a-60ef-3e1aab126aaa');
  } else {
    await deploy(dailyNewsCardWorkflow());
  }

  // Content generation. All three call Gemini, so without a key they would fail
  // every run — the same red-workflow trade refused above. LinkedIn Publish does
  // not itself call Gemini, but it is pointless without drafts to publish, so the
  // three deploy together.
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set — skipping Content Topics, Content Drafts and LinkedIn Publish.');
  } else {
    await deploy(contentTopicsWorkflow());
    await deploy(contentDraftsWorkflow());
    await deploy(linkedinPublishWorkflow());
    // The dashboard's write path. Authenticated, so it is skipped without the
    // header-auth credential rather than deployed as an open write endpoint —
    // the same trade as Teams Inbound.
    if (!WEBHOOK_CRED) {
      console.error('N8N_WEBHOOK_CREDENTIAL_ID not set — skipping Content Actions (the dashboard write path).');
      console.error('  Create an n8n Header Auth credential named "BEXT Webhook Auth" and put its id in .env.');
    } else {
      await deploy(contentActionsWorkflow());
    }
  }

  // The two that watch the other seven. Deployed last so that a failure while
  // building them cannot stop the pipeline itself from being deployed — the
  // monitor must never be the reason the monitored thing is missing.
  //
  // Both call the n8n API from inside n8n, so they need N8N_API_KEY in the
  // container (infra/docker-compose.yml). Without it they would deploy and fail
  // every run, which trains people to ignore a red workflow — the same trade
  // refused above for Newsletter Intake and Teams Inbound.
  if (!process.env.N8N_API_KEY) {
    console.error('N8N_API_KEY not set — skipping Self Heal and Contract Test.');
    console.error('  Both call the n8n API from inside n8n. Add N8N_API_KEY to .env, and to the');
    console.error('  n8n service environment in infra/docker-compose.yml, then redeploy the container.');
  } else {
    await deploy(selfHealWorkflow());
    await deploy(contractTestWorkflow());
  }
})();
