/**
 * News, or the website's standing furniture?
 *
 * A listing page links a site's scaffolding alongside its stories, and the
 * scraper takes both. Regulators gave us "Renewable Energy Zones", "Gas Retail
 * Markets" and "Equipment Energy Efficiency (E3) Program"; AEMO gave us a
 * podcast landing page, an XML standards page and a scholarship. Every one is on
 * topic and scores well, and none is news of any particular day.
 *
 * A missing publication date is the tell but not the proof — the Clean Energy
 * Council and NABERS publish real articles with no date in their markup — so the
 * call is editorial, and made by the model. On hermes3:8b it answered ten of ten
 * correctly on live titles, including the four that fooled every rule tried
 * before it.
 *
 * Conservative by construction. Anything the model does not clearly mark as
 * reference stays 'unknown' and keeps going out, because dropping a real story
 * is the failure being fixed, and carrying a reference page for one more day is
 * merely untidy.
 */
'use strict';

const PROMPT_HEAD =
  'You are sorting pages from Australian energy and building industry websites.\n\n'
  + 'For each item answer with one of three kinds:\n'
  + '  NEWS      - a story published on a particular date: an announcement, a decision,\n'
  + '              a consultation opening, a report release, a media release.\n'
  + '  REFERENCE - a standing page that is always there: a program or scheme overview,\n'
  + '              a portal, a market or mechanism explainer, a team or contact page,\n'
  + '              a legal or policy notice, a standards page.\n'
  + '  OFFTOPIC  - a real article, but not industry news: lifestyle, food, travel,\n'
  + '              fashion, sport, entertainment, personality profiles. A business\n'
  + '              paper prints these beside its energy coverage; they are articles,\n'
  + '              not reference pages, and not news for this industry.\n\n'
  + 'When a title reads like a subject rather than an event, it is reference.\n'
  + 'When in doubt between news and the others, answer news.\n\n'
  + 'Return ONLY a JSON array, one object per item, in the same order, like:\n'
  + '[{"id":1,"kind":"news"},{"id":2,"kind":"reference"},{"id":3,"kind":"offtopic"}]\n\n'
  + 'ITEMS:\n';

/**
 * items: [{ id, title, source }]
 * http:  a request function — this.helpers.httpRequest in n8n, or an equivalent
 * Returns a Map of id -> 'news' | 'reference'.
 */
async function classifyKind(items, opts) {
  const options = opts || {};
  const http = options.http;
  const url = options.ollamaUrl || 'http://ollama:11434/api/generate';
  const model = options.model || 'hermes3:8b';
  const out = new Map();
  if (!items || !items.length || !http) return out;

  // Five at a time. Ten was tried first and every batch came back unusable —
  // an 8B model asked for a longer list drifts out of the format, and one
  // malformed array costs all ten verdicts. Five answers cleanly and the extra
  // round trips are cheap against a workflow that runs three times a day.
  const BATCH = Number(options.batch || 5);

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const lines = batch.map(function (a, n) {
      const src = a.source ? ' [' + a.source + ']' : '';
      return (n + 1) + '. ' + String(a.title || '').slice(0, 140) + src;
    }).join('\n');

    let text = '';
    try {
      const r = await http({
        method: 'POST', url: url, json: true, timeout: 180000,
        body: {
          model: model, stream: false,
          // Generous. The model pretty-prints its JSON — about forty tokens an
          // item once braces and whitespace are counted — and a budget that
          // truncates the array costs the whole batch, because a JSON fragment
          // with no closing bracket cannot be parsed at all. Twenty items were
          // silently discarded that way before this was raised.
          options: { temperature: 0.1, num_predict: 150 + batch.length * 45 },
          prompt: PROMPT_HEAD + lines + '\n',
        },
      });
      text = (r && r.response) || '';
    } catch (e) {
      continue;
    }

    const m = text.match(/\[[\s\S]*\]/);
    if (!m) continue;
    let parsed;
    try { parsed = JSON.parse(m[0]); } catch (e) { continue; }
    if (!Array.isArray(parsed)) continue;

    // The model reliably drops the id on some entries — it returned
    // {"kind":"reference"} with no id for six of ten in testing — so order is
    // the primary key and the id, when present, is only a cross-check. A
    // mismatched length means the answer cannot be aligned and is discarded
    // rather than guessed at, which would mislabel real stories.
    if (parsed.length !== batch.length) continue;
    for (let k = 0; k < batch.length; k++) {
      const p = parsed[k] || {};
      if (p.id !== undefined && Number(p.id) !== k + 1) continue;
      // The model writes 'off-topic' about as often as 'offtopic'; both mean
      // the enum's spelling.
      const kind = String(p.kind || '').toLowerCase().replace('-', '');
      if (kind === 'reference' || kind === 'news' || kind === 'offtopic') out.set(batch[k].id, kind);
    }
  }
  return out;
}

module.exports = { classifyKind };
