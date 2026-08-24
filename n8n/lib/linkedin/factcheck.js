/**
 * The fact-check record: a source for every material claim.
 *
 * This is the step that makes an AI-drafted post safe to publish under a
 * consultancy's name. A model asked to write about a rebate will produce a figure
 * whether or not one was in the source material, and the invented figure looks
 * exactly as confident as a real one. So every material claim is pulled out of
 * the draft and matched back against the articles the topic was built from.
 * Anything that cannot be matched is marked, not dropped, and shown to the human.
 *
 * Two halves:
 *   extractClaims(draft)      -> the sentences that assert a checkable fact.
 *                                Best done by the model, which has just written
 *                                them; this is the fallback heuristic for when the
 *                                model returns nothing usable.
 *   reconcile(claims, sources) -> match each claim to a source article, by shared
 *                                numbers and named entities. Deterministic, so the
 *                                verdict does not itself depend on a second model
 *                                call that could hallucinate a citation.
 *
 * The model proposes claims; the code disposes of them against real source text.
 * That split is deliberate: extraction is a judgement (what counts as material),
 * matching is a fact (does this number appear in that article).
 *
 * Inlined into an n8n Code node by build-workflows.js, so no backticks and no
 * dollar-brace anywhere in this file.
 */

// A sentence is "material" if it asserts something a reader could act on being
// wrong about: a number, a date, a percentage, a dollar figure, or a claim of
// change ("rose", "cut", "now requires"). Pure opinion and generic framing are
// not fact-checkable and are left alone.
var MATERIAL_SIGNALS = [
  /\d/,
  /\b(per ?cent|percent|%)\b/i,
  /\$\s?\d/,
  /\b(rose|fell|cut|doubled|tripled|halved|increased|decreased|jumped|dropped|now requires|will require|takes effect|comes into force|deadline|from \d{1,2} [A-Z])/i,
  /\b(mandate|mandatory|ban|banned|rebate|subsidy|target|standard|rule)\b/i,
];

/**
 * Fallback claim extraction, sentence by sentence. The workflow prefers the
 * model's own list; this runs only when that list is empty, so a draft is never
 * shipped with an empty fact-check record just because the extraction prompt
 * misfired.
 */
var extractClaims = function (draft) {
  var text = String(draft == null ? '' : draft);
  // Split on sentence enders and hard line breaks, keeping it simple: this is a
  // safety net, not the primary path.
  var sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

  var claims = [];
  sentences.forEach(function (s) {
    for (var i = 0; i < MATERIAL_SIGNALS.length; i++) {
      if (MATERIAL_SIGNALS[i].test(s)) { claims.push(s); return; }
    }
  });
  return dedupe(claims);
};

/**
 * Match each claim to the source article that best supports it.
 *
 * `sources` is [{ article_id, url, title, summary, body }]. Scoring is by overlap
 * of the load-bearing tokens: numbers (weighted heavily, because a number is the
 * thing most likely to be invented) and capitalised multi-word names (schemes,
 * standards, places). A claim whose numbers appear in no source is 'unsupported'
 * and is the reviewer's first stop.
 */
var reconcile = function (claims, sources) {
  var src = (sources || []).map(function (s) {
    var hay = [s.title, s.summary, s.body].filter(Boolean).join(' \n ');
    return {
      article_id: s.article_id,
      url: s.url,
      title: s.title,
      text: hay,
      numbers: numbersIn(hay),
      names: namesIn(hay),
      sentences: splitSentences(hay),
    };
  });

  return (claims || []).map(function (raw) {
    var claim = String(raw && raw.claim != null ? raw.claim : raw).trim();
    var wantNums = numbersIn(claim);
    var wantNames = namesIn(claim);

    var best = null;
    var bestScore = 0;
    src.forEach(function (s) {
      var numHit = intersect(wantNums, s.numbers).length;
      var nameHit = intersect(wantNames, s.names).length;
      // A number match is worth far more than a name match: names recur across a
      // topic's sources, a specific figure does not.
      var score = numHit * 3 + nameHit;
      if (score > bestScore) { bestScore = score; best = s; }
    });

    // Verdict.
    //   supported    the claim's numbers are all found in one source
    //   needs_check  a partial match, or a claim with names but no numbers
    //   unsupported  the claim carries numbers and none of them appear anywhere
    var verdict, article_id = null, source_url = null, quote = null;
    if (best && wantNums.length && intersect(wantNums, best.numbers).length === wantNums.length) {
      verdict = 'supported';
      article_id = best.article_id;
      source_url = best.url;
      quote = sentenceCarrying(best.sentences, wantNums, wantNames);
    } else if (best && bestScore > 0) {
      verdict = 'needs_check';
      article_id = best.article_id;
      source_url = best.url;
      quote = sentenceCarrying(best.sentences, wantNums, wantNames);
    } else if (wantNums.length) {
      verdict = 'unsupported';
    } else {
      // No numbers to check and nothing matched: not a factual claim after all,
      // or one phrased without the figure. Flag for a human rather than pass it.
      verdict = 'needs_check';
    }

    return {
      claim: claim,
      article_id: article_id,
      source_url: source_url,
      source_quote: quote,
      verdict: verdict,
    };
  });
};

/** The source sentence that carries the most of the claim's tokens. */
var sentenceCarrying = function (sentences, nums, names) {
  var best = null;
  var bestScore = 0;
  (sentences || []).forEach(function (s) {
    var score = intersect(nums, numbersIn(s)).length * 3 + intersect(names, namesIn(s)).length;
    if (score > bestScore) { bestScore = score; best = s; }
  });
  return best ? best.trim().slice(0, 400) : null;
};

// Numbers that carry meaning: keep the digits and a trailing % or the leading $,
// drop ordinary years so "2026" in two places is not a false match on its own.
var numbersIn = function (text) {
  var out = {};
  var re = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|per ?cent|percent|kw|mw|gw|kwh|mwh|million|billion|m|bn|k)?/gi;
  var m;
  while ((m = re.exec(String(text || ''))) !== null) {
    var tok = m[0].toLowerCase().replace(/[, ]/g, '');
    // Drop a bare four-digit year; keep it if it has a unit or symbol attached.
    if (/^\d{4}$/.test(tok) && Number(tok) > 1990 && Number(tok) < 2100) continue;
    if (/\d/.test(tok)) out[tok] = true;
  }
  return Object.keys(out);
};

// Multi-word capitalised names: schemes, standards, agencies, places. Single
// capitalised words are too noisy (every sentence start), so require two.
var namesIn = function (text) {
  var out = {};
  var re = /\b([A-Z][A-Za-z]+(?:\s+(?:of|the|and|for)?\s*[A-Z][A-Za-z]+)+)\b/g;
  var m;
  while ((m = re.exec(String(text || ''))) !== null) {
    var name = m[1].replace(/\s+/g, ' ').trim().toLowerCase();
    if (name.length > 5) out[name] = true;
  }
  // Also capture well-known single-token acronyms that matter here.
  (String(text || '').match(/\b(NABERS|GEMS|VEU|CBD|NCC|AEMO|AER|CEC|PV)\b/g) || [])
    .forEach(function (a) { out[a.toLowerCase()] = true; });
  return Object.keys(out);
};

var intersect = function (a, b) {
  var set = {};
  (b || []).forEach(function (x) { set[x] = true; });
  return (a || []).filter(function (x) { return set[x]; });
};

var splitSentences = function (text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
};

var dedupe = function (arr) {
  var seen = {};
  return (arr || []).filter(function (x) {
    var k = String(x).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
};

module.exports = { extractClaims: extractClaims, reconcile: reconcile, numbersIn: numbersIn, namesIn: namesIn };
