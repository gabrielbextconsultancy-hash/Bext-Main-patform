/**
 * The pre-publish checklist, as a function that returns pass/fail rather than
 * prose.
 *
 * Adapted from sergebulaev/linkedin-skills (MIT),
 * skills/linkedin-humanizer/references/post-audit (the --mode audit pass).
 *
 * Two lists come back:
 *
 *   blockers   things that will visibly hurt the post: an external link in the
 *              body, no hook before the fold, a wall of hashtags. A human can
 *              still publish over a blocker, but the drafts page shows it in red
 *              so the choice is deliberate.
 *   warnings   things worth a glance: slightly long, no number, an em dash that
 *              the scrubber somehow left. Yellow, not red.
 *
 * This never rewrites. scrub.js rewrites; audit.js only judges the result, so the
 * two can disagree and that disagreement is information (a warning the scrubber
 * could not fix is exactly what the reviewer needs to see).
 *
 * Inlined into an n8n Code node by build-workflows.js, so no backticks and no
 * dollar-brace anywhere in this file.
 */

var H = require('./heuristics');

/**
 * Audit a draft.
 *
 * `post` is { body, hook, hashtags, link_url|destination_url, formula, goal }.
 * Returns { blockers: [...], warnings: [...], ok: bool, checkedAt } where each
 * entry is { rule, detail }. `ok` is true only when there are no blockers.
 */
var audit = function (post) {
  var p = post || {};
  var body = String(p.body == null ? '' : p.body);
  var hook = p.hook != null ? String(p.hook) : H.hookOf(body);
  var chars = H.charCount(body);
  var hashtags = normaliseHashtags(p.hashtags, body);
  var link = p.link_url || p.destination_url || '';

  var blockers = [];
  var warnings = [];

  // ── length ────────────────────────────────────────────────────────────────
  if (chars < H.BODY_ABSOLUTE_MIN) {
    blockers.push(rule('too short', 'Post is ' + chars + ' characters. Below ' + H.BODY_ABSOLUTE_MIN + ' reads as a thought nobody developed.'));
  } else if (chars < H.BODY_MIN) {
    warnings.push(rule('short', 'Post is ' + chars + ' characters. The sweet spot is ' + H.BODY_MIN + '-' + H.BODY_MAX + '.'));
  } else if (chars > H.BODY_HARD_MAX) {
    blockers.push(rule('too long', 'Post is ' + chars + ' characters. LinkedIn truncates past ' + H.BODY_HARD_MAX + '.'));
  } else if (chars > H.BODY_MAX) {
    warnings.push(rule('long', 'Post is ' + chars + ' characters. Above ' + H.BODY_MAX + ' needs a line break every sentence or two to hold.'));
  }

  // ── the hook ──────────────────────────────────────────────────────────────
  if (!hook.trim()) {
    blockers.push(rule('no hook', 'Nothing lands before the "... see more" fold.'));
  } else if (hook.length > H.HOOK_CHARS) {
    // hookOf caps this, so it only fires when a caller passed a hand-written hook.
    warnings.push(rule('hook past the fold', 'The hook runs to ' + hook.length + ' characters; the fold is at ' + H.HOOK_CHARS + '.'));
  }
  if (/^[A-Z0-9 ,!'".-]{18,}$/.test(hook.trim())) {
    warnings.push(rule('shouting hook', 'The first line is all caps. It reads as shouting, not emphasis.'));
  }

  // ── links ─────────────────────────────────────────────────────────────────
  var inBody = body.match(/https?:\/\/[^\s)]+/gi) || [];
  if (inBody.length && !H.LINK_IN_BODY_ALLOWED) {
    blockers.push(rule('link in body', 'An in-body link costs 40-60% of reach. Move it to the first comment: ' + inBody[0]));
  }
  if (!link && !inBody.length && /\b(read more|full piece|source below|link below|in the comments)\b/i.test(body)) {
    warnings.push(rule('promised link is missing', 'The post points at a link but none is set. Add the destination or drop the pointer.'));
  }

  // ── hashtags ──────────────────────────────────────────────────────────────
  if (hashtags.length > 5) {
    blockers.push(rule('hashtag wall', hashtags.length + ' hashtags reads as a spam account. Keep it to ' + H.HASHTAG_MAX + '.'));
  } else if (hashtags.length > H.HASHTAG_MAX) {
    warnings.push(rule('too many hashtags', hashtags.length + ' hashtags. 0-' + H.HASHTAG_MAX + ' performs at least as well.'));
  }

  // ── residual AI tells (the scrubber should have caught these) ─────────────
  if (/[—–]/.test(body)) {
    warnings.push(rule('em dash survived', 'An em or en dash is still in the body. The scrubber missed it, or an edit reintroduced it.'));
  }
  var closer = body.trim().slice(-80).toLowerCase();
  if (/(what do you think|thoughts)\s*\??\s*$/.test(closer)) {
    warnings.push(rule('dead closer', 'It ends on an engagement-bait question. End on a specific one instead.'));
  }

  // ── substance ─────────────────────────────────────────────────────────────
  if (!/\d/.test(body)) {
    warnings.push(rule('no number', 'No figure anywhere. The voice rule asks for one concrete number, from a source.'));
  }

  return {
    blockers: blockers,
    warnings: warnings,
    ok: blockers.length === 0,
    charCount: chars,
    hashtagCount: hashtags.length,
  };
};

/**
 * Hashtags either come as an array (the DB column) or have to be read out of the
 * body (a freshly-drafted post before the column is split out). Either way,
 * return the distinct set.
 */
var normaliseHashtags = function (arr, body) {
  var set = {};
  (arr || []).forEach(function (h) {
    var tag = String(h).replace(/^#/, '').trim();
    if (tag) set['#' + tag.toLowerCase()] = true;
  });
  (String(body || '').match(/#[A-Za-z0-9_]+/g) || []).forEach(function (h) {
    set[h.toLowerCase()] = true;
  });
  return Object.keys(set);
};

var rule = function (name, detail) { return { rule: name, detail: detail }; };

module.exports = { audit: audit };
