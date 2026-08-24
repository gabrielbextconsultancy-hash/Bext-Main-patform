/**
 * docs/REGRESSIONS.md as data, so the healer can recognise at 03:00 what a human
 * recognises instantly.
 *
 * Each rule carries the SAME id as its check in n8n/preflight.js and its section
 * in docs/REGRESSIONS.md. One fact, three views: prose for a person, a static
 * assertion for the build, a runtime matcher for the healer. Preflight R026
 * asserts the ids here all exist over there, so they cannot drift apart.
 *
 * Two hard limits on what belongs in this file:
 *
 *   1. `action` may only be something reversible and bounded. Every code-level
 *      regression (R001, R003, R005, R007, R017, R020, R021, R022) is fixed by
 *      editing build-workflows.js and redeploying — never by the healer patching
 *      code. Those rules are here to NAME the failure in the Teams post, with
 *      action 'escalate'. Recognising a failure and being allowed to fix it are
 *      different permissions.
 *
 *   2. `signature` is matched against the error text of a FAILED execution.
 *      A workflow that silently produces nothing never appears here — that is
 *      what the Kuma push monitors and preflight R024 are for. Do not try to
 *      make this file detect absence; it cannot see it.
 */

// Regexes are matched case-insensitively against the execution error message.
// Keep them anchored on the part of the message that is stable: n8n decorates
// errors with node names and run indices that change between versions.
const RULES = [
  // ── things the healer is allowed to act on ────────────────────────────────
  {
    id: 'R101',
    title: 'a workflow deactivated itself',
    // The R024 failure, seen from the execution side: a flapping trigger
    // deregisters its crons and the workflow reads active while nothing runs.
    signature: 'workflow (is not active|was deactivated)|trigger .*(deregistered|failed to (start|register))',
    action: 'reactivate_workflow',
  },
  {
    id: 'R102',
    title: 'a transient upstream 5xx or timeout',
    signature: '\\b(50[0234])\\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network timeout',
    action: 'retry_execution',
  },
  {
    id: 'R103',
    title: 'the Graph token expired mid-run',
    // InvalidAuthenticationToken is the one worth acting on. A 403 is a CONSENT
    // problem — a fresh token has exactly the same scopes, so retrying it just
    // burns the rate cap. Kept apart deliberately; see R106.
    signature: 'InvalidAuthenticationToken|Lifetime validation failed|token is expired|AADSTS700082',
    action: 'refresh_graph_token',
  },
  {
    id: 'R104',
    title: 'the fetcher or scrapling container is not answering',
    // The fetcher on :8080 being down surfaces as a connection error inside a
    // workflow, which reads like a code bug — docs/INFRASTRUCTURE.md says so
    // explicitly. Name it, restart it.
    signature: 'connect (ECONNREFUSED|EHOSTUNREACH) .*(8080|fetcher|scrapling)|fetcher unreachable',
    action: 'restart_container',
    container: 'bext-fetcher',
  },
  {
    id: 'R105',
    title: 'the live workflow drifted from the repo',
    // Rule 7: the repo is the source of truth, so drift is resolved by pushing
    // the repo over the instance, never the other way.
    signature: 'workflow (json )?mismatch|node .* not found in workflow',
    action: 'redeploy_workflow',
  },
  {
    id: 'R106',
    title: 'a source needs the browser fetcher',
    signature: '\\b(40[3149])\\b|blocked by (cloudflare|captcha)|access denied|just a moment',
    action: 'flag_source_browser',
  },

  // ── things the healer may only NAME ───────────────────────────────────────
  // All of these are code defects. The fix is a commit, not a runtime action.
  {
    id: 'R001',
    title: 'the Code sandbox withholds URLSearchParams',
    signature: 'URLSearchParams is not defined',
    action: 'escalate',
    hint: "destructure it: const { URLSearchParams, URL } = require('url') — see R002b",
  },
  {
    id: 'R002b',
    title: 'a url symbol required but never bound',
    signature: '\\bURL is not defined',
    action: 'escalate',
    hint: "require('url') alone is not enough; the symbol must be destructured",
  },
  {
    id: 'R003',
    title: 'an enum column fed text from json_to_recordset',
    signature: 'is of type health_status but expression is of type text|invalid input value for enum',
    action: 'escalate',
    hint: 'cast the column reference: x.status::health_status',
  },
  {
    id: 'R005',
    title: 'module.exports survived into a Code node',
    signature: 'module is not defined|exports is not defined',
    action: 'escalate',
    hint: 'the export-stripping regex in build-workflows.js lost an escape',
  },
  {
    id: 'R007',
    title: 'getAllTranscripts called without meetingOrganizerUserId',
    signature: 'getAllTranscripts.*\\b400\\b|meetingOrganizerUserId',
    action: 'escalate',
    hint: 'it is a function parameter, not a filter — omitting it returns 400',
  },
  {
    id: 'R017',
    title: 'an object spread dropped the auth header',
    signature: '\\b401\\b.*(unauthorized|missing (authorization|header))',
    action: 'escalate',
    hint: 'spread opts first, apply headers last',
  },
  {
    id: 'R020',
    title: 'a binary response parsed as JSON',
    signature: 'Unexpected token .* in JSON|invalid json response body',
    action: 'escalate',
    hint: 'json: false for binary responses',
  },
  {
    id: 'R022',
    title: 'a require() the sandbox does not allow',
    signature: "Cannot find module '(\\w+)'|require is not (defined|allowed)",
    action: 'escalate',
    hint: 'NODE_FUNCTION_ALLOW_BUILTIN must list it, in the repo compose AND on the VPS',
  },
];

// Compiled once. A bad regex here would otherwise throw inside the match loop
// and take the whole healer down with it, so it fails loudly at load instead.
const COMPILED = RULES.map(r => {
  try {
    return Object.assign({}, r, { re: new RegExp(r.signature, 'i') });
  } catch (e) {
    throw new Error('heal-rules: ' + r.id + ' has an invalid signature: ' + e.message);
  }
});

/**
 * First matching rule, or null. Order matters: the actionable rules are listed
 * first so that a 403 carrying a stale-token message is treated as the token
 * problem rather than the consent problem.
 */
function classify(execution) {
  const text = [
    execution && execution.error,
    execution && execution.message,
    execution && execution.lastNodeExecuted,
  ].filter(Boolean).join(' \n ');
  if (!text.trim()) return null;

  for (const rule of COMPILED) {
    if (!rule.re.test(text)) continue;
    if (rule.workflow && execution.workflowName !== rule.workflow) continue;
    if (rule.node && execution.lastNodeExecuted !== rule.node) continue;
    return rule;
  }
  return null;
}

// The subset the healer is permitted to perform without asking. Kept separate
// from the rule list so that adding a rule can never, by itself, widen what the
// healer may do — that takes an edit here as well, which is a visible diff.
const AUTO_ACTIONS = new Set([
  'retry_execution',
  'reactivate_workflow',
  'redeploy_workflow',
  'restart_container',
  'refresh_graph_token',
  'flag_source_browser',
]);

module.exports = { RULES, COMPILED, classify, AUTO_ACTIONS };
