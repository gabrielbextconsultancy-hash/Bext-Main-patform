/**
 * The 2026 LinkedIn posting rules, as numbers rather than prose.
 *
 * Adapted from sergebulaev/linkedin-skills (MIT), references/algorithm-heuristics.md.
 * That file is a research summary; this is the part a machine can act on. Every
 * constant here is enforced somewhere: audit.js turns them into blockers and
 * warnings, the drafting prompt quotes them, and the scheduler picks slots from
 * POST_WINDOWS.
 *
 * Inlined into an n8n Code node by build-workflows.js, so no backticks and no
 * dollar-brace anywhere in this file.
 *
 * Where a rule is contested we keep the conservative reading. Reach numbers from
 * third-party trackers are not ground truth and none of them is load-bearing: the
 * blockers are all structural (length, hook, links), and the reach claims only
 * inform warnings.
 */

// The mobile "… see more" fold. Everything that has to land, lands before this.
var HOOK_CHARS = 210;

// Text-post sweet spot. Below MIN a post reads as a thought nobody developed;
// above HARD_MAX LinkedIn truncates.
var BODY_MIN = 900;
var BODY_MAX = 1300;
var BODY_ABSOLUTE_MIN = 400;
var BODY_HARD_MAX = 3000;

// 0 hashtags performs at least as well as 5+ in 2026 (the ranker embeds meaning
// rather than matching tags). 1-3 niche tags give a marginal lift; 5+ correlates
// with spam patterns.
var HASHTAG_MAX = 2;

// An in-body external link costs 40-60% of impressions. The link goes in the
// first comment instead, which is why linkedin_posts carries link_url separately
// from body rather than inside it.
var LINK_IN_BODY_ALLOWED = false;

// B2B audiences. Local time, Australia/Melbourne. 1 = Monday .. 7 = Sunday.
var POST_WINDOWS = [
  { day: 2, from: '07:30', to: '09:00' },
  { day: 3, from: '07:30', to: '09:00' },
  { day: 4, from: '07:30', to: '09:00' },
];

// Two posts in a day triggers a cannibalisation signal; six a week dilutes.
var MAX_POSTS_PER_DAY = 1;
var MAX_POSTS_PER_WEEK = 5;
var MIN_POSTS_PER_WEEK = 3;

// No pillar may own more than this share of a week, or the feed reads as one note
// played repeatedly.
var MAX_PILLAR_SHARE = 0.6;

// A formula used twice inside this window reads as a template.
var FORMULA_COOLDOWN_DAYS = 7;

// The four reactions a formula can be written to earn.
var GOALS = ['comments', 'reposts', 'likes', 'saves'];

/**
 * The hook is what survives the fold: the first paragraph, capped at HOOK_CHARS.
 * Taken from the body rather than asked for separately, so the two can never
 * disagree about what the post actually opens with.
 */
var hookOf = function (body) {
  var text = String(body == null ? '' : body).trim();
  var firstBreak = text.indexOf('\n\n');
  var opener = firstBreak > 0 ? text.slice(0, firstBreak) : text;
  if (opener.length <= HOOK_CHARS) return opener.trim();
  // Cut on a word, so a truncated hook still reads as a sentence.
  var cut = opener.slice(0, HOOK_CHARS);
  var space = cut.lastIndexOf(' ');
  return (space > HOOK_CHARS * 0.6 ? cut.slice(0, space) : cut).trim();
};

/** LinkedIn counts characters, including the line breaks. */
var charCount = function (body) {
  return String(body == null ? '' : body).length;
};

/**
 * The next free slot at or after `from`, honouring the posting windows and the
 * one-a-day rule.
 *
 * `taken` is the list of timestamps already claimed (approved or published posts).
 * Returns an ISO string, or null if nothing is free inside `horizonDays` — the
 * caller then asks the human rather than inventing a slot outside the windows.
 *
 * Times in the windows are local to `tz`. We resolve them by formatting a
 * candidate date in that zone rather than by adding a fixed offset, because
 * Melbourne is UTC+10 for half the year and UTC+11 for the other half, and
 * hardcoding either one drifts an hour at the DST boundary.
 */
var nextSlot = function (from, taken, tz, windows, horizonDays) {
  var zone = tz || 'Australia/Melbourne';
  var wins = windows && windows.length ? windows : POST_WINDOWS;
  var horizon = horizonDays || 21;
  var claimed = (taken || []).map(function (t) { return new Date(t).toDateString(); });

  var start = new Date(from || Date.now());
  for (var d = 0; d < horizon; d++) {
    var day = new Date(start.getTime() + d * 86400000);
    var parts = localParts(day, zone);
    var win = null;
    for (var i = 0; i < wins.length; i++) if (wins[i].day === parts.isoDay) win = wins[i];
    if (!win) continue;

    var slot = atLocalTime(day, zone, win.from);
    if (!slot || slot.getTime() < start.getTime()) {
      // Today's window has already passed, or the local time could not be
      // resolved. Either way, try tomorrow rather than posting outside the window.
      continue;
    }
    if (claimed.indexOf(slot.toDateString()) !== -1) continue;
    return slot.toISOString();
  }
  return null;
};

/** Weekday and Y-M-D of a date as seen in `tz`. */
var localParts = function (date, tz) {
  var fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  var out = {};
  fmt.formatToParts(date).forEach(function (p) { out[p.type] = p.value; });
  var names = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    isoDay: names[out.weekday] || 0,
    ymd: out.year + '-' + out.month + '-' + out.day,
  };
};

/**
 * The instant at which the wall clock in `tz` reads `hhmm` on the calendar day
 * `date` falls on there.
 *
 * Done by search rather than arithmetic: guess UTC, measure how far the guess
 * lands from the target in the target zone, correct, repeat. Two passes settle it
 * for every offset including the half-hour ones, and it needs no offset table.
 */
var atLocalTime = function (date, tz, hhmm) {
  var bits = String(hhmm || '').split(':');
  var wantH = Number(bits[0]);
  var wantM = Number(bits[1] || 0);
  if (!isFinite(wantH) || !isFinite(wantM)) return null;

  var ymd = localParts(date, tz).ymd;
  var guess = new Date(ymd + 'T' + pad(wantH) + ':' + pad(wantM) + ':00Z');
  for (var pass = 0; pass < 2; pass++) {
    var seen = readLocalTime(guess, tz);
    if (seen === null) return null;
    var drift = seen - (wantH * 60 + wantM);
    // Crossing midnight in the target zone shows up as a ~24h error; fold it.
    if (drift > 720) drift -= 1440;
    if (drift < -720) drift += 1440;
    if (drift === 0) return guess;
    guess = new Date(guess.getTime() - drift * 60000);
  }
  return guess;
};

/** Minutes past local midnight that `date` reads as in `tz`. */
var readLocalTime = function (date, tz) {
  var fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  var out = {};
  fmt.formatToParts(date).forEach(function (p) { out[p.type] = p.value; });
  var h = Number(out.hour);
  var m = Number(out.minute);
  if (!isFinite(h) || !isFinite(m)) return null;
  return (h % 24) * 60 + m;
};

var pad = function (n) { return (n < 10 ? '0' : '') + n; };

module.exports = { HOOK_CHARS: HOOK_CHARS, BODY_MIN: BODY_MIN, BODY_MAX: BODY_MAX, BODY_ABSOLUTE_MIN: BODY_ABSOLUTE_MIN, BODY_HARD_MAX: BODY_HARD_MAX, HASHTAG_MAX: HASHTAG_MAX, LINK_IN_BODY_ALLOWED: LINK_IN_BODY_ALLOWED, POST_WINDOWS: POST_WINDOWS, MAX_POSTS_PER_DAY: MAX_POSTS_PER_DAY, MAX_POSTS_PER_WEEK: MAX_POSTS_PER_WEEK, MIN_POSTS_PER_WEEK: MIN_POSTS_PER_WEEK, MAX_PILLAR_SHARE: MAX_PILLAR_SHARE, FORMULA_COOLDOWN_DAYS: FORMULA_COOLDOWN_DAYS, GOALS: GOALS, hookOf: hookOf, charCount: charCount, nextSlot: nextSlot, atLocalTime: atLocalTime, localParts: localParts };
