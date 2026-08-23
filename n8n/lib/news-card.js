/**
 * The Adaptive Card posted to the Teams "Daily report" channel.
 *
 * Inlined into an n8n Code node by build-workflows.js, so no backticks and no
 * dollar-brace anywhere in this file.
 *
 * What it carries, and why in this order: the brief first, because someone
 * glancing at the channel wants the day in a sentence; then the articles that
 * went to the client, each with the same summary they read; then a handful more
 * that scored well but did not make the sheet, so the channel shows a little more
 * than the email rather than duplicating it exactly; then a button to the full
 * list as a PDF.
 *
 * Teams rejects a card over roughly 28KB with a generic failure, so the item
 * count is bounded and summaries are trimmed. Losing the card entirely because it
 * ran three articles too long would be a poor trade.
 */

var CARD_MAX_BYTES = 26000;
var SUMMARY_MAX = 190;
var TITLE_MAX = 120;

var esc = function (s) { return String(s == null ? '' : s); };

var trim = function (s, n) {
  var t = esc(s).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  // Cut on a word so a truncated summary still reads as a sentence.
  var cut = t.slice(0, n);
  var sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…';
};

var shownDate = function (a) {
  var raw = a.shown_at || a.published_at || a.fetched_at;
  if (!raw) return '';
  var d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  var s = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' });
  return a.date_is_exact === false ? s + ' (picked up)' : s;
};

/** One article: headline as a link, source and date beneath, then the summary. */
var itemBlock = function (a, accent) {
  var blocks = [{
    type: 'TextBlock',
    text: '[' + trim(a.title, TITLE_MAX).replace(/[\[\]]/g, '') + '](' + esc(a.url) + ')',
    wrap: true,
    weight: 'Bolder',
    size: 'Default',
    spacing: 'Medium',
    color: accent || 'Accent',
  }, {
    type: 'TextBlock',
    text: esc(a.source_name) + (shownDate(a) ? '  ·  ' + shownDate(a) : '')
          + (a.relevance_score != null ? '  ·  score ' + a.relevance_score : ''),
    wrap: true,
    isSubtle: true,
    size: 'Small',
    spacing: 'None',
  }];
  if (a.summary) {
    blocks.push({
      type: 'TextBlock', text: trim(a.summary, SUMMARY_MAX), wrap: true,
      size: 'Small', spacing: 'Small',
    });
  }
  return blocks;
};

var heading = function (text, sub) {
  var b = [{
    type: 'TextBlock', text: text, weight: 'Bolder', size: 'Medium',
    wrap: true, separator: true, spacing: 'Large',
  }];
  if (sub) b.push({ type: 'TextBlock', text: sub, isSubtle: true, size: 'Small', wrap: true, spacing: 'None' });
  return b;
};

/**
 * opts:
 *   coverage   the day being reported on, already formatted
 *   intro      the brief
 *   sent       articles that went out in the email
 *   extra      articles that scored well but did not make the sheet
 *   counts     { fetched, analysed, sources_contributing, sources_monitored }
 *   pdfUrl     the full list, in the channel's Files tab
 *   reportUrl  the dashboard
 */
var buildNewsCard = function (opts) {
  var o = opts || {};
  var sent = o.sent || [];
  var extra = o.extra || [];
  var counts = o.counts || {};

  var body = [
    { type: 'TextBlock', text: 'BEXT CONSULTANCY · INDUSTRY DAILY', size: 'Small',
      weight: 'Bolder', color: 'Accent', spacing: 'None' },
    { type: 'TextBlock', text: esc(o.coverage), size: 'ExtraLarge', weight: 'Bolder', wrap: true, spacing: 'None' },
    { type: 'TextBlock',
      text: sent.length + ' item' + (sent.length === 1 ? '' : 's') + ' sent to the client'
            + (counts.fetched ? '  ·  ' + counts.fetched + ' fetched' : '')
            + (counts.sources_contributing ? '  ·  ' + counts.sources_contributing
               + ' of ' + (counts.sources_monitored || '?') + ' sources contributed' : ''),
      isSubtle: true, size: 'Small', wrap: true, spacing: 'None' },
  ];

  if (o.intro) {
    body.push({
      type: 'Container', style: 'emphasis', bleed: false, spacing: 'Medium',
      items: [{ type: 'TextBlock', text: trim(o.intro, 700), wrap: true, size: 'Small' }],
    });
  }

  if (sent.length) {
    body = body.concat(heading('In today’s report', 'The same items, in the same order, as the emailed sheet.'));
    for (var i = 0; i < sent.length; i++) body = body.concat(itemBlock(sent[i], 'Accent'));
  }

  if (extra.length) {
    body = body.concat(heading('Also picked up',
      'Scored above the floor but below the cut for the sheet — shown here, not emailed.'));
    for (var j = 0; j < extra.length; j++) body = body.concat(itemBlock(extra[j], 'Good'));
  }

  var actions = [];
  if (o.pdfUrl) actions.push({ type: 'Action.OpenUrl', title: 'View all fetched (PDF)', url: o.pdfUrl });
  if (o.reportUrl) actions.push({ type: 'Action.OpenUrl', title: 'Open the dashboard', url: o.reportUrl });

  var card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    msteams: { width: 'Full' },
    body: body,
    actions: actions,
  };

  // Teams fails a card over its size limit with a generic error, so drop the
  // optional half from the end until it fits rather than lose the post.
  var size = function () { return JSON.stringify(card).length; };
  while (size() > CARD_MAX_BYTES && extra.length) {
    extra.pop();
    card.body = card.body.slice(0, card.body.length - 3);
  }
  while (size() > CARD_MAX_BYTES && card.body.length > 8) {
    card.body = card.body.slice(0, card.body.length - 3);
    card.body.push({ type: 'TextBlock', size: 'Small', isSubtle: true, wrap: true,
      text: 'Trimmed to fit the Teams card limit — the full list is in the PDF.' });
  }

  return card;
};

/** Teams expects the card wrapped in an attachment envelope, not on its own. */
var newsCardEnvelope = function (card) {
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }],
  };
};

module.exports = { buildNewsCard: buildNewsCard, newsCardEnvelope: newsCardEnvelope, CARD_MAX_BYTES: CARD_MAX_BYTES };
