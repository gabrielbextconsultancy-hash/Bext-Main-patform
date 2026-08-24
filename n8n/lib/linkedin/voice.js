/**
 * How BEXT sounds, and the words that are not allowed anywhere near it.
 *
 * Adapted from sergebulaev/linkedin-skills (MIT), references/voice-rules.md.
 *
 * Two halves. The constants below are the floor: rules that hold no matter who
 * the client is, because they catch machine-writing rather than taste. The other
 * half lives in the linkedin_voice table, so the client can ban a phrase or move
 * a posting window without a deploy. `merge` puts them together, table first.
 *
 * Inlined into an n8n Code node by build-workflows.js, so no backticks and no
 * dollar-brace anywhere in this file.
 */

// Words that mark a sentence as machine-written, or as the corporate register
// nobody speaks in. Replacements are deliberately plain; scrub.js applies them.
var VOCAB_SWAPS = [
  ['leverage', 'use'],
  ['leveraging', 'using'],
  ['utilise', 'use'],
  ['utilize', 'use'],
  ['facilitate', 'help'],
  ['streamline', 'simplify'],
  ['delve into', 'look at'],
  ['delve', 'look'],
  ['harness', 'use'],
  ['foster', 'build'],
  ['unlock', 'open up'],
  ['navigate the', 'work through the'],
  ['seamless', 'clean'],
  ['seamlessly', 'cleanly'],
  ['robust', 'solid'],
  ['spearhead', 'lead'],
  ['myriad of', 'many'],
  ['plethora of', 'many'],
];

// Adverbs that add emphasis and no information. Deleted rather than replaced.
var FILLER_ADVERBS = [
  'fundamentally', 'essentially', 'ultimately', 'crucially', 'notably',
  'importantly', 'significantly', 'undoubtedly', 'truly', 'simply',
];

// Nouns that mean nothing in a post about a rebate deadline.
var ABSTRACT_NOUNS = ['landscape', 'ecosystem', 'paradigm', 'realm', 'tapestry', 'journey'];

// Phrases with no defence. Deleted with their sentence.
var DEAD_PHRASES = [
  'in today’s fast-paced world',
  "in today's fast-paced world",
  'at the end of the day',
  'game-changer',
  'game changer',
  'deep dive',
  'move the needle',
  'the bottom line is',
  'needless to say',
  'it goes without saying',
];

// Closers that ask for engagement instead of earning it. LinkedIn's own ranker
// discounts them and readers skip them.
var DEAD_CLOSERS = [
  'what do you think?',
  'thoughts?',
  'tag someone who needs this',
  'agree?',
  'let me know in the comments',
  'drop a comment below',
  'like and share',
];

// Openers that announce a post is coming rather than starting it.
var DEAD_OPENERS = [
  'i am excited to announce',
  'i’m excited to announce',
  "i'm excited to announce",
  'i am thrilled to share',
  'i’m thrilled to share',
  "i'm thrilled to share",
  'let that sink in',
  'here is the thing',
  'buckle up',
];

// The "not just X, it's Y" construction and its five siblings. Regex rather than
// literals, because the filler between the halves varies.
var NEGATIVE_PARALLELISM = [
  /\bit(?:'|’)?s not (?:just |only |merely )?[^,.]{2,60}, it(?:'|’)?s [^.!?]{2,80}[.!?]/gi,
  /\bthis is(?:n't| not) (?:just |only |merely )?[^,.]{2,60}, (?:it|this) is [^.!?]{2,80}[.!?]/gi,
  /\bnot (?:just |only |merely )[^,.]{2,60} but [^.!?]{2,80}[.!?]/gi,
];

// Structural rules the drafter is told about and audit.js checks.
var HARD_RULES = [
  'No em dashes, en dashes or double dashes anywhere. Use a full stop, or two dots as a soft pause.',
  'Capitalise every organisation, scheme and product name: NABERS, Solar Victoria, Victorian Energy Upgrades.',
  'One concrete number or named scheme per post, taken from the source article. Never invent one.',
  'No external link in the body. The link goes in the first comment.',
  'Never claim a rebate figure, eligibility rule or deadline the source article does not carry.',
  'No advice that reads as financial or legal advice.',
  'End on a specific question or a clean landing, never on a generic prompt.',
];

/**
 * The voice row from Postgres, merged over these defaults.
 *
 * The table wins on everything it sets, because it is the client's copy and this
 * file is ours. Arrays concatenate rather than replace: a client adding a banned
 * term must not silently drop the built-in list.
 */
var merge = function (row) {
  var v = row || {};
  return {
    author: v.author || 'BEXT Consultancy',
    audience: v.audience || '',
    fingerprint: v.fingerprint || '',
    pillars: voiceArray(v.pillars),
    bannedTerms: DEAD_PHRASES
      .concat(ABSTRACT_NOUNS)
      .concat(VOCAB_SWAPS.map(function (p) { return p[0]; }))
      .concat(voiceArray(v.banned_terms)),
    alwaysRules: HARD_RULES.concat(voiceArray(v.always_rules)),
    neverRules: voiceArray(v.never_rules),
    ctaStyle: v.cta_style || 'Soft invite. The link goes in the first comment.',
    postWindows: voiceArray(v.post_windows),
  };
};

/**
 * The voice, as the paragraph that goes into the drafting prompt.
 *
 * Built here rather than in the workflow so the prompt and the scrubber cannot
 * describe different rules: both read this module.
 */
var voicePromptBlock = function (voice) {
  var v = voice || merge(null);
  var lines = [];
  lines.push('VOICE. You are writing as ' + v.author + '.');
  if (v.audience) lines.push('Audience: ' + v.audience);
  if (v.fingerprint) lines.push('How it sounds: ' + v.fingerprint);
  if (v.pillars.length) lines.push('Themes: ' + v.pillars.join(', '));
  lines.push('');
  lines.push('ALWAYS:');
  v.alwaysRules.forEach(function (r) { lines.push('  - ' + r); });
  if (v.neverRules.length) {
    lines.push('NEVER:');
    v.neverRules.forEach(function (r) { lines.push('  - ' + r); });
  }
  lines.push('');
  lines.push('BANNED WORDS. Do not use any of these, in any form:');
  lines.push('  ' + v.bannedTerms.slice(0, 60).join(', '));
  lines.push('');
  lines.push('CTA: ' + v.ctaStyle);
  return lines.join('\n');
};

var voiceArray = function (v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { var parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : [v]; }
    catch (e) { return [v]; }
  }
  return [];
};

module.exports = { VOCAB_SWAPS: VOCAB_SWAPS, FILLER_ADVERBS: FILLER_ADVERBS, ABSTRACT_NOUNS: ABSTRACT_NOUNS, DEAD_PHRASES: DEAD_PHRASES, DEAD_CLOSERS: DEAD_CLOSERS, DEAD_OPENERS: DEAD_OPENERS, NEGATIVE_PARALLELISM: NEGATIVE_PARALLELISM, HARD_RULES: HARD_RULES, merge: merge, voicePromptBlock: voicePromptBlock };
