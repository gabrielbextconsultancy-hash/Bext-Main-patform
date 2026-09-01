/**
 * Where an approved post goes, and how.
 *
 * Adapted from sergebulaev/linkedin-skills (MIT), lib/backend_selector.py.
 *
 * Three backends, highest privilege first:
 *
 *   linkedin  LinkedIn's official API against the BEXT page. Real auto-post.
 *             Needs a developer app and a Community Management API review, so it
 *             is off until the client has been through that, weeks out.
 *   publora   the Publora REST API. Auto-post in two minutes of setup, free tier
 *             15 posts a month. Adds a third party that holds the LinkedIn token.
 *   manual    the default. Produces the finished text and hands it to a human to
 *             paste. Nothing third-party holds a credential, and it ships this
 *             week.
 *
 * The brief asks for manual publishing at launch anyway ("approve and manually
 * publish"), so `manual` is not a fallback here, it is the intended path. The
 * other two exist so that turning on auto-post later is one environment variable
 * and changes nothing upstream of the approval.
 *
 * This module decides the route and shapes the payload. It does not itself make
 * the HTTP call: the n8n node does, so the request shows up in the execution log
 * like every other outbound call. `plan()` returns what to do; the workflow does
 * it.
 *
 * Inlined into an n8n Code node by build-workflows.js, so no backticks and no
 * dollar-brace anywhere in this file.
 */

/**
 * Which backend is live, from the environment. `env` is passed in rather than
 * read from a global so the function is testable.
 */
var backend = function (env) {
  var e = env || {};
  var forced = (e.LINKEDIN_PUBLISH_MODE || '').toLowerCase();
  if (forced === 'manual' || forced === 'publora' || forced === 'linkedin') return forced;
  // No explicit mode: infer from what is configured, most privileged first.
  if (e.LINKEDIN_API_TOKEN && e.LINKEDIN_AUTHOR_URN) return 'linkedin';
  if (e.PUBLORA_API_KEY && e.LINKEDIN_PLATFORM_ID) return 'publora';
  return 'manual';
};

/**
 * Plan the publish of one approved draft.
 *
 * `draft` is { id, final_copy, body, destination_url, hashtags }. The text sent
 * is final_copy if a human wrote one, else the drafted body: the approval step
 * writes final_copy, so anything reaching here without one was approved unchanged.
 *
 * Returns one of:
 *   { mode: 'manual',  text, destination_url, message }         copy-paste block
 *   { mode: 'publora', request: {url, method, headers, body} }  the call to make
 *   { mode: 'linkedin', request: {...} }                        the call to make
 *
 * The workflow switches on `mode`: manual writes the Teams card and marks the row
 * published-by-hand-pending; the other two make `request` and record the result.
 */
var plan = function (draft, env) {
  var d = draft || {};
  var mode = backend(env);
  var text = assemble(d);

  if (mode === 'manual') {
    return {
      mode: 'manual',
      text: text,
      destination_url: d.destination_url || null,
      message: manualMessage(text, d.destination_url),
    };
  }

  if (mode === 'publora') {
    // Publora's real API (verified against sergebulaev/linkedin-skills
    // lib/publora_client.py, 2026-05): POST /create-post, auth via the
    // x-publora-key header, and `platforms` is a list of connection-id STRINGS
    // like "linkedin-xxx" — the older {platform, platformId} dict shape returns
    // HTTP 400 "Invalid platform ID format". Omitting scheduledTime posts now.
    return {
      mode: 'publora',
      request: {
        url: 'https://api.publora.com/api/v1/create-post',
        method: 'POST',
        headers: {
          'x-publora-key': env.PUBLORA_API_KEY || '',
          'Content-Type': 'application/json',
        },
        body: {
          content: text,
          platforms: [env.LINKEDIN_PLATFORM_ID],
        },
      },
    };
  }

  // linkedin: the official /rest/posts endpoint. The author URN says whether it
  // posts as a person or as the BEXT organisation.
  return {
    mode: 'linkedin',
    request: {
      url: 'https://api.linkedin.com/rest/posts',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (env.LINKEDIN_API_TOKEN || ''),
        'Content-Type': 'application/json',
        'LinkedIn-Version': env.LINKEDIN_API_VERSION || '202401',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: {
        author: env.LINKEDIN_AUTHOR_URN,
        commentary: text,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
    },
  };
};

/**
 * The text as it will appear on LinkedIn: the body, then the hashtags on their
 * own line at the end. The link is deliberately not appended, because it belongs
 * in the first comment, not the post. `destination_url` travels alongside so the
 * human (manual) or a follow-up call (auto) can drop it there.
 */
var assemble = function (draft) {
  var d = draft || {};
  var body = String(d.final_copy || d.body || '').trim();
  var tags = (d.hashtags || []).map(function (h) {
    return String(h).replace(/^#/, '').trim();
  }).filter(Boolean).slice(0, 2);
  if (tags.length) body += '\n\n' + tags.map(function (t) { return '#' + t; }).join(' ');
  return body;
};

var manualMessage = function (text, link) {
  var lines = [];
  lines.push('Ready to publish. Paste this as a new LinkedIn post:');
  lines.push('');
  lines.push(text);
  if (link) {
    lines.push('');
    lines.push('Then, as the first comment, drop the link:');
    lines.push(link);
  }
  lines.push('');
  lines.push('When it is up, paste the post URL back into the dashboard to close the loop.');
  return lines.join('\n');
};

module.exports = { backend: backend, plan: plan, assemble: assemble };
