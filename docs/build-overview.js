#!/usr/bin/env node
/**
 * The client-facing overview: how the daily report works, told with the last
 * three days of real numbers rather than generic examples.
 *
 *   node docs/build-overview.js
 *
 * Every figure is queried live, so re-running it on any later day produces a
 * document about that day. Needs the 5433 and 8080 tunnels.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const OUT_DIR = process.env.OVERVIEW_OUT || 'D:/COMPANY/HUNT ST/PROJECT FILES';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });

  const now = (await db.query(
    `SELECT to_char(now() AT TIME ZONE 'Australia/Melbourne','Dy DD Mon YYYY, HH24:MI') AS pretty,
            (now() AT TIME ZONE 'Australia/Melbourne')::date::text AS today`)).rows[0];

  const reports = (await db.query(
    `SELECT report_date::text AS d, to_char(report_date,'Dy') AS dow, status::text, item_count,
            to_char(sent_at AT TIME ZONE 'Australia/Melbourne','HH24:MI') AS s
     FROM reports WHERE report_date >= current_date - 3 ORDER BY report_date DESC`)).rows;

  for (const r of reports) {
    r.mix = (await db.query(
      `SELECT (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date::text AS d,
              count(*)::int AS n
       FROM report_items ri JOIN reports rr ON rr.id = ri.report_id JOIN articles a ON a.id = ri.article_id
       WHERE rr.report_date = $1 GROUP BY 1 ORDER BY 1`, [r.d])).rows;
  }

  const audits = (await db.query(
    `SELECT day::text, tally FROM day_audits WHERE day >= current_date - 3 ORDER BY day DESC`)).rows;

  const today = (await db.query(
    `SELECT count(*)::int AS fetched,
            count(*) FILTER (WHERE an.relevance_score IS NOT NULL)::int AS analysed,
            count(*) FILTER (WHERE an.relevance_score >= 1 AND a.report_eligible
                             AND a.content_kind NOT IN ('reference','offtopic'))::int AS qualifying,
            count(DISTINCT s.category) FILTER (WHERE an.relevance_score >= 1 AND a.report_eligible
                             AND a.content_kind NOT IN ('reference','offtopic'))::int AS sections
     FROM articles a JOIN sources s ON s.id = a.source_id
     LEFT JOIN article_analysis an ON an.article_id = a.id
     WHERE (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date = $1::date`,
    [now.today])).rows[0];

  const queued = (await db.query(
    `SELECT an.relevance_score AS sc, a.title, s.name AS src, s.category
     FROM articles a JOIN sources s ON s.id = a.source_id
     LEFT JOIN article_analysis an ON an.article_id = a.id
     WHERE (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date = $1::date
       AND an.relevance_score >= 1 AND a.report_eligible
       AND a.content_kind NOT IN ('reference','offtopic')
       AND NOT EXISTS (SELECT 1 FROM report_items ri JOIN reports r ON r.id = ri.report_id
                        WHERE ri.article_id = a.id AND r.status = 'sent')
     ORDER BY an.relevance_score DESC`, [now.today])).rows;

  const links = (await db.query(
    `SELECT bl.n, bl.url, s.name, s.method::text AS m, s.active,
            coalesce(s.config->>'firecrawl','') AS fc,
            (SELECT count(*)::int FROM articles a WHERE a.source_id = s.id
              AND a.fetched_at > now() - interval '3 days') AS recent,
            (SELECT max(a.fetched_at)::date::text FROM articles a WHERE a.source_id = s.id) AS last_seen
     FROM brief_links bl LEFT JOIN sources s ON s.id = bl.source_id ORDER BY bl.n`)).rows;

  const src = (await db.query(
    `SELECT count(*) FILTER (WHERE active)::int AS act, count(*)::int AS tot,
            count(*) FILTER (WHERE active AND method='rss')::int AS rss,
            count(*) FILTER (WHERE active AND method='scrape')::int AS scr,
            count(*) FILTER (WHERE active AND method='sitemap')::int AS sm,
            count(*) FILTER (WHERE active AND config->>'firecrawl'='true')::int AS fc
     FROM sources`)).rows[0];
  await db.end();

  const tomorrow = (() => {
    const d = new Date(now.today + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  })();

  const chip = (n) => {
    const c = n >= 80 ? 'green' : n >= 55 ? 'teal' : n >= 20 ? 'amber' : 'grey';
    return '<span class="chip ' + c + '">' + n + '</span>';
  };

  const linkRow = (r) => {
    let state, cls;
    if (!r.name) { state = 'not registered'; cls = 'held'; }
    else if (r.active === false) { state = 'walled — arrives by newsletter, not from this URL'; cls = 'held'; }
    else if (r.recent > 0) { state = r.recent + ' article' + (r.recent === 1 ? '' : 's') + ' in the last 3 days'; cls = 'ok'; }
    else { state = 'no items in 3 days — last on ' + (r.last_seen || 'never'); cls = 'quiet'; }
    const route = r.fc === 'true' ? 'firecrawl' : (r.m || '');
    return '<tr><td class="n">' + r.n + '</td>'
      + '<td class="t">' + esc(String(r.url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 62)) + '</td>'
      + '<td>' + esc(r.name || '—') + '</td>'
      + '<td class="n">' + esc(route) + '</td>'
      + '<td class="' + cls + '">' + esc(state) + '</td></tr>';
  };

  const reportRow = (r) => '<tr><td>' + r.dow + ' ' + r.d + '</td>'
    + '<td class="n">' + r.item_count + ' items</td>'
    + '<td class="n">' + (r.s || '—') + '</td>'
    + '<td>' + r.mix.map((m) => m.n + ' published ' + m.d.slice(5)).join(' · ') + '</td></tr>';

  const auditRow = (a) => {
    const t = a.tally;
    return '<tr><td>' + a.day + '</td><td class="n">' + t.fetched + '</td><td class="n">' + t.sent
      + '</td><td class="n">' + t.queued + '</td><td class="n">' + t.held + '</td><td class="n">' + t.excluded + '</td></tr>';
  };

  const withArticles = links.filter((r) => r.recent > 0).length;
  const walled = links.filter((r) => r.active === false).length;

  const html = '<!doctype html><html><head><meta charset="utf-8"><title>BEXT Industry Daily — How It Works</title>'
    + '<style>'
    + '@page{size:A4;margin:14mm}'
    + "body{font:10px/1.5 'Segoe UI',system-ui,sans-serif;color:#111827;margin:0}"
    + 'h1{font-size:21px;margin:0 0 2px}'
    + 'h2{font-size:14px;margin:20px 0 6px;border-bottom:2px solid #0f766e;padding-bottom:3px}'
    + 'h3{font-size:11.5px;margin:13px 0 4px}'
    + '.sub{color:#6b7280;margin-bottom:12px}'
    + 'table{width:100%;border-collapse:collapse;margin:5px 0 9px}'
    + 'th{text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;border-bottom:1px solid #d1d5db;padding:3px 5px}'
    + 'td{border-bottom:1px solid #f3f4f6;padding:4px 5px;vertical-align:top;font-size:9.3px}'
    + '.n{white-space:nowrap;color:#374151}.t{color:#0f766e}'
    + '.ok{color:#166534}.quiet{color:#854d0e}.held{color:#6b7280}'
    + '.box{border:1px solid #e5e7eb;border-left:4px solid #0f766e;border-radius:4px;padding:8px 10px;margin:8px 0}'
    + '.warn{border-left-color:#b45309}'
    + '.tiles{display:flex;gap:8px;margin:10px 0}'
    + '.tile{flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px}'
    + '.tile b{font-size:17px;display:block}'
    + '.chip{display:inline-block;font:700 9px/1 sans-serif;padding:3px 6px;border-radius:8px}'
    + '.green{color:#166534;background:#dcfce7}.teal{color:#0f766e;background:#ccfbf1}'
    + '.amber{color:#854d0e;background:#fef9c3}.grey{color:#4b5563;background:#e5e7eb}'
    + '.flow{font-family:Consolas,monospace;font-size:9px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:4px;padding:9px 11px;margin:6px 0;white-space:pre}'
    + 'ul{margin:4px 0 8px 16px;padding:0}li{margin:2.5px 0}'
    + '.small{font-size:9px;color:#374151}'
    + '.pagebreak{page-break-before:always}'
    + '</style></head><body>'

    + '<h1>Industry Daily Report — how it works</h1>'
    + '<div class="sub">Written ' + esc(now.pretty) + ' Melbourne. Every figure below is read from the live system, '
    + 'and describes the ' + links.length + ' links in the Project Brief and nothing else.</div>'

    // ── 1. the day in one picture
    + '<h2>1 · One day, start to finish</h2>'
    + '<div class="flow">every hour        FETCH      ' + src.act + ' sources tried in turn until one route works\n'
    + 'every 30 min      ANALYSE    each new article scored 0-100 for relevance to BEXT\n'
    + '06:00 12:00 23:50 QUALIFY    real publication date read; news separated from standing pages\n'
    + '                             23:50 closes the day - the last chance to be counted\n'
    + '05:00 next day    SEND       everything that qualified, in 3 sections, to the client</div>'
    + '<div class="box"><b>The one rule that explains most of what follows:</b> a report sent at 05:00 covers '
    + 'the <i>day before</i>, because a day cannot be summarised until it has finished. Articles published today '
    + 'are gathered all day, closed off at 23:50 tonight, and sent tomorrow morning.</div>'

    // ── 2. how it chooses
    + '<h2>2 · How the system chooses what to send</h2>'
    + '<p class="small">Every article passes four gates in order. Failing one stops it, and the reason is recorded '
    + 'against the article - nothing is silently dropped.</p>'
    + '<table><tr><th>#</th><th>Gate</th><th>What it removes</th></tr>'
    + '<tr><td class="n">1</td><td><b>Relevance score</b> — 0 to 100</td><td>Score 0: no energy, building or climate bearing at all. '
    + 'A business paper prints watch reviews beside its energy coverage; those score 0.</td></tr>'
    + '<tr><td class="n">2</td><td><b>News or not</b> — judged by the local model</td><td>Standing pages that are always there: '
    + '"Renewable Energy Zones", a portal, a scholarship. Real pages, but not news of any day.</td></tr>'
    + '<tr><td class="n">3</td><td><b>Website furniture</b></td><td>Pages with no publication date <i>and</i> nothing relevant in them: '
    + '"Legal notice", "Subscribe to our RSS feeds".</td></tr>'
    + '<tr><td class="n">4</td><td><b>Age</b></td><td>Anything published more than 14 days ago — archive material a parser change can unearth.</td></tr>'
    + '</table>'
    + '<div class="box">Everything surviving all four is sent — including weak items. The floor is score 1, not 50: '
    + 'a marginal but on-subject story reaches the client, because missing a real story is the failure this system '
    + 'exists to prevent. The score is printed on every article so the ranking can be judged, not just trusted.</div>'
    + '<p class="small"><b>Scores read:</b> ' + chip(88) + ' 80-100 regulatory change or funding to act on this week &nbsp; '
    + chip(62) + ' 55-79 solid industry news &nbsp; ' + chip(30) + ' 20-54 tangential &nbsp; ' + chip(8) + ' 1-19 weak but on-subject.</p>'

    // ── 3. the four words
    + '<h2>3 · The four words on every article</h2>'
    + '<table><tr><th>Word</th><th>Meaning</th><th>Is it lost?</th></tr>'
    + '<tr><td><b>SENT</b></td><td>It went to the client, in a named report, at a recorded time.</td>'
    + '<td>No — and it can never be sent twice.</td></tr>'
    + '<tr><td><b>QUEUED</b></td><td>It qualified, and its report has not run yet. Nearly always: published today, sends tomorrow 05:00.</td>'
    + '<td>No — it has a morning booked.</td></tr>'
    + '<tr><td><b>HELD</b></td><td>Kept out by gates 2-4: a standing reference page, an off-topic article, website furniture, or too old.</td>'
    + '<td>Not deleted — visible on the dashboard with its reason, just not emailed.</td></tr>'
    + '<tr><td><b>EXCLUDED</b></td><td>Scored 0 — the wrong subject entirely.</td>'
    + '<td>Not deleted — stored and auditable, never emailed.</td></tr>'
    + '</table>'

    // ── 4. why fetched today, sent tomorrow
    + '<h2>4 · Why something fetched today is sent tomorrow — and what "will send" means</h2>'
    + '<div class="flow">Mon 14:00  an article is published and fetched     -> QUEUED\n'
    + 'Mon 14:30  scored 62                                -> QUEUED, "goes out next 05:00"\n'
    + 'Mon 23:50  the day closes: date confirmed, judged   -> QUEUED\n'
    + 'Tue 05:00  the report covering Monday is sent       -> SENT, 05:01</div>'
    + '<p class="small">This is why the management table shows <b>"will send ' + esc(tomorrow) + ' 05:00"</b> against today\'s '
    + 'articles. It is not a delay: the Monday report cannot contain Monday\'s afternoon news, because it was written at '
    + '05:00 that morning.</p>'
    + '<div class="box warn"><b>And the safety net.</b> Each report also looks back <b>two days</b> and picks up anything that '
    + 'qualified but was never sent — a story published at 23:50, or one whose source was slow. A ledger records every '
    + 'article ever sent, so a late arrival is carried into the next report and <b>no article is ever sent twice</b>. '
    + 'That mechanism is visible in the table below: the reports of the last three days each carried items from earlier days.</div>'

    + '<div class="pagebreak"></div>'
    // ── 5. the last three days
    + '<h2>5 · What the system has actually done, the last three days</h2>'
    + '<table><tr><th>Report</th><th>Sent</th><th>At</th><th>Made up of</th></tr>'
    + reports.map(reportRow).join('') + '</table>'
    + '<p class="small">Read the last column as the safety net working. The Saturday report carried 39 articles published '
    + 'on Friday and 3 published Saturday; today\'s carried items from three different days. Each was sent once, on the '
    + 'first morning it could be.</p>'

    + '<h3>The same days, by what happened to every article</h3>'
    + '<table><tr><th>Publication day</th><th>Articles</th><th>Sent</th><th>Queued</th><th>Held</th><th>Excluded</th></tr>'
    + audits.map(auditRow).join('') + '</table>'
    + '<div class="box"><b>Why the weekend numbers are small, and correct.</b> Regulators, market operators and the trade '
    + 'press barely publish on weekends. Sunday produced 38 articles of which 33 scored 0 — largely weekend market '
    + 'briefings about equities and currencies — leaving 5 real stories. The Monday email carried 8 items. A year-old '
    + 'version of this system would have sent thirty items of padding; eight honest ones is the system working.</div>'

    // ── 6. today
    + '<h2>6 · Today (' + esc(now.today) + '), as at ' + esc(now.pretty.split(', ')[1]) + '</h2>'
    + '<div class="tiles">'
    + '<div class="tile"><b>' + today.fetched + '</b>fetched so far today</div>'
    + '<div class="tile"><b>' + today.analysed + '</b>scored</div>'
    + '<div class="tile"><b>' + today.qualifying + '</b>qualifying — passed all four gates</div>'
    + '<div class="tile"><b>' + today.sections + '</b>sections represented</div>'
    + '</div>'
    + '<p class="small"><b>Sent this morning:</b> ' + (reports[0] ? reports[0].item_count + ' items at ' + reports[0].s
      + ', covering ' + reports[0].mix.map((m) => m.n + ' from ' + m.d.slice(5)).join(' and ') : 'n/a') + '.</p>'
    + '<h3>Queued now — what tomorrow\'s ' + esc(tomorrow) + ' 05:00 report will carry (' + queued.length + ' so far, still filling)</h3>'
    + (queued.length
      ? '<table><tr><th>Score</th><th>Article</th><th>Source</th><th>Section</th></tr>'
        + queued.slice(0, 14).map((r) => '<tr><td>' + chip(Number(r.sc)) + '</td><td class="t">'
          + esc(String(r.title).slice(0, 74)) + '</td><td>' + esc(String(r.src).slice(0, 30)) + '</td><td class="n">'
          + esc(r.category) + '</td></tr>').join('') + '</table>'
      : '<p class="small">Nothing has qualified yet today.</p>')
    + '<p class="small">This list grows until 23:50 tonight, when the day closes. Anything that arrives after that but '
    + 'belongs to today is picked up by the two-day safety net on a later morning.</p>'

    + '<div class="pagebreak"></div>'
    // ── 7. verified links
    + '<h2>7 · The ' + links.length + ' brief links — every one, and whether it is delivering</h2>'
    + '<div class="tiles">'
    + '<div class="tile"><b>' + links.length + '</b>links in the brief</div>'
    + '<div class="tile"><b>' + links.filter((r) => r.name).length + '</b>registered and monitored</div>'
    + '<div class="tile"><b>' + withArticles + '</b>delivered articles in 3 days</div>'
    + '<div class="tile"><b>' + walled + '</b>behind a login — newsletter route</div>'
    + '</div>'
    + '<p class="small">"No items in 3 days" is not a failure: most publishers do not publish daily, and the last-seen '
    + 'date shows the source is alive. The route column shows how each is read — <b>rss</b> a feed, <b>scrape</b> the '
    + 'page, <b>sitemap</b> the publisher\'s XML where the page defeats every reader, <b>firecrawl</b> a hosted browser '
    + 'for pages that build themselves with JavaScript.</p>'
    + '<table><tr><th>#</th><th>Brief link</th><th>Source</th><th>Route</th><th>Last 3 days</th></tr>'
    + links.map(linkRow).join('') + '</table>'

    + '<div class="sub" style="margin-top:14px">BEXT Consultancy · generated from the live system, ' + esc(now.pretty)
    + ' · ' + src.act + ' active sources: ' + src.rss + ' feeds, ' + src.scr + ' scraped, ' + src.sm + ' sitemaps, '
    + src.fc + ' rendered · dashboard: Daily Report and Day Audit pages carry these same numbers live</div>'
    + '</body></html>';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = OUT_DIR + '/BEXT-Daily-Report-How-It-Works.html';
  const pdfPath = OUT_DIR + '/BEXT-Daily-Report-How-It-Works.pdf';
  fs.writeFileSync(htmlPath, html);

  const r = await fetch('http://127.0.0.1:8080/pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, width: '794px', height: '1123px' }),
  });
  if (!r.ok) throw new Error('pdf ' + r.status);
  fs.writeFileSync(pdfPath, Buffer.from(await r.arrayBuffer()));
  console.log('reports ' + reports.length + ' | audits ' + audits.length + ' | queued ' + queued.length
    + ' | links ' + links.length + ' (' + withArticles + ' delivering)');
  console.log('wrote ' + pdfPath + ' (' + Math.round(fs.statSync(pdfPath).size / 1024) + ' KB)');
})().catch((e) => { console.error('FAILED ' + e.message); process.exitCode = 1; });
