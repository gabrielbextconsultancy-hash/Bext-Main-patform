#!/usr/bin/env node
/**
 * The technical reference for the Industry Daily Report pipeline.
 *
 * The two client PDFs already in PROJECT FILES answer "how does it work" and
 * "why did this article not appear". This one answers "what runs, under what
 * rules, and what do I do when something looks wrong" — the document a person
 * inheriting the system would need.
 *
 *   node docs/build-system-doc.js
 *
 * Read live: the schedules come from the n8n instance, the gates from the
 * deployed query, the counts from the database. A documentation file can drift
 * from the system; a document generated out of the system cannot.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.OVERVIEW_OUT || 'D:/COMPANY/HUNT ST/PROJECT FILES';
const ROOT = path.join(__dirname, '..');
const B = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PIPELINE = [
  ['BEXT Daily News — 1 Source Ingest', 'Walks every active source down the retrieval ladder and stores what it finds.'],
  ['BEXT Daily News — 2 Newsletter Intake', 'Reads the newsletter mailbox — the route past account walls.'],
  ['BEXT Daily News — 3 Article Analysis', 'Gemini scores relevance and writes the client-facing summary.'],
  ['BEXT Daily News — 4 News Quality', 'Reads publication dates and article bodies, follows related links, judges news vs reference, writes the day audit.'],
  ['BEXT Daily News — 5 Daily Report', 'Assembles the sheet, reviews it, sends it, and stores the fetch audit.'],
  ['BEXT Daily News — 6 Teams Card', 'Posts the morning summary card to Teams.'],
];

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });
  const one = async (q) => (await db.query(q)).rows[0];

  // Live schedules, so the document cannot claim a cadence the instance is not running.
  const list = (await (await fetch(`${B}/api/v1/workflows?limit=100`, { headers: H })).json()).data;
  const sched = [];
  for (const [name, purpose] of PIPELINE) {
    const w = list.find(x => x.name === name);
    let when = 'NOT DEPLOYED';
    if (w) {
      const f = await (await fetch(`${B}/api/v1/workflows/${w.id}`, { headers: H })).json();
      const t = f.nodes.find(n => /trigger|imap/i.test(n.type));
      const iv = t?.parameters?.rule?.interval;
      // n8n names the cron field 'expression', not 'cronExpression' — testing the
      // wrong key printed "every undefined minutes" for the three cron workflows,
      // including the 05:00 send. Read the cron, then translate it.
      const cronText = (c) => {
        const m = String(c).match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
        return m ? `${String(m[2]).padStart(2, '0')}:${String(m[1]).padStart(2, '0')}` : String(c);
      };
      when = !iv ? 'as mail arrives (IMAP)'
        : iv.map(x => x.expression || x.cronExpression
            ? cronText(x.expression || x.cronExpression)
            : x.field === 'hours' ? `every ${x.hoursInterval} hour(s)`
            : `every ${x.minutesInterval} minutes`).join(' · ');
    }
    sched.push({ name, purpose, when, active: !!w?.active });
  }

  const counts = await one(`SELECT
    (SELECT count(*)::int FROM sources) AS sources,
    (SELECT count(*)::int FROM sources WHERE active) AS active,
    (SELECT count(*)::int FROM brief_links) AS links,
    (SELECT count(*)::int FROM articles) AS articles,
    (SELECT count(*)::int FROM reports WHERE status='sent') AS sent`);
  const migrations = fs.readdirSync(path.join(ROOT, 'db/migrations')).filter(f => f.endsWith('.sql'));
  const checks = (fs.readFileSync(path.join(ROOT, 'n8n/preflight.js'), 'utf8')
    .match(/check\('R\d+'/g) || []).length;

  const h = [];
  const p = (x) => h.push(x);
  p('<!doctype html><html><head><meta charset="utf-8"><style>');
  p('body{font:12.5px/1.55 Georgia,serif;color:#111827;margin:38px 44px;max-width:840px}');
  p('h1{font:600 22px/1.3 Arial,sans-serif;margin:0 0 3px}');
  p('h2{font:600 14.5px/1.3 Arial,sans-serif;margin:26px 0 7px;color:#0f766e;border-bottom:1px solid #d1d5db;padding-bottom:3px}');
  p('h3{font:600 12.5px/1.3 Arial,sans-serif;margin:16px 0 4px}');
  p('.sub{color:#6b7280;font:11.5px Arial,sans-serif;margin-bottom:20px}');
  p('table{border-collapse:collapse;width:100%;font:11.5px Arial,sans-serif;margin:8px 0}');
  p('th{text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding:5px 7px;border-bottom:1.5px solid #d1d5db}');
  p('td{padding:5px 7px;border-bottom:1px solid #f3f4f6;vertical-align:top}');
  p('code{font:11px Consolas,monospace;background:#f3f4f6;padding:1px 4px;border-radius:3px}');
  p('.box{background:#f0fdfa;border-left:4px solid #0f766e;padding:10px 14px;margin:12px 0}');
  p('.warn{background:#fffbeb;border-left:4px solid #d97706;padding:10px 14px;margin:12px 0}');
  p('.muted{color:#6b7280}ul{padding-left:18px}li{margin:4px 0}');
  p('.foot{color:#6b7280;font:10.5px Arial,sans-serif;border-top:1px solid #e5e7eb;margin-top:26px;padding-top:9px}');
  p('</style></head><body>');

  p('<div class="sub" style="letter-spacing:.14em;font-size:10px">BEXT CONSULTANCY &middot; TECHNICAL REFERENCE</div>');
  p('<h1>Industry Daily Report &mdash; system documentation</h1>');
  p('<div class="sub">What runs, under what rules, and what to do when something looks wrong. Generated from the live system on '
    + esc((await one("SELECT (now() AT TIME ZONE 'Australia/Melbourne')::text AS t")).t.slice(0, 16))
    + ' Melbourne &mdash; schedules read from the n8n instance, gates from the deployed query, counts from the database.</div>');

  p('<div class="box"><b>At a glance.</b> ' + counts.active + ' active sources of ' + counts.sources
    + ' registered, covering ' + counts.links + ' brief links &middot; ' + counts.articles.toLocaleString()
    + ' articles held &middot; ' + counts.sent + ' sheets delivered &middot; ' + migrations.length
    + ' migrations applied &middot; ' + checks + ' regression checks in preflight.</div>');

  // ── 1 what runs
  p('<h2>1. What runs, and when</h2>');
  p('<p>Six workflows, all on Melbourne time. The report is scheduled by cron inside n8n; the timezone is set per workflow, never assumed from the server.</p>');
  p('<table><tr><th>Workflow</th><th>Schedule</th><th>State</th><th>What it does</th></tr>');
  sched.forEach(x => p('<tr><td><b>' + esc(x.name.replace('BEXT Daily News — ', '')) + '</b></td><td><code>'
    + esc(x.when) + '</code></td><td>' + (x.active ? 'active' : '<b>inactive</b>') + '</td><td>' + esc(x.purpose) + '</td></tr>'));
  p('</table>');
  p('<p class="muted">The day closes at 23:50 rather than midnight so the final quality pass completes inside the day it is closing. The report sends at 05:00 and the Teams card at 05:20.</p>');

  // ── 2 the rules
  p('<h2>2. The rules that decide what sends</h2>');
  p('<p>All five are enforced in one place &mdash; the <code>Top articles, prior day</code> query in the Daily Report workflow &mdash; and mirrored in the dashboard preview so the two cannot disagree.</p>');
  p('<table><tr><th>Rule</th><th>Why it exists</th></tr>');
  p('<tr><td><b>Window</b><br>previous publication day, plus a two-day reach-back for anything never sent</td><td>An article published at 23:30 was first seen after midnight, missed its own report and was filtered out of the next. Sixteen of twenty-six &ldquo;missing&rdquo; articles reported by the client on 25 Aug had been fetched all along.</td></tr>');
  p('<tr><td><b>Gather cutoff</b><br>nothing gathered today may send today</td><td>Separate from the publication bound: a piece published yesterday but fetched at 02:00 today would otherwise go out at 05:01 the same morning.</td></tr>');
  p('<tr><td><b>Verified age</b><br>an article whose page has not been opened for a date cannot send</td><td>Unknown age defaulted to &ldquo;today&rdquo;, so an October 2025 explainer reached the queue with a read body and an unread date. Unknown is not new.</td></tr>');
  p('<tr><td><b>Exactly once</b><br><code>report_items</code> joined to sent reports</td><td>Status is checked, not mere presence: an item recorded against a report that failed to send is still owed to the reader.</td></tr>');
  p('<tr><td><b>Relevance</b><br>scored 1 or above, not judged reference or off-topic, not stale</td><td>Two AI passes: one scores relevance, a second decides whether the page is news at all. A standing reference page can score 83 and still be held.</td></tr>');
  p('</table>');
  p('<div class="box"><b>RenewEconomy is exempt from the score floor</b> by client instruction &mdash; <code>always_relevant</code> in the registry. Everything it publishes reaches the sheet.</div>');

  // ── 3 the guardrail
  p('<h2>3. The check before the send</h2>');
  p('<p>Between the ledger write and Microsoft Graph sit two nodes with deliberately different authority.</p>');
  p('<ul>');
  p('<li><b>Gemini reviews the sheet</b> reads the summaries and answers in JSON. It <b>advises only.</b> A model refusing to send at five in the morning, with nobody awake to overrule it, is worse than a clumsy sentence going out.</li>');
  p('<li><b>Validate before send</b> decides, on facts alone: summaries missing across a third of the sheet, encoding artefacts, double-escaped entities in the text, or fewer distinct summaries than items &mdash; the signature of a scoring batch that failed identically for everything.</li>');
  p('</ul>');
  p('<p>It <b>fails open</b>: no key, a spent quota or an unreachable endpoint still sends, recording &ldquo;reviewer did not answer&rdquo;. A held sheet stays <code>rendered</code>, so its articles are not marked sent and the next window carries them forward intact.</p>');
  p('<div class="warn"><b>Guarding the guard.</b> <code>node n8n/validate-replay.js</code> replays the shipped validator over reports already delivered; preflight R036 fails the build if any would now be blocked. The first draft of the validator would have stopped three of five real sheets &mdash; every match a crop parameter inside an image URL.</div>');

  // ── 4 data
  p('<h2>4. Where things are stored</h2>');
  p('<table><tr><th>Table</th><th>Holds</th></tr>');
  p('<tr><td><code>sources</code></td><td>The monitored publications. Seeded from <code>sources/registry.yaml</code>, which is the source of truth &mdash; never hand-edit the table.</td></tr>');
  p('<tr><td><code>brief_links</code></td><td>The client brief&rsquo;s numbered hyperlinks, mapped to sources.</td></tr>');
  p('<tr><td><code>articles</code></td><td>Every article ever gathered, with its body text, publication date and date state.</td></tr>');
  p('<tr><td><code>article_analysis</code></td><td>Gemini&rsquo;s score, summary, topics and model per article.</td></tr>');
  p('<tr><td><code>reports</code> / <code>report_items</code></td><td>Each sheet as delivered, its HTML, and the exactly-once ledger of what it carried.</td></tr>');
  p('<tr><td><code>day_audits</code></td><td>The per-day audit, rebuilt three times daily.</td></tr>');
  p('<tr><td><code>source_reports</code></td><td>The daily fetch-audit PDF, stored as bytes per publication day.</td></tr>');
  p('<tr><td><code>integration_health</code></td><td>What each run reported about itself. The dashboard&rsquo;s &ldquo;last recorded run&rdquo; reads this.</td></tr>');
  p('</table>');

  // ── 5 runbook
  p('<h2>5. Operating it</h2>');
  p('<p>All commands run from the repository root, with the Postgres tunnel open.</p>');
  p('<table><tr><th>Command</th><th>When to use it</th></tr>');
  p('<tr><td><code>node n8n/preflight.js</code></td><td><b>Before assuming anything works.</b> ' + checks + ' checks, each a failure already paid for once.</td></tr>');
  p('<tr><td><code>node n8n/build-workflows.js</code></td><td>Build and deploy every workflow. The repo is the source of truth, never the n8n UI.</td></tr>');
  p('<tr><td><code>node graph/preview-report.js</code></td><td>Render a day&rsquo;s sheet without sending it.</td></tr>');
  p('<tr><td><code>node n8n/validate-replay.js --verbose</code></td><td>After changing any rule in the pre-send validator.</td></tr>');
  p('<tr><td><code>node n8n/rebuild-audit.js</code></td><td>Refresh the day audit now instead of waiting for 23:50.</td></tr>');
  p('<tr><td><code>node sources/backfill-dates.js</code></td><td>Read publication dates for articles still undated.</td></tr>');
  p('<tr><td><code>node sources/backfill-bodies.js</code></td><td>Read article text where only the listing blurb was stored.</td></tr>');
  p('<tr><td><code>node db/prune-before.js --date YYYY-MM-DD --dry</code></td><td>See what a prune would remove. Drop <code>--dry</code> to commit it.</td></tr>');
  p('<tr><td><code>node db/seed-sources.js</code></td><td>After editing <code>sources/registry.yaml</code>.</td></tr>');
  p('</table>');

  // ── 6 failure modes
  p('<h2>6. Failure modes worth knowing</h2>');
  p('<ul>');
  p('<li><b>A source can succeed and return nothing useful.</b> A client-rendered listing answers 200 with navigation links and no stories &mdash; VicGrid returned forty of them. Source health is therefore counted by <i>articles received</i>, never by fetch status. The remedy is usually the site&rsquo;s own sitemap.</li>');
  p('<li><b>Deleting articles does not stop them returning.</b> Deduplication works by finding the row already present, so a prune removes the very record keeping a feed out; the next hourly sweep re-adds everything still listed. An age floor at insert is what makes a prune stay done.</li>');
  p('<li><b>A share button can look exactly like an article.</b> WordPress links each share control to the article itself with a parameter, so the URL is genuine and only the wording gives it away.</li>');
  p('<li><b>Two implementations of one rule will drift.</b> The stored audit and the dashboard once disagreed by 109 articles because <code>Number(null)</code> is <code>0</code>. Preflight now runs both over the same day and compares.</li>');
  p('<li><b>Escapes do not survive being inlined twice.</b> Library code is embedded into n8n Code nodes through a template literal, which eats backslashes: a character class lost one and a truncation test silently matched nothing for twelve reports.</li>');
  p('</ul>');
  p('<p class="muted">Each of these, and thirty-five others, is written up in <code>docs/REGRESSIONS.md</code> with the check that now prevents it.</p>');

  p('<div class="foot">Generated by <code>docs/build-system-doc.js</code> from the live instance and database. Regenerate after any material change rather than editing this file &mdash; a document written by hand drifts from the system; one generated out of it cannot.</div>');
  p('</body></html>');

  const html = h.join('\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_DIR + '/BEXT-Daily-Report-System-Documentation.html', html);
  const r = await fetch('http://127.0.0.1:8080/pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }),
  });
  if (!r.ok) throw new Error('pdf ' + r.status);
  const out = OUT_DIR + '/BEXT-Daily-Report-System-Documentation.pdf';
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  console.log('wrote ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
  sched.forEach(x => console.log('  ' + (x.active ? 'ON ' : 'OFF') + ' ' + x.name.replace('BEXT Daily News — ', '').padEnd(22) + x.when));
  await db.end();
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
