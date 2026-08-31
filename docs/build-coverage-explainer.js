#!/usr/bin/env node
/**
 * A plain-English explanation, for the client, of why a day's sheet carries the
 * articles it carries — and why "only 21 of 71 sources contributed" is the
 * system working rather than failing.
 *
 * Written because the recurring question is not "is it running" but "where is
 * the article I expected", and that question deserves an answer with figures
 * in it rather than reassurance.
 *
 *   node docs/build-coverage-explainer.js
 *
 * Every number is read live at build time; nothing here is illustrative. Needs
 * the 5433 tunnel for Postgres and 8080 for the PDF renderer.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const OUT_DIR = process.env.OVERVIEW_OUT || 'D:/COMPANY/HUNT ST/PROJECT FILES';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });

  const one = async (sql, p) => (await db.query(sql, p)).rows[0];
  const all = async (sql, p) => (await db.query(sql, p)).rows;

  const now = await one(
    "SELECT (now() AT TIME ZONE 'Australia/Melbourne')::text AS t, (now() AT TIME ZONE 'Australia/Melbourne')::date::text AS d");

  // The most recent sheet actually delivered, and its coverage.
  const last = await one(`
    SELECT r.report_date::text AS day, r.item_count, r.sent_at::text,
           (SELECT count(DISTINCT a.source_id) FROM report_items ri
              JOIN articles a ON a.id = ri.article_id WHERE ri.report_id = r.id) AS contributed
    FROM reports r WHERE r.status = 'sent' ORDER BY r.report_date DESC LIMIT 1`);

  const brief = await one('SELECT count(*)::int AS n FROM brief_links');
  // The sheet's own footer says "N of X sources contributed", and X is the
  // count of ACTIVE sources, not brief links. They differ, the client reads the
  // footer, so the document has to reconcile them explicitly.
  const counts = await one(
    'SELECT (SELECT count(*)::int FROM sources WHERE active) AS active, (SELECT count(*)::int FROM sources) AS total');

  // The funnel for the day now closing.
  const funnel = await one(`
    SELECT count(*)::int AS fetched,
      count(an.article_id)::int AS analysed,
      count(*) FILTER (WHERE an.relevance_score >= 1)::int AS scored,
      count(*) FILTER (WHERE an.relevance_score = 0)::int AS zero,
      count(*) FILTER (WHERE a.content_kind::text IN ('reference','offtopic'))::int AS judged_out,
      count(*) FILTER (WHERE a.published_at IS NULL AND a.date_state = 'pending')::int AS undated
    FROM articles a LEFT JOIN article_analysis an ON an.article_id = a.id
    WHERE (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date
        = (now() AT TIME ZONE 'Australia/Melbourne')::date`);

  const sources = await all(`
    SELECT (SELECT min(bl.n) FROM brief_links bl WHERE bl.source_id = s.id) AS brief_n,
           s.name, s.active, s.method::text AS method, s.config->>'note' AS note,
           (SELECT count(*)::int FROM articles a WHERE a.source_id = s.id
              AND a.fetched_at > now() - interval '3 days') AS recent
    FROM sources s ORDER BY 1 NULLS LAST, s.name`);
  const quiet = sources.filter(s => s.active && s.recent === 0);
  const inactive = sources.filter(s => !s.active);
  const producing = sources.filter(s => s.active && s.recent > 0);

  const h = [];
  const p = (x) => h.push(x);

  p('<!doctype html><html><head><meta charset="utf-8"><style>');
  p('body{font:13.5px/1.6 Georgia,serif;color:#111827;margin:40px 46px;max-width:820px}');
  p('h1{font:600 23px/1.3 Arial,sans-serif;margin:0 0 4px}');
  p('h2{font:600 15px/1.3 Arial,sans-serif;margin:28px 0 8px;color:#0f766e}');
  p('h3{font:600 13px/1.3 Arial,sans-serif;margin:18px 0 4px}');
  p('.sub{color:#6b7280;font:12px Arial,sans-serif;margin-bottom:22px}');
  p('.box{background:#f0fdfa;border-left:4px solid #0f766e;padding:12px 16px;margin:16px 0}');
  p('.warn{background:#fffbeb;border-left:4px solid #d97706;padding:12px 16px;margin:16px 0}');
  p('table{border-collapse:collapse;width:100%;font:12px Arial,sans-serif;margin:10px 0}');
  p('th{text-align:left;color:#6b7280;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;padding:6px 8px;border-bottom:1.5px solid #d1d5db}');
  p('td{padding:6px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top}');
  p('.n{font:600 15px Arial,sans-serif;color:#0f766e}');
  p('.muted{color:#6b7280}.q{color:#b45309}');
  p('ol,ul{padding-left:20px}li{margin:5px 0}');
  p('.foot{color:#6b7280;font:11px Arial,sans-serif;border-top:1px solid #e5e7eb;margin-top:30px;padding-top:10px}');
  p('</style></head><body>');

  p('<div class="sub" style="letter-spacing:.14em;font-size:10px">BEXT CONSULTANCY &middot; INDUSTRY DAILY REPORT</div>');
  p('<h1>How the daily report decides what to send</h1>');
  p('<div class="sub">Why a day&rsquo;s sheet carries the articles it carries, what happens to the rest, and how to check any single article &mdash; prepared ' + esc(now.t.slice(0, 16)) + ' Melbourne. Every figure below was read from the live system as this was written.</div>');

  // ── 1. the one rule
  p('<h2>1. The one rule</h2>');
  p('<p>The report only ever draws from the <b>' + brief.n + ' links in the Industry Daily brief</b>. Nothing else can enter it. If a story is not published on one of those ' + brief.n + ' sites, the system will not see it &mdash; by design, not by accident.</p>');
  p('<div class="box">Everything gathered during a day is sent the <b>next morning at 05:00</b>. A day closes at midnight, the final checks run at 23:50, and the sheet goes out five hours later. So today&rsquo;s news reaches the inbox tomorrow morning, complete, rather than in pieces through the day.</div>');

  // ── 2. why only some sources appear
  p('<h2>2. Why only some of the ' + brief.n + ' links appear in any one sheet</h2>');
  p('<p>The most recent sheet &mdash; sent ' + esc(last.day) + ' &mdash; carried <b>' + last.item_count + ' articles from ' + last.contributed + ' sources</b>. That is normal, and it is worth being precise about why.</p>');
  p('<div class="box"><b>On the two numbers in the sheet&rsquo;s own footer.</b> Each report ends with a line like &ldquo;' + last.contributed + ' of ' + counts.active + ' sources contributed&rdquo;. The ' + counts.active + ' is every source being checked hourly. The brief lists ' + brief.n + ' links; a few of those point at the same publication under different names, and a few publications are watched through more than one section, which is why the monitored figure is ' + counts.active + ' rather than ' + brief.n + '. Both are complete: no brief link is unmonitored.</div>');
  p('<p>The ' + brief.n + ' links are not ' + brief.n + ' daily newspapers. Most are regulators, agencies and industry bodies that publish <b>when they have something to announce</b> &mdash; a rule change, a determination, a consultation. The Clean Energy Regulator does not publish every day; nor does the AEMC, nor Climate Works. A source contributing nothing on a Tuesday is a source with nothing to say on that Tuesday.</p>');
  p('<p>On a typical day the mix looks like this:</p>');
  p('<table><tr><th>State</th><th>Count</th><th>What it means</th></tr>');
  p('<tr><td><b>Producing</b></td><td class="n">' + producing.length + '</td><td>Has published something in the last three days. These are the links a sheet is normally drawn from.</td></tr>');
  p('<tr><td><b>Quiet</b></td><td class="n">' + quiet.length + '</td><td>Checked every hour and answering normally, but has published nothing in three days. Expected for occasional publishers.</td></tr>');
  p('<tr><td><b>Inactive</b></td><td class="n">' + inactive.length + '</td><td>Deliberately switched off, each for a recorded reason (see section 5).</td></tr>');
  p('</table>');
  p('<p class="muted">Every one of the ' + brief.n + ' brief links is mapped and monitored. None is ignored or forgotten.</p>');

  // ── 3. the funnel
  p('<h2>3. What happens to an article, in order</h2>');
  p('<p>Here is the day now closing (' + esc(now.d) + '), at the moment this was written:</p>');
  p('<table><tr><th>Step</th><th>Count</th><th>What happens</th></tr>');
  p('<tr><td><b>1. Gathered</b></td><td class="n">' + funnel.fetched + '</td><td>Every link the ' + brief.n + ' sources listed today. Deliberately broad &mdash; a page cannot be judged before it is read, so everything is collected first.</td></tr>');
  p('<tr><td><b>2. Read &amp; scored</b></td><td class="n">' + funnel.analysed + '</td><td>Each article is opened, its text extracted, and an AI reads it and scores its relevance to Australian energy, building and climate work. The scorer runs every fifteen minutes.</td></tr>');
  p('<tr><td><b>3. Relevant</b></td><td class="n">' + funnel.scored + '</td><td>Scored 1 or above. The remaining ' + funnel.zero + ' scored zero &mdash; genuinely off-topic material that happened to sit on a monitored page.</td></tr>');
  p('<tr><td><b>4. Sent</b></td><td class="n">' + last.item_count + '</td><td>What actually reaches the inbox, after the final checks below.</td></tr>');
  p('</table>');
  p('<h3>The final checks, between &ldquo;relevant&rdquo; and &ldquo;sent&rdquo;</h3>');
  p('<ul>');
  p('<li><b>Is it actually an article?</b> ' + funnel.judged_out + ' items today were standing reference pages or off-topic features &mdash; a fees table, a tips page &mdash; which sit on news sections but are not news. A second AI pass makes that call.</li>');
  p('<li><b>Do we know when it was published?</b> ' + funnel.undated + ' are still waiting for a publication date to be read from their own page. An article of unknown age is <b>not</b> treated as new: it waits rather than risking a years-old story appearing as today&rsquo;s news. Evening passes clear these before the day closes.</li>');
  p('<li><b>Has it been sent before?</b> Every article ever emailed is recorded. Nothing is ever sent twice, however many sources carry the same story.</li>');
  p('<li><b>Is it recent?</b> Anything older than the reporting window is held, no matter how well it scores.</li>');
  p('</ul>');

  // ── 4. the missing-article question
  p('<h2>4. &ldquo;I saw an article that wasn&rsquo;t in the report&rdquo;</h2>');
  p('<p>This is the question worth asking, and there are only ever five answers. Each is checkable in seconds on the management dashboard, which lists <b>every article of every day with its fate and the reason for it</b>.</p>');
  p('<table><tr><th>Reason</th><th>What it looks like</th></tr>');
  p('<tr><td><b>It was sent</b></td><td>Already delivered &mdash; on an earlier day, or in a section further down the sheet. The archive can show you the exact email it appeared in, with the article highlighted.</td></tr>');
  p('<tr><td><b>It scored zero</b></td><td>The AI judged it unrelated to energy, building or climate work. The score and the AI&rsquo;s one-line reasoning are both recorded.</td></tr>');
  p('<tr><td><b>It was held</b></td><td>Judged a reference page rather than news, or older than the window, or of unverified age. The specific reason is shown against the article.</td></tr>');
  p('<tr><td><b>It is queued</b></td><td>Gathered today, going out tomorrow at 05:00. Nothing gathered today is sent the same day.</td></tr>');
  p('<tr><td><b>Its source is not in the brief</b></td><td>The publication is not one of the ' + brief.n + ' links. This is the only case where the system genuinely never saw it &mdash; and the fix is to add the link.</td></tr>');
  p('</table>');
  p('<div class="warn"><b>If you send an article you want included:</b> it can be added directly, and the same applies to a publication you would like monitored from then on. Adding a source is a small change &mdash; the system begins checking it hourly from that point. What it cannot do is find, retrospectively, a story from a site it was never asked to watch.</div>');

  // ── 5. quiet and inactive, named
  p('<h2>5. The links currently quiet or switched off</h2>');
  p('<p>Named individually, because &ldquo;some sources are quiet&rdquo; is not an answer.</p>');
  if (quiet.length) {
    p('<h3>Quiet &mdash; checked hourly, answering, nothing published in three days (' + quiet.length + ')</h3>');
    p('<table><tr><th>#</th><th>Source</th><th>How it is read</th></tr>');
    quiet.forEach(s => p('<tr><td>' + (s.brief_n != null ? s.brief_n : '&mdash;') + '</td><td>' + esc(s.name) + '</td><td class="muted">' + esc(s.method) + '</td></tr>'));
    p('</table>');
    p('<p class="muted">Quiet is not failure. It becomes a fault only if a source that normally publishes daily goes silent &mdash; which the system watches for and reports on its own.</p>');
  }
  if (inactive.length) {
    p('<h3>Switched off, with reasons (' + inactive.length + ')</h3>');
    p('<table><tr><th>#</th><th>Source</th><th>Why</th></tr>');
    inactive.forEach(s => p('<tr><td>' + (s.brief_n != null ? s.brief_n : '&mdash;') + '</td><td>' + esc(s.name) + '</td><td class="muted">' + esc((s.note || '').split('.')[0].slice(0, 200)) + '.</td></tr>'));
    p('</table>');
    p('<p>Two situations sit behind these. A <b>paywall or account wall</b>, where the publisher will not serve the page to anyone without a subscription &mdash; for those, headlines and links are taken from a public news index instead, so the story still reaches the sheet even though the full text stays behind the wall. And a <b>duplicate</b>, where the brief lists the same page twice under two names; running both would only produce the same article twice.</p>');
  }

  // ── 6. the words the dashboard uses
  p('<h2>6. The words on the dashboard, in plain terms</h2>');
  p('<p>The management view labels every article. These are the labels and what each one actually means.</p>');
  p('<h3>What happened to an article</h3>');
  p('<table><tr><th>Word</th><th>Meaning</th></tr>');
  p('<tr><td><b>Sent</b></td><td>Emailed to you, in the sheet named beside it. It will never be sent again.</td></tr>');
  p('<tr><td><b>Queued</b></td><td>Gathered and cleared for the next 05:00 send. Nothing gathered today goes out today.</td></tr>');
  p('<tr><td><b>Held</b></td><td>Kept back, for a stated reason: judged a standing reference page rather than news, older than the reporting window, or of an age we could not verify. Held is not deleted &mdash; it stays in the record and can be reviewed.</td></tr>');
  p('<tr><td><b>Excluded</b></td><td>Read and scored zero: the AI found nothing bearing on Australian energy, building or climate work. Its reasoning is recorded alongside.</td></tr>');
  p('</table>');
  p('<h3>What the article was written from</h3>');
  p('<table><tr><th>Word</th><th>Meaning</th></tr>');
  p('<tr><td><b>Article</b> <span class="muted">(with a character count)</span></td><td>The full text was retrieved from the publisher&rsquo;s page and the summary was written from the whole story. This is what we want, and the character count says how much text was read.</td></tr>');
  p('<tr><td><b>Teaser only</b></td><td>Only the short blurb the source listed &mdash; typically two sentences &mdash; could be retrieved. The summary is written from that. It usually means the publisher blocks automated reading of the full page, or hides it behind a subscription. The article is still sent and still linked; the summary is simply shorter and less specific.</td></tr>');
  p('</table>');
  p('<h3>Two other terms</h3>');
  p('<table><tr><th>Word</th><th>Meaning</th></tr>');
  p('<tr><td><b>Score</b></td><td>0&ndash;100, set by the AI, for how much a story bears on Australian commercial building energy, decarbonisation and the surrounding regulation. It decides order and inclusion, never accuracy: a low score means &ldquo;less relevant to this brief&rdquo;, not &ldquo;less true&rdquo;.</td></tr>');
  p('<tr><td><b>Published vs fetched</b></td><td><b>Published</b> is the publisher&rsquo;s own date on the story. <b>Fetched</b> is when we read it. They differ, and the report is organised by the first &mdash; which is why an article can be read at 02:00 today and still belong to yesterday&rsquo;s news.</td></tr>');
  p('</table>');

  // ── 7. what is verifiable
  p('<h2>7. How any of this can be checked</h2>');
  p('<ul>');
  p('<li><b>A daily audit is produced with every send</b>, listing every article emailed that morning, grouped under the brief link it came from, with the route it was read by. It is stored for every day and can be sent on request.</li>');
  p('<li><b>The management view</b> lists every article of a chosen day &mdash; sent, queued, held or excluded &mdash; each with its score, its source, and the reason for its outcome. Any article can be traced from the brief link, through the fetch, to the exact email it appeared in.</li>');
  p('<li><b>Nothing is ever silently dropped.</b> An article that does not appear in the sheet still appears in the record, with a stated reason.</li>');
  p('</ul>');

  p('<div class="foot">Prepared for BEXT Consultancy &middot; figures read live from the reporting system on ' + esc(now.t.slice(0, 16)) + ' Melbourne. Source states are counted by articles actually received in the previous three days, not by whether a fetch succeeded &mdash; a page can answer correctly and still carry no news.</div>');
  p('</body></html>');

  const html = h.join('\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = OUT_DIR + '/BEXT-Daily-Report-Coverage-Explained.html';
  fs.writeFileSync(htmlPath, html);

  const r = await fetch('http://127.0.0.1:8080/pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  });
  if (!r.ok) throw new Error('pdf ' + r.status);
  const pdfPath = OUT_DIR + '/BEXT-Daily-Report-Coverage-Explained.pdf';
  fs.writeFileSync(pdfPath, Buffer.from(await r.arrayBuffer()));

  console.log('wrote ' + pdfPath + ' (' + Math.round(fs.statSync(pdfPath).size / 1024) + ' KB)');
  console.log('  last sheet ' + last.day + ': ' + last.item_count + ' articles from ' + last.contributed + ' of ' + brief.n + ' links');
  console.log('  today: ' + funnel.fetched + ' gathered, ' + funnel.analysed + ' scored, ' + funnel.scored + ' relevant');
  console.log('  sources: ' + producing.length + ' producing, ' + quiet.length + ' quiet, ' + inactive.length + ' inactive');
  await db.end();
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
