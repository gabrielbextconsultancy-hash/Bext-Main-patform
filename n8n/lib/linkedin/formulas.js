/**
 * The hook formulas, and how five different ones get picked for one job.
 *
 * Adapted from sergebulaev/linkedin-skills (MIT), references/hook-formulas.md.
 * The skeletons are condensed to what a drafting prompt needs: the shape of the
 * post and the reaction it is written to earn. The upstream reference engagement
 * numbers are deliberately not carried over — they came from a different corpus
 * in a different market, and quoting them here would give a number more authority
 * than it has. The goal tag is the part that is actually load-bearing.
 *
 * Inlined into an n8n Code node by build-workflows.js, so no backticks and no
 * dollar-brace anywhere in this file.
 */

var FORMULAS = [
  {
    id: 'F1',
    name: 'Platform Risk Anaphora',
    goal: 'comments',
    shape: [
      'Four to six short lines with the same opening structure, each naming a different way the',
      'reader is exposed. Escalate: each line more specific than the last.',
      'Then one line that reframes what the real exposure is.',
      'Then what you would do about it, as two or three concrete steps.',
      'Close on a personal-audit question.',
    ],
    why: 'Stacked loss aversion. The repetition builds pressure the reframe then releases.',
  },
  {
    id: 'F2',
    name: 'Category Obituary',
    goal: 'reposts',
    shape: [
      'Open by declaring a practice or an era over, in four words or fewer.',
      'State the cause of death: the specific mechanism, with a date and a number.',
      'Two short paragraphs of evidence, each with a source you can name.',
      'Admit what you believed before, and what changed your mind.',
      'Close on what replaces it.',
    ],
    why: 'A flat declaration invites disagreement, and disagreement gets reshared.',
  },
  {
    id: 'F3',
    name: 'Year-over-Year Pivot',
    goal: 'reposts',
    shape: [
      'Two dates, the same question, two different answers.',
      'What was true then, in one paragraph with the number that made it true.',
      'What is true now, in one paragraph with the number that changed.',
      'The one thing that caused the shift.',
      'Close on what it means for the reader this year.',
    ],
    why: 'A measured before and after is the cheapest proof that something moved.',
  },
  {
    id: 'F4',
    name: 'Time-Anchor Confession',
    goal: 'comments',
    shape: [
      'Open with a specific moment: a date, a room, a job that was in front of you.',
      'The thing you got wrong, stated plainly and without softening.',
      'What it cost, with the number.',
      'What you do differently now.',
      'Close by asking the reader for the version of this they have lived.',
    ],
    why: 'Specific stakes earn specific replies. Vague reflection earns nothing.',
  },
  {
    id: 'F5',
    name: 'Self-Proving Meta',
    goal: 'comments',
    shape: [
      'State a commitment or a test you are running, in public, with a deadline.',
      'The rules you set yourself, as three short lines.',
      'What you expect to happen, and what would prove you wrong.',
      'Close by inviting the reader to check back on the date.',
    ],
    why: 'A post that can be verified later is one people come back to.',
  },
  {
    id: 'F6',
    name: 'Comment-Gate Lead Magnet',
    goal: 'comments',
    shape: [
      'Name a resource you built and what it saves the reader.',
      'Three lines on what is inside it, each concrete.',
      'Ask readers to comment a single word to receive it.',
    ],
    why: 'Effective and capped: it converts, but it suppresses reach. Use rarely.',
    caution: 'Reach-capped and reads as a tactic. At most once a quarter.',
  },
  {
    id: 'F7',
    name: 'Odd-Precision Ledger',
    goal: 'saves',
    shape: [
      'Open with an exact figure, odd rather than round.',
      'Break it into its parts, one line each, each line a real cost.',
      'The line that surprised you, and why.',
      'What the total buys, in terms the reader can compare against their own.',
      'Close on the decision the numbers made for you.',
    ],
    why: 'Odd numbers read as measured. Round numbers read as estimated.',
  },
  {
    id: 'F8',
    name: 'Paid-vs-Free Reversal',
    goal: 'saves',
    shape: [
      'Name something people pay for, and say you are giving the substance of it away.',
      'Then give it away properly: the actual method, in steps, not a teaser.',
      'The one part that genuinely needs a professional, stated honestly.',
      'Close without asking for anything.',
    ],
    why: 'Giving the method away is the strongest possible claim to knowing it.',
  },
  {
    id: 'F9',
    name: 'Curiosity Gap',
    goal: 'comments',
    shape: [
      'Open on something that happened which should not have.',
      'Withhold the cause for two short paragraphs while adding detail.',
      'Reveal the cause. It must be worth the wait.',
      'Close on what it implies for anyone with the same setup.',
    ],
    why: 'Dwell time. The gap holds attention, provided the payoff is real.',
    caution: 'A gap with a weak payoff reads as clickbait and is penalised.',
  },
  {
    id: 'F10',
    name: 'Contrarian With Receipts',
    goal: 'comments',
    shape: [
      'State the accepted view in one line, fairly.',
      'Say plainly that it is wrong.',
      'Three pieces of evidence, each with a date and a source you name.',
      'Concede the strongest point on the other side.',
      'Close on what you would do instead.',
    ],
    why: 'Disagreement without receipts is noise. With receipts it is a position.',
  },
  {
    id: 'F11',
    name: 'Emotional Cold-Open',
    goal: 'likes',
    shape: [
      'Open mid-scene, no setup. One sentence that puts the reader in the room.',
      'The stakes, in a line.',
      'What happened, told in short paragraphs with real detail.',
      'What it taught you, stated once and not laboured.',
    ],
    why: 'Story before argument. Readers finish stories.',
  },
  {
    id: 'F12',
    name: 'Permission Slip',
    goal: 'comments',
    shape: [
      'Name the thing your reader quietly believes they should be doing.',
      'Say they do not have to.',
      'Why the pressure exists, and who benefits from it.',
      'What matters instead.',
      'Close on a question about what they have let go of.',
    ],
    why: 'Relief is a stronger reason to reply than agreement.',
  },
  {
    id: 'F13',
    name: 'Bait-and-Switch Reversal',
    goal: 'likes',
    shape: [
      'Open as though announcing bad news.',
      'Two lines that let the reader assume the worst.',
      'Turn: it is an upgrade, and here is the mechanism.',
      'Close on what changes for them.',
    ],
    why: 'The turn earns the read. Only works when the reversal is genuine.',
    caution: 'Never fake the setup. A false alarm costs trust once and permanently.',
  },
  {
    id: 'F14',
    name: 'Named Gratitude',
    goal: 'reposts',
    shape: [
      'Name the people, specifically, and what each one actually did.',
      'One concrete moment per person.',
      'What the work produced.',
      'Close without a CTA.',
    ],
    why: 'Named people reshare. Generic thanks does not travel.',
  },
  {
    id: 'F15',
    name: 'Explain It Plainly',
    goal: 'saves',
    shape: [
      'Name the jargon everyone nods along to.',
      'Explain it in the words you would use to a client who has never heard it.',
      'One worked example with real numbers.',
      'What it actually changes for them.',
      'Close on the next term worth demystifying.',
    ],
    why: 'Clear explanations of expensive jargon get saved and sent on.',
  },
  {
    id: 'F16',
    name: 'Status-Strip Humility',
    goal: 'likes',
    shape: [
      'Open by naming the thing you are supposed to be expert in.',
      'The part you still get wrong.',
      'A recent example, with the detail that makes it real.',
      'What you rely on instead of confidence.',
    ],
    why: 'Warmth from a senior voice reads as trustworthy rather than modest.',
  },
  {
    id: 'F17',
    name: 'Controlled A/B',
    goal: 'comments',
    shape: [
      'Two situations identical except for one variable. Name the variable.',
      'What happened in the first, with numbers.',
      'What happened in the second, with the same numbers.',
      'What the difference proves, and what it does not.',
      'Close on where the reader could run the same comparison.',
    ],
    why: 'One controlled variable is the most persuasive structure available.',
  },
  {
    id: 'F18',
    name: 'False-Binary Dissolve',
    goal: 'comments',
    shape: [
      'State the two options everyone argues between.',
      'Show why the first fails, concretely.',
      'Show why the second fails, just as concretely.',
      'Name the third thing both sides are missing.',
      'Close on what it would take to do the third.',
    ],
    why: 'Refusing both sides of a familiar argument earns attention from both.',
  },
  {
    id: 'F19',
    name: 'Anecdote Meets Evidence',
    goal: 'saves',
    shape: [
      'Open on something small you noticed in the field.',
      'Then the data that says it is not just you: two or three sources, each named.',
      'Where the anecdote and the data disagree.',
      'What you now think is happening.',
      'Close on what would settle it.',
    ],
    why: 'A story makes it readable. The data makes it citable.',
  },
  {
    id: 'F20',
    name: 'Diverging Curves',
    goal: 'reposts',
    shape: [
      'Two trends that used to move together.',
      'When they separated, with the date and the numbers.',
      'Why they separated.',
      'Where each ends up if nothing changes.',
      'Close on one quotable line.',
    ],
    why: 'A divergence is a picture people can carry, and a quotable close travels.',
  },
];

var BY_ID = {};
FORMULAS.forEach(function (f) { BY_ID[f.id] = f; });

var BY_GOAL = { comments: [], reposts: [], likes: [], saves: [] };
FORMULAS.forEach(function (f) { if (BY_GOAL[f.goal]) BY_GOAL[f.goal].push(f); });

// Formulas that carry a caution are usable but not automatically selectable. F6
// costs reach every time, and F9 and F13 fail badly when the payoff is thin, so a
// human asks for those rather than the picker reaching for them unprompted.
var AUTO_EXCLUDED = ['F6', 'F9', 'F13'];

// Fully-automated posts (no human reviewing the text) must not invent a
// first-person experience — a fabricated anecdote under a real name is a
// credibility risk the human gate would otherwise catch. FACTUAL is the subset
// that analyses or explains the source news without narrating a personal scene:
// contrarian-with-receipts, explain-it-plainly, false-binary, diverging-curves,
// paid-vs-free framework. The confession, emotional cold-open, year-over-year "I
// changed", named-gratitude and self-proving formulas all imply lived experience
// and are kept for human-reviewed cycles only.
var FACTUAL = ['F10', 'F15', 'F18', 'F20', 'F8'];

/**
 * Pick `count` distinct (formula, goal, pillar) triples for one generation job.
 *
 * The five variants exist to be genuinely different, not five rewordings, so the
 * first four take one formula per engagement goal and the fifth comes from the
 * pillar the weekly plan has under-served. Formulas used within the cooldown
 * window are skipped; if that empties a goal's bank we fall back to the least
 * recently used rather than dropping the variant, because four drafts and an
 * apology is worse than five drafts one of which repeats a shape.
 *
 * `recent` is a list of { formula, created_at } from linkedin_posts.
 * `pillars` is the voice profile's pillar list; `planPillar` is what the weekly
 * plan wants emphasised, if anything.
 */
var pick = function (count, recent, pillars, planPillar, factualOnly) {
  var n = count || 5;
  var used = recencyMap(recent);
  var out = [];
  var taken = {};
  // In factual-only mode (no human reviewing the post) the whole pool is the
  // FACTUAL subset, so no goal-bank or fallback can reach an anecdote formula.
  var allow = factualOnly ? function (f) { return FACTUAL.indexOf(f.id) !== -1; } : function () { return true; };
  var bankFor = function (list) { return (list || []).filter(allow); };

  var goals = ['comments', 'reposts', 'likes', 'saves'];
  for (var g = 0; g < goals.length && out.length < n; g++) {
    var f = leastRecent(bankFor(BY_GOAL[goals[g]]), used, taken);
    if (!f) continue;
    taken[f.id] = true;
    out.push({ formula: f.id, name: f.name, goal: f.goal, pillar: pillarFor(out.length, pillars, planPillar), shape: f.shape, why: f.why });
  }

  // Any remaining variants: whatever is least recently used across the allowed bank.
  while (out.length < n) {
    var extra = leastRecent(bankFor(FORMULAS), used, taken);
    if (!extra) break;
    taken[extra.id] = true;
    out.push({ formula: extra.id, name: extra.name, goal: extra.goal, pillar: pillarFor(out.length, pillars, planPillar), shape: extra.shape, why: extra.why });
  }
  return out;
};

/** Most recent use of each formula, as a timestamp. Never used reads as 0. */
var recencyMap = function (recent) {
  var map = {};
  (recent || []).forEach(function (r) {
    var id = r.formula || r.id;
    var at = new Date(r.created_at || r.at || 0).getTime();
    if (!id || !isFinite(at)) return;
    if (!map[id] || at > map[id]) map[id] = at;
  });
  return map;
};

var leastRecent = function (bank, used, taken) {
  var best = null;
  var bestAt = Infinity;
  (bank || []).forEach(function (f) {
    if (taken[f.id]) return;
    if (AUTO_EXCLUDED.indexOf(f.id) !== -1) return;
    var at = used[f.id] || 0;
    if (at < bestAt) { bestAt = at; best = f; }
  });
  return best;
};

/**
 * The fifth variant carries the plan's pillar; the rest rotate through the voice
 * profile's pillars so one job does not produce five posts about solar.
 */
var pillarFor = function (index, pillars, planPillar) {
  var list = (pillars || []).filter(Boolean);
  if (index === 4 && planPillar) return planPillar;
  if (!list.length) return planPillar || null;
  return list[index % list.length];
};

/** The formula, as the block that goes into the drafting prompt. */
var formulaPromptBlock = function (choice) {
  var f = BY_ID[choice && choice.formula] || null;
  if (!f) return '';
  var lines = [];
  lines.push('FORMULA ' + f.id + ' - ' + f.name);
  lines.push('Written to earn: ' + f.goal + '.');
  lines.push('Why this shape works: ' + f.why);
  if (f.caution) lines.push('Caution: ' + f.caution);
  lines.push('Structure, in order:');
  f.shape.forEach(function (s) { lines.push('  ' + s); });
  return lines.join('\n');
};

module.exports = { FORMULAS: FORMULAS, BY_ID: BY_ID, BY_GOAL: BY_GOAL, AUTO_EXCLUDED: AUTO_EXCLUDED, FACTUAL: FACTUAL, pick: pick, formulaPromptBlock: formulaPromptBlock };
