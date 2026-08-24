#!/usr/bin/env node
/**
 * Unit tests for the LinkedIn craft library.
 *
 *   node n8n/lib/linkedin/test.js
 *
 * These are the pure functions the content pipeline is built on: the scrubber
 * that removes AI tells, the auditor that judges a draft, the fact-checker that
 * matches claims to sources, the formula picker, the publish router. A bug in any
 * of them is invisible in production — a scrubber that misses an em dash, a
 * fact-checker that green-lights an invented figure, both produce output that
 * looks fine and is wrong. So they are tested here rather than trusted.
 *
 * No framework: this runs in the same plain-node environment the Code nodes do.
 * Exit 0 = clean, 1 = at least one failure.
 */
const { scrub } = require('./scrub');
const { audit } = require('./audit');
const { reconcile, extractClaims } = require('./factcheck');
const { pick } = require('./formulas');
const { plan, backend } = require('./publish');
const H = require('./heuristics');

let fail = 0;
const ok = (cond, msg) => {
  if (!cond) { console.log('  FAIL: ' + msg); fail++; }
  else console.log('  ok:   ' + msg);
};

console.log('scrub');
const dirty = 'In conclusion, we must leverage our robust synergy — fundamentally — to '
  + 'utilize the ecosystem. It is not just a tool, it is a game-changer. What do you think?';
const s = scrub(dirty);
ok(!/leverage/i.test(s.text), 'removes "leverage"');
ok(!/[—–]/.test(s.text), 'removes em/en dashes');
ok(!/In conclusion/i.test(s.text), 'removes essay closer');
ok(!/game-changer/i.test(s.text), 'removes dead phrase');
ok(!/what do you think/i.test(s.text), 'removes engagement-bait closer');
ok(!/fundamentally/i.test(s.text), 'removes filler adverb');
ok(scrub(s.text).text === s.text, 'is idempotent');
const ph = scrub('Solar Victoria now pays [Your Company] up to 300 dollars.');
ok(ph.flags.some(f => /placeholder/.test(f.rule)), 'flags an unfilled placeholder');
ok(/\[Your Company\]/.test(ph.text), 'never auto-fills a placeholder');

console.log('audit');
ok(audit({ body: 'Too short.' }).blockers.some(b => b.rule === 'too short'), 'blocks a too-short post');
ok(audit({ body: 'x'.repeat(950) + ' see https://example.com/x here.' })
  .blockers.some(b => b.rule === 'link in body'), 'blocks an in-body link');
ok(audit({ body: 'Solar Victoria lifted the rebate to 1400 dollars from 1 July.\n\n'
  + 'A commercial owner should recheck payback now. '.repeat(20), hashtags: ['solar'] }).ok,
  'passes a clean post');

console.log('factcheck');
const sources = [{ article_id: 7, url: 'http://a', title: 'Rebate rises',
  summary: 'Solar Victoria lifted the commercial rebate to 1400 dollars from 1 July 2026.' }];
const rec = reconcile([{ claim: 'The rebate is now 1400 dollars.' }, { claim: 'Payback fell to 3.2 years.' }], sources);
ok(rec[0].verdict === 'supported' && rec[0].article_id === 7, 'supports a claim whose number is in a source');
ok(rec[1].verdict === 'unsupported', 'flags a claim whose number is in no source');
ok(extractClaims('Solar rose 12%. I feel good about it.').length === 1, 'extracts only the material sentence');

console.log('formulas');
const chosen = pick(5, [], ['Solar', 'Buildings', 'Schemes', 'Cost'], 'Solar');
ok(chosen.length === 5, 'returns 5 variants');
ok(new Set(chosen.map(c => c.formula)).size === 5, 'all 5 formulas distinct');
ok(chosen[4].pillar === 'Solar', 'pins the plan pillar on the 5th variant');

console.log('publish');
ok(backend({}) === 'manual', 'defaults to manual');
ok(backend({ PUBLORA_API_KEY: 'x', LINKEDIN_PLATFORM_ID: 'y' }) === 'publora', 'picks publora when configured');
ok(backend({ LINKEDIN_API_TOKEN: 't', LINKEDIN_AUTHOR_URN: 'u' }) === 'linkedin', 'picks the official API when configured');
const pm = plan({ body: 'Post body here', hashtags: ['solar', 'veu'], destination_url: 'http://x' }, {});
ok(pm.mode === 'manual' && /first comment/.test(pm.message), 'manual plan puts the link in the first comment');
ok(/#solar #veu/.test(pm.text), 'appends hashtags at the end');

console.log('heuristics');
const slot = H.nextSlot(new Date('2026-08-24T00:00:00Z'), [], 'Australia/Melbourne', null, 14);
ok(!!slot && H.localParts(new Date(slot), 'Australia/Melbourne').isoDay >= 2, 'nextSlot lands on a posting-window day');

console.log(fail ? ('\n' + fail + ' FAILED') : '\nALL PASS (' + '24 assertions)');
process.exit(fail ? 1 : 0);
