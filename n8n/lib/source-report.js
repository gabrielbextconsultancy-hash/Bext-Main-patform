'use strict';
/**
 * The daily source-verification report, as printable HTML.
 *
 * One implementation used by the 05:00 workflow and any CLI, so the stored
 * artefact and an ad-hoc rebuild cannot disagree. Backtick-free and
 * template-free on purpose: this file is inlined into a Code node.
 *
 * Input shape (all read in one SQL round trip by the workflow):
 *   day       'YYYY-MM-DD'  — the publication day the 05:00 send covered
 *   sources   [{brief_n, name, url, route, method, active, recent, last_article, note}]
 *   articles  [{brief_n, source_name, title, url, score, body_chars, category}]
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function link(url, text) {
  return '<a href="' + esc(url) + '" style="color:#0f766e;text-decoration:none">'
    + esc(text || url) + '</a>';
}

function buildSourceReport(day, sources, articles) {
  var producing = [];
  var quiet = [];
  var inactive = [];
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i];
    if (!s.active) inactive.push(s);
    else if (Number(s.recent) > 0) producing.push(s);
    else quiet.push(s);
  }

  var withBody = 0;
  for (var j = 0; j < articles.length; j++) {
    if (Number(articles[j].body_chars) > 200) withBody++;
  }

  var tally = {
    day: day,
    sources_producing: producing.length,
    sources_quiet: quiet.length,
    sources_inactive: inactive.length,
    articles_sent: articles.length,
    written_from_article: withBody,
  };

  var h = [];
  h.push('<!doctype html><html><head><meta charset="utf-8">');
  h.push('<style>');
  h.push('body{font:13px/1.55 Arial,sans-serif;color:#111827;margin:32px}');
  h.push('h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:26px 0 8px;border-bottom:2px solid #0f766e;padding-bottom:4px}');
  h.push('table{border-collapse:collapse;width:100%;font-size:12px}');
  h.push('th{text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding:5px 8px;border-bottom:1px solid #d1d5db}');
  h.push('td{padding:5px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top}');
  h.push('.muted{color:#6b7280}.ok{color:#047857}.warn{color:#b45309}.chip{display:inline-block;background:#f3f4f6;border-radius:8px;padding:0 6px;font-size:10px;text-transform:uppercase}');
  h.push('.box{background:#f0fdfa;border-left:4px solid #0f766e;padding:10px 14px;margin:14px 0}');
  h.push('</style></head><body>');

  h.push('<div class="muted" style="letter-spacing:.14em;font-size:10px">BEXT CONSULTANCY &middot; SOURCE VERIFICATION</div>');
  h.push('<h1>Daily source report &mdash; ' + esc(day) + '</h1>');
  h.push('<div class="muted">Generated beside the 05:00 send it describes. Every article below was emailed; every source below is a link from the Industry Daily brief.</div>');

  h.push('<div class="box"><b>' + tally.articles_sent + '</b> articles sent &middot; <b>'
    + tally.written_from_article + '</b> written from the full article text &middot; <b>'
    + tally.sources_producing + '</b> sources producing &middot; <b class="warn">'
    + tally.sources_quiet + '</b> quiet 3 days &middot; <b class="muted">'
    + tally.sources_inactive + '</b> inactive</div>');

  // ── what was sent, grouped by the brief link it answers to ────────────────
  h.push('<h2>Articles sent, by brief link</h2>');
  h.push('<table><tr><th>#</th><th>Link</th><th>Article sent</th><th>Score</th><th>Written from</th></tr>');
  var byKey = {};
  var order = [];
  for (var k = 0; k < articles.length; k++) {
    var a = articles[k];
    var key = (a.brief_n == null ? 'zz' : String(a.brief_n)) + '|' + a.source_name;
    if (!byKey[key]) { byKey[key] = []; order.push(key); }
    byKey[key].push(a);
  }
  for (var o = 0; o < order.length; o++) {
    var grp = byKey[order[o]];
    for (var g = 0; g < grp.length; g++) {
      var a2 = grp[g];
      h.push('<tr>'
        + '<td>' + (g === 0 && a2.brief_n != null ? '#' + a2.brief_n : '') + '</td>'
        + '<td>' + (g === 0 ? esc(a2.source_name) : '') + '</td>'
        + '<td>' + link(a2.url, a2.title) + '</td>'
        + '<td>' + esc(a2.score == null ? '-' : a2.score) + '</td>'
        + '<td>' + (Number(a2.body_chars) > 200
            ? '<span class="ok">article &middot; ' + a2.body_chars + ' chars</span>'
            : '<span class="warn">teaser only</span>') + '</td>'
        + '</tr>');
    }
  }
  h.push('</table>');

  // ── every source, verified ────────────────────────────────────────────────
  h.push('<h2>Producing sources (' + producing.length + ')</h2>');
  h.push('<table><tr><th>#</th><th>Source</th><th>Read from</th><th>Method</th><th>Articles 3d</th></tr>');
  for (var p = 0; p < producing.length; p++) {
    var sp = producing[p];
    h.push('<tr><td>' + (sp.brief_n != null ? '#' + sp.brief_n : '') + '</td>'
      + '<td>' + esc(sp.name) + '</td>'
      + '<td>' + link(sp.route || sp.url, (sp.route || sp.url || '').replace(/^https?:\/\//, '')) + '</td>'
      + '<td><span class="chip">' + esc(sp.method) + '</span></td>'
      + '<td>' + esc(sp.recent) + '</td></tr>');
  }
  h.push('</table>');

  h.push('<h2>Quiet 3 days (' + quiet.length + ') &mdash; checked and answering, nothing held</h2>');
  h.push('<table><tr><th>#</th><th>Source</th><th>Read from</th><th>Method</th><th>Last article held</th></tr>');
  for (var qq = 0; qq < quiet.length; qq++) {
    var sq = quiet[qq];
    h.push('<tr><td>' + (sq.brief_n != null ? '#' + sq.brief_n : '') + '</td>'
      + '<td>' + esc(sq.name) + '</td>'
      + '<td>' + link(sq.route || sq.url, (sq.route || sq.url || '').replace(/^https?:\/\//, '')) + '</td>'
      + '<td><span class="chip">' + esc(sq.method) + '</span></td>'
      + '<td class="warn">' + esc(sq.last_article || 'none held') + '</td></tr>');
  }
  h.push('</table>');

  h.push('<h2>Inactive (' + inactive.length + ') &mdash; switched off on purpose</h2>');
  h.push('<table><tr><th>#</th><th>Source</th><th>Why</th></tr>');
  for (var n = 0; n < inactive.length; n++) {
    var si = inactive[n];
    h.push('<tr><td>' + (si.brief_n != null ? '#' + si.brief_n : '') + '</td>'
      + '<td>' + esc(si.name) + '</td>'
      + '<td class="muted">' + esc((si.note || 'no note recorded').slice(0, 220)) + '</td></tr>');
  }
  h.push('</table>');

  h.push('<div class="muted" style="margin-top:24px;font-size:11px">Producing / quiet is counted by articles held in the last 3 days, not by fetch status &mdash; a fetch can succeed while a source returns navigation instead of stories. Generated automatically with the 05:00 send.</div>');
  h.push('</body></html>');

  return { html: h.join('\n'), tally: tally };
}

module.exports = { buildSourceReport };
