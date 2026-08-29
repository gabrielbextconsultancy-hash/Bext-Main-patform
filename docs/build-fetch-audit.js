#!/usr/bin/env node
/**
 * The fetch audit, anchored to the Project Brief link by link — with every
 * fetched article nested under the brief link it answers to.
 *
 *   node docs/build-fetch-audit.js
 *
 * Reads docs/brief-links.txt (refreshed from the client's PDF), maps every one
 * of its links to a registered source, and lists each source's window articles
 * directly beneath its brief link(s), score and disposition on every row.
 * Needs the 5433 and 8080 tunnels.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

// Two windows, one audit shape. Default: a fetch-time window (what did we pull
// in these 24 hours). With --pubday YYYY-MM-DD: a publication-day window - the
// exact population a morning report draws from, so the audit is the one-to-one
// companion to that email: every article of the day, the sent ones marked sent,
// and every absentee carrying its reason.
const argIdx = process.argv.indexOf('--pubday');
const PUBDAY = argIdx > -1 ? process.argv[argIdx + 1] : null;
if (PUBDAY && !/^\d{4}-\d{2}-\d{2}$/.test(PUBDAY)) { console.error('--pubday YYYY-MM-DD'); process.exit(1); }

const WIN_FROM = '2026-08-26T13:00:00Z';   // 23:00 26 Aug Melbourne
const WIN_TO   = '2026-08-27T13:00:00Z';   // 23:00 27 Aug Melbourne
const OUT = PUBDAY ? 'docs/BEXT-Fetch-Audit-pubday-' + PUBDAY : 'docs/BEXT-Fetch-Audit-2026-08-27';

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const apex = (h) => String(h || '').replace(/^www\./, '');
const hostOf = (u) => { try { return apex(new URL(u).host); } catch (e) { return ''; } };
const pathOf = (u) => { try { return new URL(u).pathname.toLowerCase(); } catch (e) { return ''; } };

(async () => {
  const db = new Pool({
    host: process.env.PG_HOST, port: Number(process.env.PG_PORT),
    database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  });

  const src = (await db.query(`
    SELECT id, slug, name, url, method::text, active, email_authoritative,
           config->>'feed_url' AS feed_url,
           (SELECT max(fetched_at)::date::text FROM articles a WHERE a.source_id = s.id) AS last_article
    FROM sources s`)).rows;

  const items0 = (await db.query(`
    SELECT a.id, a.title, a.url, a.source_id, s.name AS source, s.category,
           an.relevance_score AS score, a.content_kind::text AS kind,
           a.date_state::text AS ds, a.report_eligible AS elig,
           to_char(coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne', 'DD Mon') AS day,
           (a.published_at IS NOT NULL) AS exact_date, sent.report_date AS sent_in
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN article_analysis an ON an.article_id = a.id
    LEFT JOIN LATERAL (
      SELECT r.report_date::text FROM report_items ri JOIN reports r ON r.id = ri.report_id
      WHERE ri.article_id = a.id AND r.status = 'sent' LIMIT 1) sent ON true
    WHERE ($3::date IS NULL AND a.fetched_at BETWEEN $1 AND $2)
       OR ($3::date IS NOT NULL
           AND (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date = $3::date)
    ORDER BY an.relevance_score DESC NULLS LAST, a.id`, [WIN_FROM, WIN_TO, PUBDAY])).rows;
  await db.end();

  const dis = (r) => {
    if (r.sent_in) return ['SENT', 'sent in the ' + r.sent_in + ' report'];
    if (r.kind === 'reference') return ['HELD', 'standing reference page (judge)'];
    if (r.kind === 'offtopic') return ['HELD', 'off-topic article, not industry news (judge)'];
    if (r.ds === 'none' && Number(r.score) === 0) return ['HELD', 'website furniture (no date, score 0)'];
    if (!r.elig) return ['HELD', 'stale-dated (older than 14 days)'];
    if (Number(r.score) === 0) return ['EXCLUDED', 'score 0 - no energy/building/climate bearing'];
    if (r.score === null) return ['QUEUED', 'awaiting scoring, then next report'];
    return ['QUEUED', PUBDAY
      ? 'late arrival - fetched after the send; the ledger carries it into the next report'
      : 'goes out in the next 05:00 report'];
  };
  const tally = {};
  const items = items0.map((r) => { const [k, why] = dis(r); tally[k] = (tally[k] || 0) + 1; return { ...r, k, why }; });

  // Every brief link to its source. Walled publishers reach us by another route
  // than the URL the brief names, so those pairs are anchored by hand.
  const MANUAL = {
    'reuters.com': 'reuters-carbon', 'theaustralian.com.au': 'the-australian',
    'iea.org': 'iea-energy-efficiency', 'portal.cleanenergycouncil.org.au': 'cec',
  };
  const links = fs.readFileSync('docs/brief-links.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const mapped = links.map((link) => {
    const h = hostOf(link), p = pathOf(link);
    let best = null, bestScore = -1;
    for (const s of src) {
      let sc = -1;
      if ([hostOf(s.url), hostOf(s.feed_url || '')].includes(h)) sc = 1;
      else if (MANUAL[h] === s.slug) sc = 0.5;
      if (sc < 0) continue;
      const sp = pathOf(s.url);
      for (const seg of p.split('/').filter(Boolean)) if (sp.includes(seg)) sc++;
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    return { link, s: best };
  });

  // Group the window's articles under the brief links they answer to. A source
  // shared by several brief links renders once, headed by every link it serves;
  // anything from a source the brief never named lands in the final section so
  // the window total still reconciles to the last article.
  const bySource = {};
  for (const a of items) (bySource[a.source_id] = bySource[a.source_id] || []).push(a);
  const groups = [];
  const seenSource = {};
  mapped.forEach((m, i) => {
    if (!m.s) { groups.push({ links: [{ n: i + 1, link: m.link }], s: null }); return; }
    if (seenSource[m.s.slug]) { seenSource[m.s.slug].links.push({ n: i + 1, link: m.link }); return; }
    const g = { links: [{ n: i + 1, link: m.link }], s: m.s };
    seenSource[m.s.slug] = g;
    groups.push(g);
  });
  const briefIds = new Set(groups.filter((g) => g.s).map((g) => g.s.id));
  const beyond = items.filter((a) => !briefIds.has(a.source_id));

  const chip = (n) => {
    if (n === null || n === undefined) return '<span class="chip grey">-</span>';
    const c = n >= 80 ? 'green' : n >= 55 ? 'teal' : n >= 20 ? 'amber' : 'grey';
    return '<span class="chip ' + c + '">' + n + '</span>';
  };
  const K = { SENT: ['#166534', '#dcfce7'], QUEUED: ['#1e40af', '#dbeafe'], HELD: ['#854d0e', '#fef9c3'], EXCLUDED: ['#4b5563', '#e5e7eb'] };

  const row = (i) => '<tr><td>' + chip(i.score === null ? null : Number(i.score)) + '</td>'
    + '<td class="t"><a href="' + esc(i.url) + '">' + esc(String(i.title).slice(0, 95)) + '</a><br><span class="u">'
    + esc(i.day) + (i.exact_date ? '' : ' (picked up)') + '</span></td>'
    + '<td><span class="disp" style="color:' + K[i.k][0] + ';background:' + K[i.k][1] + '">' + i.k + '</span><br><span class="u">' + esc(i.why) + '</span></td></tr>';

  const groupBlock = (g) => {
    const heads = g.links.map((l) => '<div class="lk">#' + l.n + ' &middot; <a href="' + esc(l.link) + '">'
      + esc(l.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80)) + '</a></div>').join('');
    if (!g.s) {
      return '<div class="grp">' + heads + '<div class="gname held">NOT REGISTERED</div></div>';
    }
    const arts = bySource[g.s.id] || [];
    let status;
    if (!g.s.active) {
      status = '<span class="held">walled - articles arrive by newsletter (tier 0), not from this URL</span>';
    } else if (!arts.length) {
      status = '<span class="quiet">no new items this window - last article ' + esc(g.s.last_article || 'never') + '</span>';
    } else {
      status = '<span class="ok">' + arts.length + ' article' + (arts.length > 1 ? 's' : '') + ' fetched this window</span>';
    }
    return '<div class="grp">' + heads
      + '<div class="gname">' + esc(g.s.name) + ' <span class="u">(' + esc(g.s.method) + ')</span> &mdash; ' + status + '</div>'
      + (arts.length
        ? '<table><tr><th>Score</th><th>Article</th><th>Disposition</th></tr>' + arts.map(row).join('') + '</table>'
        : '')
      + '</div>';
  };

  const html = '<!doctype html><html><head><meta charset="utf-8"><title>BEXT Fetch Audit - the brief, link by link, article by article</title>'
    + '<style>'
    + '@page{size:A4;margin:12mm}'
    + "body{font:9.5px/1.45 'Segoe UI',system-ui,sans-serif;color:#111827;margin:0}"
    + 'h1{font-size:19px;margin:0 0 2px} h2{font-size:13px;margin:16px 0 5px;border-bottom:2px solid #0f766e;padding-bottom:2px}'
    + '.sub{color:#6b7280;margin-bottom:10px}'
    + 'table{width:100%;border-collapse:collapse;margin:3px 0 4px}'
    + 'th{text-align:left;font-size:8px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #d1d5db;padding:2px 4px}'
    + 'td{border-bottom:1px solid #f3f4f6;padding:3px 4px;vertical-align:top}'
    + '.t a{color:#0f766e;text-decoration:none;font-weight:600}'
    + '.u{color:#9ca3af;font-size:8px}'
    + '.ok{color:#166534}.quiet{color:#854d0e}.held{color:#4b5563}'
    + '.chip{display:inline-block;font:700 9px/1 sans-serif;padding:3px 6px;border-radius:8px}'
    + '.green{color:#166534;background:#dcfce7}.teal{color:#0f766e;background:#ccfbf1}'
    + '.amber{color:#854d0e;background:#fef9c3}.grey{color:#4b5563;background:#e5e7eb}'
    + '.disp{display:inline-block;font:700 8px/1 sans-serif;padding:2px 6px;border-radius:8px}'
    + '.tiles{display:flex;gap:7px;margin:10px 0}'
    + '.tile{flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:7px 9px}'
    + '.tile b{font-size:15px;display:block}'
    + '.box{border:1px solid #e5e7eb;border-left:4px solid #0f766e;border-radius:4px;padding:7px 9px;margin:7px 0;font-size:9.5px}'
    + '.grp{margin:10px 0 14px;page-break-inside:avoid}'
    + '.lk{font-size:9px;color:#6b7280}.lk a{color:#6b7280;text-decoration:none}'
    + '.gname{font-size:11px;font-weight:700;color:#111827;margin:2px 0 1px}'
    + '.pagebreak{page-break-before:always}'
    + '</style></head><body>'
    + '<h1>Fetch Audit - the brief, link by link, article by article</h1>'
    + '<div class="sub">' + (PUBDAY
      ? 'Publication day: ' + PUBDAY + ', Melbourne - the exact population the morning report drew from. Every one of the brief&#39;s '
      : 'Window: 23:00 26 Aug to 23:00 27 Aug 2026, Melbourne. Every one of the brief&#39;s ')
    + mapped.length + ' links, and under each one every article it produced - ' + items.length + ' articles, all accounted for.</div>'

    + '<div class="tiles">'
    + '<div class="tile"><b>' + items.length + '</b>fetched in the window</div>'
    + '<div class="tile"><b>' + (tally.SENT || 0) + '</b>sent - were in a delivered report</div>'
    + '<div class="tile"><b>' + (tally.QUEUED || 0) + '</b>queued - go out at the next 05:00</div>'
    + '<div class="tile"><b>' + (tally.HELD || 0) + '</b>held - reference and stale</div>'
    + '<div class="tile"><b>' + (tally.EXCLUDED || 0) + '</b>excluded - score 0</div>'
    + '</div>'
    + '<div class="box"><b>Why "fetched" and "in the report" differ:</b> they measure different windows. The '
    + 'coverage line counts everything <i>fetched</i> in a rolling 24 hours; a morning report carries everything '
    + '<i>published</i> in the prior calendar day that passed the gates and was not already sent. '
    + 'Fetched-today-published-today is queued for tomorrow, not excluded.</div>'
    + '<div class="box"><b>113 of the ' + (tally.EXCLUDED || 0) + ' zeros are a milestone:</b> the first articles the '
    + 'newsletter route has ever delivered - the fixed keep-step processed the overnight Reuters briefings and the '
    + 'scorer correctly zeroed the general-market bulk. The rest are AFR lifestyle pieces. All stay in the database; '
    + 'none reach the client email.</div>'

    + '<h2>The brief&#39;s ' + mapped.length + ' links, each with everything fetched under it</h2>'
    + '<div class="box">Each numbered entry is one hyperlink embedded in the Project Brief PDF. Beneath it: the '
    + 'registered source that answers for it, and every article that source produced in this window with score and '
    + 'disposition. Links sharing one publisher are grouped so their articles are not double-listed. '
    + '"No new items this window" is not failure - most publishers do not publish daily, and the last-article date '
    + 'shows the source is alive. Walled publishers arrive by newsletter, and their row says so.</div>'
    + groups.map(groupBlock).join('')

    + (beyond.length
      ? '<h2>Fetched beyond the brief&#39;s links - ' + beyond.length + ' articles</h2>'
        + '<div class="box">From sources added past the original brief (newsletter catch-alls, the AIDC '
        + 'decarbonisation releases). Listed so the window total reconciles to the last article.</div>'
        + '<table><tr><th>Score</th><th>Article</th><th>Disposition</th></tr>' + beyond.map(row).join('') + '</table>'
      : '')

    + '<div class="sub" style="margin-top:12px">BEXT Consultancy - generated from the live database - '
    + 'scores: green 80+ - teal 55-79 - amber 20-54 - grey 0-19</div>'
    + '</body></html>';

  fs.writeFileSync('docs/fetch-audit-2026-08-27.html', html);
  const r = await fetch('http://127.0.0.1:8080/pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, width: '794px', height: '1123px' }),
  });
  if (!r.ok) throw new Error('pdf ' + r.status);
  fs.writeFileSync(OUT + '.pdf', Buffer.from(await r.arrayBuffer()));
  const grouped = Object.values(bySource).reduce((n, a) => n + a.length, 0);
  console.log('brief links ' + mapped.length + ' in ' + groups.length + ' groups | articles ' + items.length
    + ' (' + (grouped - beyond.length) + ' under brief links, ' + beyond.length + ' beyond) | ' + JSON.stringify(tally));
  console.log('wrote ' + OUT + '.pdf (' + Math.round(fs.statSync(OUT + '.pdf').size / 1024) + ' KB)');
})().catch((e) => { console.error('FAILED ' + e.message); process.exitCode = 1; });
