#!/usr/bin/env node
/**
 * Creates `BEXT — Channel Post Bridge`, the Power Automate flow that turns an
 * HTTPS POST into an Adaptive Card in the Teams channel.
 *
 *   node graph/create-channel-flow.js --dry      print the definition, create nothing
 *   node graph/create-channel-flow.js            create it, then store the trigger URL
 *   node graph/create-channel-flow.js --url      re-read the URL of the existing flow
 *
 * This exists because Graph publishes no application permission for posting a
 * channel message. docs/TEAMS-WEBHOOK-SETUP.md describes doing the same thing by
 * hand in the Teams UI; this is that, reproducible and committable.
 *
 * Authentication rides on the user's own `az login` — the Power Platform APIs do
 * not accept our app-only client credentials. Whoever `az` is signed in as OWNS
 * the resulting flow permanently, so the script refuses to run as anyone else.
 *
 * Run `node graph/discover-power-platform.js` first. It must print GO.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DRY = process.argv.includes('--dry');
const URL_ONLY = process.argv.includes('--url');
// A UI-authored flow keeps the template's own name. --name points this at it so the
// URL can still be captured without renaming anything in the portal.
const nameIdx = process.argv.indexOf('--name');
const NAME_OVERRIDE = nameIdx > -1 ? process.argv[nameIdx + 1] : null;
// The flows list endpoint is eventually consistent — the same flow appeared and
// disappeared between two calls a second apart. --id skips the lookup entirely.
const idIdx = process.argv.indexOf('--id');
const ID_OVERRIDE = idIdx > -1 ? process.argv[idIdx + 1] : null;

const ENV = 'Default-9eb458d1-317d-4aae-a9a3-bb68e430d701';
const OWNER = 'Admin.bext-automation@bextconsultancy.com.au';
const FLOW_NAME = 'BEXT — Meeting Report';

/**
 * Which .env variable and export file belong to which flow.
 *
 * This script writes the trigger URL into a variable and the definition into a
 * file, and both used to be fixed at the meeting flow's. Pointing it at another
 * flow with --id therefore repointed TEAMS_MEETING_WEBHOOK_URL at that flow's
 * channel and overwrote the meeting flow's export — silently, because the URL is
 * never printed. Reading the Daily report flow's URL on 23 Aug 2026 did exactly
 * that, and meeting announcements would have started appearing in the wrong
 * channel with nothing to indicate why.
 *
 * A flow id now selects its own destination, and an unrecognised one refuses to
 * write anywhere rather than defaulting to the meeting flow's slot.
 */
const FLOW_TARGETS = {
  'd6efce28-c2c4-89a1-386d-3bd4f71c63a0': {
    label: 'BEXT — Meeting Report',
    envKey: 'TEAMS_MEETING_WEBHOOK_URL',
    file: 'BEXT-Meeting-Report.json',
  },
  '77d08f87-08c9-836a-60ef-3e1aab126aaa': {
    label: 'Send webhook alerts to Daily report',
    envKey: 'TEAMS_DAILY_WEBHOOK_URL',
    file: 'BEXT-Daily-Report-Card.json',
  },
};

// Discovered from the tenant's existing SharePoint→Teams flow, which already posts
// into this channel — so the connection is known good rather than assumed.
const TEAMS_CONN = 'shared-teams-1381069787544875a2bbda2eda56a5f4';
const GROUP_ID = '36840697-dbe5-4294-994d-7a043eef51ca';        // team bext_transcripts records
const CHANNEL_ID = '19:R7FciH4QRVZU7_7EVUg3CH_zCmSIHOoVxrRAM_nFeBA1@thread.tacv2'; // Bext Transcripts

const PS = 'https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple';
// Resolved from the flow being read, not assumed.
const TARGET = ID_OVERRIDE ? FLOW_TARGETS[ID_OVERRIDE] : FLOW_TARGETS['d6efce28-c2c4-89a1-386d-3bd4f71c63a0'];
if (ID_OVERRIDE && !TARGET) {
  console.error(`Flow ${ID_OVERRIDE} has no destination registered in FLOW_TARGETS.`);
  console.error('Add one before running: writing its URL into another flow\'s variable would');
  console.error('repoint that flow at the wrong channel, and the URL is never printed to catch it.');
  process.exit(1);
}
const ENV_KEY = TARGET.envKey;
const ENV_FILE = path.join(__dirname, '..', '.env');
const FLOW_FILE = path.join(__dirname, '..', 'flows', TARGET.file);

// az ships as az.cmd on Windows, which Node refuses to execFile since the
// argument-injection hardening. cmd.exe with each argument quoted works on both.
const az = args => {
  const win = process.platform === 'win32';
  const quote = s => (/[\s&?^|<>()"]/.test(s) ? `"${s}"` : s);
  return execFileSync(
    win ? 'cmd.exe' : 'az',
    win ? ['/d', '/s', '/c', ['az', ...args].map(quote).join(' ')] : args,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
};
const token = res => az(['account', 'get-access-token', '--resource', res,
  '--query', 'accessToken', '-o', 'tsv']).trim();

/**
 * The trigger accepts the same envelope an Office 365 connector webhook takes —
 * `{type, attachments:[{contentType, content}]}` — so n8n/lib/meeting-card.js needs
 * no change and docs/TEAMS-WEBHOOK-SETUP.md stays true to what was built. The flow
 * unwraps it and hands the bare Adaptive Card to the Teams connector.
 */
const definition = {
  $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
  contentVersion: '1.0.0.0',
  parameters: {
    $connections: { defaultValue: {}, type: 'Object' },
    $authentication: { defaultValue: {}, type: 'SecureObject' },
  },
  triggers: {
    manual: {
      type: 'Request',
      kind: 'TeamsWebhook',
      inputs: {
        schema: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            attachments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  contentType: { type: 'string' },
                  content: { type: 'object' },
                },
              },
            },
          },
        },
        // Anonymous mints a self-signing URL. Tenant auth was tried first and
        // rejected our app-only token with MisMatchingOAuthClaims — the audience
        // Entra issues lacks the trailing slash the policy demands.
        triggerAuthenticationType: 'Anonymous',
      },
    },
  },
  actions: {
    Post_card_in_a_chat_or_channel: {
      runAfter: {},
      type: 'OpenApiConnection',
      inputs: {
        host: {
          apiId: '/providers/Microsoft.PowerApps/apis/shared_teams',
          connectionName: 'shared_teams',
          operationId: 'PostCardToConversation',
        },
        parameters: {
          poster: 'Flow bot',
          location: 'Channel',
          'body/recipient/groupId': GROUP_ID,
          'body/recipient/channelId': CHANNEL_ID,
          // The leading @ is load-bearing: without it Power Automate stores a
          // literal string and the channel gets the expression text, not a card.
          'body/messageBody': "@triggerBody()?['attachments'][0]['content']",
        },
      },
    },
  },
};

const connectionReferences = {
  shared_teams: {
    connectionName: TEAMS_CONN,
    source: 'Embedded',
    id: '/providers/Microsoft.PowerApps/apis/shared_teams',
    displayName: 'Microsoft Teams',
    tier: 'Standard',
    apiName: 'teams',
  },
};

const writeEnv = url => {
  let txt = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const line = `${ENV_KEY}=${url}`;
  txt = new RegExp(`^${ENV_KEY}=.*$`, 'm').test(txt)
    ? txt.replace(new RegExp(`^${ENV_KEY}=.*$`, 'm'), line)
    : txt.replace(/\s*$/, '\n') + `\n# Teams channel announcement — see docs/TEAMS-WEBHOOK-SETUP.md\n${line}\n`;
  fs.writeFileSync(ENV_FILE, txt);
};

(async () => {
  // ── who owns this ─────────────────────────────────────────────────────────
  let acct;
  try { acct = JSON.parse(az(['account', 'show', '-o', 'json'])); }
  catch { console.error('Not signed in to az.'); console.error(`  az login --tenant 9eb458d1-317d-4aae-a9a3-bb68e430d701 --allow-no-subscriptions`); process.exit(1); }
  const who = acct.user?.name;
  console.log(`az signed in as: ${who}`);
  if (!URL_ONLY && !DRY && String(who).toLowerCase() !== OWNER.toLowerCase()) {
    console.error(`\nRefusing to create. The flow owner is permanent and posts carry their name.`);
    console.error(`  expected ${OWNER}`);
    process.exit(1);
  }

  const H = { Authorization: `Bearer ${token('https://service.flow.microsoft.com/')}`, 'Content-Type': 'application/json' };

  // ── never create a second one ─────────────────────────────────────────────
  // --id skips the lookup. The flows list is eventually consistent: the same flow
  // was present, absent and present again across three calls seconds apart, so a
  // name match is not evidence of absence.
  const wanted = NAME_OVERRIDE || FLOW_NAME;
  let existing = ID_OVERRIDE ? { name: ID_OVERRIDE } : null;
  let all = [];
  if (!existing) {
    const list = await (await fetch(`${PS}/environments/${ENV}/flows?api-version=2016-11-01`, { headers: H })).json();
    all = list.value || [];
    existing = all.find(f => f.properties?.displayName === wanted) || null;
  }

  if (URL_ONLY && !existing) {
    console.log(`\nNo flow named "${wanted}". Flows in this environment:`);
    all.forEach(f => console.log(`  · ${f.properties?.displayName}   [${f.properties?.state}]`));
    console.log('\nPass the exact name:  node graph/create-channel-flow.js --url --name "<name>"');
    console.log('Or, if the list looks wrong, match by id — it is eventually consistent:');
    console.log('                      node graph/create-channel-flow.js --url --id <flowId>');
    process.exit(1);
  }

  if (DRY) {
    console.log(`\nexisting flow: ${existing ? existing.name : 'none'}`);
    console.log('\n' + JSON.stringify({ properties: { displayName: FLOW_NAME, definition, connectionReferences } }, null, 2));
    console.log('\n--dry: nothing created.');
    return;
  }

  let id = existing?.name;
  if (existing && !URL_ONLY) {
    // Recreating would mint a different URL and silently break .env and the VPS.
    console.log(`\n"${FLOW_NAME}" already exists (${id}) — not recreating. Re-reading its URL.`);
  } else if (!existing) {
    // POST to the collection, not PUT to an id — the service mints the flow name
    // itself and PUT against a not-yet-existing flow answers 404.
    const r = await fetch(`${PS}/environments/${ENV}/flows?api-version=2016-11-01`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ properties: { displayName: FLOW_NAME, state: 'Started', definition, connectionReferences } }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`\ncreate FAILED ${r.status}`);
      console.error(JSON.stringify(body.error || body, null, 2).slice(0, 800));
      process.exit(1);
    }
    id = body.name;
    console.log(`\ncreated  ${FLOW_NAME}  (${id})  state=${body.properties?.state}`);
  }

  // ── the trigger URL ───────────────────────────────────────────────────────
  const cb = await fetch(`${PS}/environments/${ENV}/flows/${id}/triggers/manual/listCallbackUrl?api-version=2016-11-01`,
    { method: 'POST', headers: H });
  const cbj = await cb.json().catch(() => ({}));
  // Two shapes in the wild: {value} on older flows, {response:{value, basePath,
  // queries}} on the powerplatform.com endpoint. The queries carry the signature,
  // so basePath alone is useless — rebuild from them when value lacks a sig.
  const r0 = cbj.response || cbj;
  let url = r0.value || '';
  if (url && !/[?&]sig=/.test(url) && r0.queries) {
    const u = new URL(r0.basePath || url);
    for (const [k, v] of Object.entries(r0.queries)) u.searchParams.set(k, v);
    url = u.toString();
  }
  if (!cb.ok || !url) {
    // Deliberately not echoing the body — it contains the signed URL.
    console.error(`\ncould not read the trigger URL: HTTP ${cb.status}, keys=${Object.keys(cbj).join(',')}`);
    process.exit(1);
  }
  // No ?sig= means the trigger is tenant-restricted rather than openly signed. That
  // is the safer arrangement, not a fault: the URL alone is useless, and the caller
  // presents an app-only token instead. run-meeting-once.js decides which to do by
  // inspecting the URL, so nothing else needs configuring.
  const signed = /[?&]sig=/.test(url);
  console.log(signed
    ? '  trigger auth: signed URL (the URL is the secret)'
    : '  trigger auth: tenant-restricted — callers must present a bearer token');

  // Deliberately not printed. The URL carries its own signature — anyone holding
  // it can post into the channel without signing in.
  writeEnv(url);
  console.log(`\ntrigger URL written to .env as ${ENV_KEY} (${url.length} chars, not shown)`);

  // ── committable definition, redacted ──────────────────────────────────────
  fs.mkdirSync(path.dirname(FLOW_FILE), { recursive: true });
  fs.writeFileSync(FLOW_FILE, JSON.stringify({
    _comment: `Source of truth for "${FLOW_NAME}". The live trigger URL is a secret and lives only in .env as ${ENV_KEY}.`,
    environment: ENV,
    flowId: id,
    properties: {
      displayName: FLOW_NAME,
      state: 'Started',
      definition,
      connectionReferences: { shared_teams: { ...connectionReferences.shared_teams, connectionName: '<redacted>' } },
    },
    triggerUrl: '<redacted>',
  }, null, 2) + '\n');
  console.log(`definition exported to ${path.relative(process.cwd(), FLOW_FILE)} (redacted)`);

  console.log('\nNext: smoke-test the envelope before trusting it.');
})().catch(e => { console.error('\nFAILED:', String(e.stderr || e.message).slice(0, 500)); process.exitCode = 1; });
