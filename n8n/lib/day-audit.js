/**
 * The day audit: every article of one publication day, nested under the brief
 * link it answers to, with score and disposition — built as a string, no I/O,
 * so the News Quality node and the CLI share one implementation and cannot
 * drift. Backtick-free and template-free on purpose: this file is inlined into
 * a Code node, where cooked escapes have already broken two features.
 *
 * buildDayAudit(day, sources, articles, briefLinks) -> { html, tally }
 *   sources:  [{id, slug, name, url, feed_url, method, active, last_article}]
 *   articles: [{id, title, url, source_id, score, kind, ds, elig, day, exact_date, sent_in}]
 */
'use strict';

function auditEsc(s) {
  return String(s == null ? '' : s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}
function auditHost(u) {
  try {
    var h = new URL(u).host;
    return h.indexOf('www.') === 0 ? h.slice(4) : h;
  } catch (e) { return ''; }
}
function auditPath(u) {
  try { return new URL(u).pathname.toLowerCase(); } catch (e) { return ''; }
}

function buildDayAudit(day, sources, articles, briefLinks) {
  // Disposition, in gate order — the same order the report applies them.
  var tally = { fetched: articles.length, sent: 0, queued: 0, held: 0, excluded: 0 };
  var items = articles.map(function (r) {
    var k, why;
    if (r.sent_in) { k = 'SENT'; why = 'sent in the ' + r.sent_in + ' report'; }
    else if (r.kind === 'reference') { k = 'HELD'; why = 'standing reference page (judge)'; }
    else if (r.ds === 'none' && Number(r.score) === 0) { k = 'HELD'; why = 'website furniture (no date, score 0)'; }
    else if (r.elig === false) { k = 'HELD'; why = 'stale-dated (older than 14 days)'; }
    else if (Number(r.score) === 0) { k = 'EXCLUDED'; why = 'score 0 - no energy/building/climate bearing'; }
    else if (r.score === null || r.score === undefined) { k = 'QUEUED'; why = 'awaiting scoring, then the next report'; }
    else { k = 'QUEUED'; why = 'goes out in the next 05:00 report'; }
    tally[k.toLowerCase()]++;
    var o = {}; for (var key in r) o[key] = r[key];
    o.k = k; o.why = why;
    return o;
  });

  // Walled publishers reach us by another route than the URL the brief names.
  var MANUAL = {
    'reuters.com': 'reuters-carbon', 'theaustralian.com.au': 'the-australian',
    'iea.org': 'iea-energy-efficiency', 'portal.cleanenergycouncil.org.au': 'cec',
  };
  var mapped = briefLinks.map(function (link) {
    var h = auditHost(link), p = auditPath(link);
    var best = null, bestScore = -1;
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i], sc = -1;
      if (auditHost(s.url) === h || auditHost(s.feed_url || '') === h) sc = 1;
      else if (MANUAL[h] === s.slug) sc = 0.5;
      if (sc < 0) continue;
      var sp = auditPath(s.url);
      var segs = p.split('/');
      for (var j = 0; j < segs.length; j++) if (segs[j] && sp.indexOf(segs[j]) > -1) sc++;
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    return { link: link, s: best };
  });

  var bySource = {};
  items.forEach(function (a) { (bySource[a.source_id] = bySource[a.source_id] || []).push(a); });
  var groups = [], seen = {};
  mapped.forEach(function (m, i) {
    if (!m.s) { groups.push({ links: [{ n: i + 1, link: m.link }], s: null }); return; }
    if (seen[m.s.slug]) { seen[m.s.slug].links.push({ n: i + 1, link: m.link }); return; }
    var g = { links: [{ n: i + 1, link: m.link }], s: m.s };
    seen[m.s.slug] = g; groups.push(g);
  });
  var briefIds = {};
  groups.forEach(function (g) { if (g.s) briefIds[g.s.id] = true; });
  var beyond = items.filter(function (a) { return !briefIds[a.source_id]; });

  var chip = function (n) {
    if (n === null || n === undefined) return '<span class="chip grey">-</span>';
    var c = n >= 80 ? 'green' : n >= 55 ? 'teal' : n >= 20 ? 'amber' : 'grey';
    return '<span class="chip ' + c + '">' + n + '</span>';
  };
  var K = { SENT: ['#166534', '#dcfce7'], QUEUED: ['#1e40af', '#dbeafe'], HELD: ['#854d0e', '#fef9c3'], EXCLUDED: ['#4b5563', '#e5e7eb'] };
  var row = function (i) {
    return '<tr><td>' + chip(i.score === null || i.score === undefined ? null : Number(i.score)) + '</td>'
      + '<td class="t"><a href="' + auditEsc(i.url) + '">' + auditEsc(String(i.title).slice(0, 95)) + '</a><br><span class="u">'
      + auditEsc(i.day) + (i.exact_date ? '' : ' (picked up)') + '</span></td>'
      + '<td><span class="disp" style="color:' + K[i.k][0] + ';background:' + K[i.k][1] + '">' + i.k + '</span><br><span class="u">' + auditEsc(i.why) + '</span></td></tr>';
  };
  var groupBlock = function (g) {
    var heads = g.links.map(function (l) {
      var short = l.link.replace('https://', '').replace('http://', '');
      if (short.indexOf('www.') === 0) short = short.slice(4);
      return '<div class="lk">#' + l.n + ' &middot; <a href="' + auditEsc(l.link) + '">' + auditEsc(short.slice(0, 80)) + '</a></div>';
    }).join('');
    if (!g.s) return '<div class="grp">' + heads + '<div class="gname held">NOT REGISTERED</div></div>';
    var arts = bySource[g.s.id] || [];
    var status;
    if (!g.s.active) status = '<span class="held">walled - articles arrive by newsletter (tier 0), not from this URL</span>';
    else if (!arts.length) status = '<span class="quiet">no items this day - last article ' + auditEsc(g.s.last_article || 'never') + '</span>';
    else status = '<span class="ok">' + arts.length + ' article' + (arts.length > 1 ? 's' : '') + ' this day</span>';
    return '<div class="grp">' + heads
      + '<div class="gname">' + auditEsc(g.s.name) + ' <span class="u">(' + auditEsc(g.s.method) + ')</span> &mdash; ' + status + '</div>'
      + (arts.length ? '<table><tr><th>Score</th><th>Article</th><th>Disposition</th></tr>' + arts.map(row).join('') + '</table>' : '')
      + '</div>';
  };

  var html = '<div class="audit">'
    + '<div class="tiles">'
    + '<div class="tile"><b>' + tally.fetched + '</b>articles this day</div>'
    + '<div class="tile"><b>' + tally.sent + '</b>sent</div>'
    + '<div class="tile"><b>' + tally.queued + '</b>queued for the next report</div>'
    + '<div class="tile"><b>' + tally.held + '</b>held</div>'
    + '<div class="tile"><b>' + tally.excluded + '</b>excluded (score 0)</div>'
    + '</div>'
    + '<h3>The brief, link by link - everything the day produced under each</h3>'
    + groups.map(groupBlock).join('')
    + (beyond.length
      ? '<h3>Beyond the brief - ' + beyond.length + ' articles</h3>'
        + '<table><tr><th>Score</th><th>Article</th><th>Disposition</th></tr>' + beyond.map(row).join('') + '</table>'
      : '')
    + '</div>';

  return { html: html, tally: tally };
}

module.exports = { buildDayAudit };
