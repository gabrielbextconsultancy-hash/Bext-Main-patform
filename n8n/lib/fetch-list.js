/**
 * The day's full fetch list, as HTML for the PDF that hangs off the Teams card.
 *
 * Inlined into an n8n Code node, so no backticks and no dollar-brace.
 *
 * Two zones, which is the whole design:
 *
 *   Everything scoring 20 or above, in full — source, headline, link, score.
 *   Roughly fifty a day. This is where a scorer mistake would actually matter,
 *   so it is all visible and checkable.
 *
 *   Below 20, a per-source tally only. Fifty-eight per cent of what we fetch
 *   scores under twenty, and that band is where the tobacco bill lived — the
 *   material the client complained about. Printing sixty-five rows of it daily
 *   would recreate that complaint in a new place, while hiding it entirely would
 *   lose the proof that a source was fetched at all. A count does both jobs.
 */

var FULL_DETAIL_FLOOR = 20;

var esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

var trim = function (s, n) {
  var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
};

var band = function (score) {
  if (score >= 70) return '#0f766e';
  if (score >= 40) return '#1e40af';
  return '#6b7280';
};

/**
 * rows: { source_name, category, title, url, relevance_score, summary, in_report }
 * meta: { coverage, floor, fetched, sources_monitored }
 */
var buildFetchList = function (rows, meta) {
  var m = meta || {};
  var all = rows || [];
  var detail = all.filter(function (r) { return (r.relevance_score || 0) >= FULL_DETAIL_FLOOR; });
  var quiet = all.filter(function (r) { return (r.relevance_score || 0) < FULL_DETAIL_FLOOR; });

  detail.sort(function (a, b) {
    return (b.relevance_score || 0) - (a.relevance_score || 0)
      || String(a.source_name).localeCompare(String(b.source_name));
  });

  var rowsHtml = detail.map(function (r) {
    var mark = r.in_report
      ? '<span style="background:#0f766e;color:#fff;font:600 9px Arial;padding:2px 5px;border-radius:3px">SENT</span>'
      : '';
    return '<tr style="border-bottom:1px solid #eef0f3">'
      + '<td style="padding:7px 8px 7px 0;vertical-align:top;width:34px">'
      + '<span style="font:700 12px Arial;color:' + band(r.relevance_score) + '">'
      + (r.relevance_score == null ? '–' : r.relevance_score) + '</span></td>'
      + '<td style="padding:7px 8px 7px 0;vertical-align:top">'
      + '<a href="' + esc(r.url) + '" style="font:600 11.5px Arial;color:#0f766e;text-decoration:none">'
      + esc(trim(r.title, 118)) + '</a> ' + mark
      + '<div style="font:10px Arial;color:#9aa3af;margin-top:2px">' + esc(r.source_name)
      + (r.category ? ' · ' + esc(r.category) : '') + '</div>'
      + (r.summary ? '<div style="font:10.5px/1.45 Arial;color:#4b5563;margin-top:3px">'
          + esc(trim(r.summary, 210)) + '</div>' : '')
      + '</td></tr>';
  }).join('');

  // Below the detail floor: how many, from where. Sorted by volume so an unusual
  // day stands out.
  var tally = {};
  for (var i = 0; i < quiet.length; i++) {
    var k = quiet[i].source_name || 'unknown';
    tally[k] = (tally[k] || 0) + 1;
  }
  var tallyRows = Object.keys(tally)
    .sort(function (a, b) { return tally[b] - tally[a] || a.localeCompare(b); })
    .map(function (k) {
      return '<tr><td style="padding:3px 12px 3px 0;font:10.5px Arial;color:#4b5563">' + esc(k) + '</td>'
        + '<td style="padding:3px 0;font:10.5px Arial;color:#9aa3af">' + tally[k] + '</td></tr>';
    }).join('');

  return '<!doctype html><html><head><meta charset="utf-8"></head>'
    + '<body style="margin:0;padding:26px 30px;font-family:Arial,sans-serif;color:#111827">'
    + '<div style="font:10px Arial;letter-spacing:.14em;text-transform:uppercase;color:#9aa3af">'
    + 'BEXT Consultancy · Industry Daily</div>'
    + '<h1 style="font:600 17px Arial;margin:4px 0 2px">Everything fetched — ' + esc(m.coverage || '') + '</h1>'
    + '<div style="font:10.5px Arial;color:#9aa3af;margin-bottom:16px">'
    + all.length + ' articles retrieved'
    + (m.sources_monitored ? ' across ' + m.sources_monitored + ' monitored sources' : '')
    + ' · items scoring ' + (m.floor || 40) + '+ went to the client, marked SENT</div>'

    + '<h2 style="font:600 12px Arial;margin:18px 0 6px;padding-bottom:4px;'
    + 'border-bottom:2px solid #14b8a6">Scored ' + FULL_DETAIL_FLOOR + ' and above'
    + ' <span style="font:400 10px Arial;color:#9aa3af">(' + detail.length + ')</span></h2>'
    + '<table style="width:100%;border-collapse:collapse">' + rowsHtml + '</table>'

    + (quiet.length
      ? '<h2 style="font:600 12px Arial;margin:22px 0 6px;padding-bottom:4px;'
        + 'border-bottom:2px solid #d1d5db">Below ' + FULL_DETAIL_FLOOR
        + ' <span style="font:400 10px Arial;color:#9aa3af">(' + quiet.length
        + ' — counted, not listed)</span></h2>'
        + '<div style="font:10px Arial;color:#9aa3af;margin-bottom:6px">'
        + 'Retrieved and scored as not relevant. Shown as counts so coverage is provable '
        + 'without filling the document with material the scorer already rejected.</div>'
        + '<table style="border-collapse:collapse">' + tallyRows + '</table>'
      : '')

    + '<div style="margin-top:24px;padding-top:10px;border-top:1px solid #e5e7eb;'
    + 'font:9.5px Arial;color:#9aa3af">Generated by the BEXT automation platform. '
    + 'Scores are the relevance model\'s, not a human judgement.</div>'
    + '</body></html>';
};

module.exports = { buildFetchList: buildFetchList, FULL_DETAIL_FLOOR: FULL_DETAIL_FLOOR };
