/**
 * The humanizer: AI tells removed by code, after the model has finished.
 *
 * Adapted from sergebulaev/linkedin-skills (MIT),
 * skills/linkedin-humanizer/references/scrub-rules.md.
 *
 * Why deterministic rather than a second prompt: asking a model not to write like
 * a model works most of the time, and "most of the time" is exactly the failure
 * mode nobody notices until a client points at a published post. Regex either
 * matches or it does not, it costs nothing, and every change it makes is recorded
 * so the drafts page can show what was touched.
 *
 * Two tiers, both on by default:
 *
 *   FORENSIC  real model leakage. No human produces these. No defence exists.
 *   STRICT    corporate register. Bad writing whoever wrote it, and easy to defend
 *             banning: nobody says "leverage" out loud to a client.
 *
 * The upstream AESTHETIC tier (rule-of-three, passive voice, "robust") is not
 * ported. Those rules catch good human writing as often as machine writing, and a
 * scrubber that flattens a real sentence is worse than one that misses a tell.
 *
 * Inlined into an n8n Code node by build-workflows.js, so no backticks and no
 * dollar-brace anywhere in this file.
 */

var VOICE = require('./voice');

// ── FORENSIC ────────────────────────────────────────────────────────────────

// Tool leakage. Deleted outright.
var FORENSIC_MARKERS = [
  /\boaicite\b/gi,
  /\bcontentReference\[\^?\d*\]?/gi,
  /\bturn\d+search\d+\b/gi,
  /\battached_file\b/gi,
  /\bgrok_card\b/gi,
  /\boai_citation\b/gi,
  /【[^】]*】/g,
];

// The model talking about itself. The whole sentence goes.
var CUTOFF_DISCLAIMERS = [
  /As of my (?:last update|knowledge cutoff|training cutoff)[^.!?]*[.!?]/gi,
  /Based on (?:the )?(?:information|data) (?:available|up to)[^.!?]*[.!?]/gi,
  /My (?:knowledge|training data) (?:cuts off|extends to)[^.!?]*[.!?]/gi,
  /I (?:cannot|can't) provide (?:real-time|current|up-to-date)[^.!?]*[.!?]/gi,
  /As an AI(?: language model)?[^.!?]*[.!?]/gi,
];

// Unfilled template slots. Flagged, never auto-filled: guessing what belongs in
// [Your Company] is how a client's name ends up wrong in public.
var PHRASAL_TEMPLATES = [
  /\[(?:Your|Insert|Add|Describe)[^\]]{0,40}\]/gi,
  /\[(?:NAME|DATE|TOPIC|COMPANY|NUMBER)\]/g,
  /\b20\d\d-XX-XX\b/g,
];

// The essay closers a model reaches for when it has run out of things to say.
var OUTLINE_CLOSERS = [
  /\bIn conclusion,[^.!?]*[.!?]/gi,
  /\bTo summari[sz]e,[^.!?]*[.!?]/gi,
  /\bIn summary,[^.!?]*[.!?]/gi,
  /\bLooking ahead,[^.!?]*(?:will|must|should)[^.!?]*[.!?]/gi,
  /\bDespite (?:its|the) [^,]{2,50}, [^.!?]*(?:challenges|obstacles)[^.!?]*[.!?]/gi,
];

/**
 * Scrub a draft.
 *
 * Returns { text, changes, flags }:
 *   changes  what was removed or replaced, for the drafts page diff
 *   flags    what a human must fix, because the fix needs a fact we do not have
 *
 * Idempotent: scrubbing an already-scrubbed draft changes nothing, which matters
 * because the dashboard re-runs this on every save.
 */
var scrub = function (input) {
  var text = String(input == null ? '' : input);
  var changes = [];
  var flags = [];

  // ── forensic ──────────────────────────────────────────────────────────────
  text = strip(text, FORENSIC_MARKERS, 'forensic', 'tool marker', changes);
  text = strip(text, CUTOFF_DISCLAIMERS, 'forensic', 'model disclaimer', changes);
  text = strip(text, OUTLINE_CLOSERS, 'forensic', 'essay closer', changes);

  PHRASAL_TEMPLATES.forEach(function (re) {
    var found = text.match(re);
    if (found) {
      found.forEach(function (m) {
        flags.push({ tier: 'forensic', rule: 'unfilled placeholder', text: m });
      });
    }
  });

  // ── strict: punctuation ───────────────────────────────────────────────────
  // Em dashes are the single most reliable tell, and this bundle bans them
  // outright rather than rationing them. An em dash between clauses becomes a
  // full stop; the spacing is normalised afterwards.
  text = replaceAll(text, /\s*[—–]\s*/g, '. ', 'strict', 'em dash', changes);
  text = replaceAll(text, /(\w)\s*--\s*(\w)/g, '$1. $2', 'strict', 'double dash', changes);
  text = replaceAll(text, /[“”]/g, '"', 'strict', 'curly quote', changes);
  text = replaceAll(text, /[‘’]/g, "'", 'strict', 'curly apostrophe', changes);
  text = replaceAll(text, /…/g, '...', 'strict', 'ellipsis character', changes);

  // ── strict: vocabulary ────────────────────────────────────────────────────
  VOICE.VOCAB_SWAPS.forEach(function (pair) {
    var re = new RegExp('\\b' + escapeRe(pair[0]) + '\\b', 'gi');
    text = text.replace(re, function (m) {
      changes.push({ tier: 'strict', rule: 'corporate vocabulary', from: m, to: pair[1] });
      return matchCase(m, pair[1]);
    });
  });

  VOICE.FILLER_ADVERBS.forEach(function (word) {
    // Leading "Fundamentally, " and mid-sentence " essentially" both go, and the
    // sentence still parses either way.
    var lead = new RegExp('(^|\\n|(?:[.!?]\\s+))' + escapeRe(word) + ',\\s*', 'gi');
    text = text.replace(lead, function (m, pre) {
      changes.push({ tier: 'strict', rule: 'filler adverb', from: m.trim(), to: '' });
      return pre;
    });
    var mid = new RegExp('\\s+' + escapeRe(word) + '\\b', 'gi');
    text = text.replace(mid, function (m) {
      changes.push({ tier: 'strict', rule: 'filler adverb', from: m.trim(), to: '' });
      return '';
    });
  });

  // ── strict: phrases and constructions ─────────────────────────────────────
  VOICE.DEAD_PHRASES.forEach(function (p) {
    var re = new RegExp('[^.!?\\n]*' + escapeRe(p) + '[^.!?\\n]*[.!?]?', 'gi');
    text = text.replace(re, function (m) {
      changes.push({ tier: 'strict', rule: 'dead phrase', from: m.trim(), to: '' });
      return '';
    });
  });

  text = strip(text, VOICE.NEGATIVE_PARALLELISM, 'strict', 'negative parallelism', changes);

  VOICE.DEAD_CLOSERS.forEach(function (c) {
    var re = new RegExp('\\s*' + escapeRe(c) + '\\s*$', 'i');
    text = text.replace(re, function (m) {
      changes.push({ tier: 'strict', rule: 'engagement bait closer', from: m.trim(), to: '' });
      return '';
    });
  });

  VOICE.DEAD_OPENERS.forEach(function (o) {
    var re = new RegExp('^\\s*' + escapeRe(o) + '[^.!?\\n]*[.!?]\\s*', 'i');
    text = text.replace(re, function (m) {
      changes.push({ tier: 'strict', rule: 'announcement opener', from: m.trim(), to: '' });
      return '';
    });
  });

  // Hashtag walls. The audit enforces the count; here we only pull them out of
  // mid-sentence, where they read as spam regardless of how many there are.
  text = text.replace(/([a-z,;])\s(#[A-Za-z0-9_]+)(?=\s+[a-z])/g, function (m, before, tag) {
    changes.push({ tier: 'strict', rule: 'mid-sentence hashtag', from: tag, to: '' });
    return before;
  });

  return { text: tidy(text), changes: changes, flags: flags };
};

/** Delete every match of every pattern, recording each one. */
var strip = function (text, patterns, tier, rule, changes) {
  var out = text;
  patterns.forEach(function (re) {
    out = out.replace(re, function (m) {
      changes.push({ tier: tier, rule: rule, from: String(m).trim(), to: '' });
      return '';
    });
  });
  return out;
};

var replaceAll = function (text, re, to, tier, rule, changes) {
  return text.replace(re, function (m) {
    changes.push({ tier: tier, rule: rule, from: m, to: to.replace(/\$\d/g, '') });
    return to.indexOf('$') === -1 ? to : m.replace(re, to);
  });
};

/**
 * Whitespace repair, run once at the end.
 *
 * Every rule above leaves holes: a deleted sentence leaves a double space, a
 * removed opener leaves a leading blank line. Repairing centrally means a new
 * rule cannot forget to clean up after itself. Paragraph breaks are preserved,
 * because double line breaks between ideas are a LinkedIn formatting rule, not
 * stray whitespace.
 */
var tidy = function (text) {
  return String(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/([.!?]){2,}(?!\.)/g, '$1')
    .replace(/\.\s*\./g, '.')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** Keep the original capitalisation when swapping a word. */
var matchCase = function (source, replacement) {
  if (source === source.toUpperCase() && source.length > 1) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
};

var escapeRe = function (s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

module.exports = { scrub: scrub, tidy: tidy, FORENSIC_MARKERS: FORENSIC_MARKERS, CUTOFF_DISCLAIMERS: CUTOFF_DISCLAIMERS, OUTLINE_CLOSERS: OUTLINE_CLOSERS, PHRASAL_TEMPLATES: PHRASAL_TEMPLATES };
