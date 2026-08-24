#!/usr/bin/env node
/**
 * Create and reconcile the BEXT Uptime Kuma monitors, over the Socket.io API.
 *
 *   node n8n/kuma-setup.js            list current monitors + show the plan (no writes)
 *   node n8n/kuma-setup.js --apply    create the monitors that are missing
 *   node n8n/kuma-setup.js --tokens   print KUMA_PUSH_* lines for the push monitors
 *
 * ── why Socket.io and not the API key ───────────────────────────────────────
 *
 * Kuma has two auth planes. The API key (KUMA_API_KEY) unlocks the read-only
 * /metrics endpoint and nothing else — that is what Prometheus scrapes. Creating
 * or editing a monitor is only possible over the Socket.io interface, which
 * authenticates with the admin login (KUMA_USER / KUMA_PASS). There is no REST
 * monitor API; anyone who tells you otherwise is looking at the SPA returning its
 * own HTML for an unknown path.
 *
 * Idempotent. Matches on monitor name, creates only what is missing, never edits
 * or deletes — reconfiguring or removing a monitor stays a human decision in the
 * UI. Safe to run repeatedly.
 *
 * The monitor set mirrors docs/SELF-HEALING.md § Monitors. Keep them in step.
 */
const path = require('path');
const crypto = require('crypto');
const { io } = require('socket.io-client');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Kuma push tokens are alphanumeric; 32 chars matches what the UI mints.
const pushToken = () => crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);

const URL = process.env.KUMA_URL;
const USER = process.env.KUMA_USER;
const PASS = process.env.KUMA_PASS;
const APPLY = process.argv.includes('--apply');
const TOKENS = process.argv.includes('--tokens');

if (!URL) { console.error('KUMA_URL not set in .env'); process.exit(1); }
if (!USER || !PASS) {
  console.error('KUMA_USER / KUMA_PASS not set in .env — monitor management needs the admin login.');
  console.error('(The API key only unlocks /metrics; it cannot create monitors.)');
  process.exit(1);
}

// The BEXT monitor set. `env` on a push monitor names the .env key its token
// belongs in. Intervals are seconds; push `interval` is the deadman window.
const MONITORS = [
  // Public HTTPS — cert expiry is watched automatically on these.
  { type: 'http', name: 'n8n',            url: 'https://bext-n8n.srv1866850.hstgr.cloud/healthz', interval: 60 },
  { type: 'http', name: 'dashboard',      url: 'https://bext.dev-environment.site',               interval: 60 },
  { type: 'http', name: 'proposal deck',  url: 'https://bext.dev-environment.site/proposal',      interval: 300 },

  // Internal — Kuma is on bext_internal, so service names resolve.
  { type: 'http', name: 'fetcher',   url: 'http://fetcher:8080/health',    interval: 60 },
  { type: 'http', name: 'scrapling', url: 'http://scrapling:8090/health',  interval: 60 },
  { type: 'http', name: 'api',       url: 'http://api:8090/health',        interval: 60 },
  { type: 'http', name: 'qdrant',    url: 'http://qdrant:6333/healthz',    interval: 300 },
  { type: 'http', name: 'ollama',    url: 'http://ollama:11434/api/tags',  interval: 300 },
  { type: 'port', name: 'postgres',  hostname: 'postgres', port: 5432,     interval: 60 },

  // DNS — the daily report failed SPF for weeks while reporting up. The domain
  // is bext.dev-environment.site (graph/health-check.js MAIL_DOMAIN), NOT the
  // bextconsultancy.com.au tenant — the report sends from reports@bext...; the
  // tenant has no DMARC record and monitoring it reads as a false outage.
  { type: 'dns', name: 'mail SPF',   hostname: 'bext.dev-environment.site',                  dns_resolve_type: 'TXT', interval: 3600 },
  { type: 'dns', name: 'mail DMARC', hostname: '_dmarc.bext.dev-environment.site',            dns_resolve_type: 'TXT', interval: 3600 },
  { type: 'dns', name: 'mail DKIM',  hostname: 'default._domainkey.bext.dev-environment.site', dns_resolve_type: 'TXT', interval: 3600 },

  // Push deadmen — window = workflow cadence + one missed run.
  { type: 'push', name: 'wf source-ingest',    interval: 5400,  env: 'KUMA_PUSH_SOURCE_INGEST' },
  { type: 'push', name: 'wf article-analysis', interval: 2700,  env: 'KUMA_PUSH_ARTICLE_ANALYSIS' },
  { type: 'push', name: 'wf meeting-intake',   interval: 1500,  env: 'KUMA_PUSH_MEETING_INTAKE' },
  { type: 'push', name: 'wf self-heal',        interval: 1500,  env: 'KUMA_PUSH_SELF_HEAL' },
  { type: 'push', name: 'wf daily-report',     interval: 93600, env: 'KUMA_PUSH_DAILY_REPORT' },
  { type: 'push', name: 'wf daily-news-card',  interval: 93600, env: 'KUMA_PUSH_DAILY_NEWS_CARD' },
  { type: 'push', name: 'wf graph-health',     interval: 93600, env: 'KUMA_PUSH_GRAPH_HEALTH' },
  { type: 'push', name: 'wf contract-test',    interval: 93600, env: 'KUMA_PUSH_CONTRACT_TEST' },
];

const socket = io(URL, { transports: ['websocket'], reconnection: false, timeout: 15000 });
const emit = (ev, ...args) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${ev} timed out`)), 15000);
  socket.emit(ev, ...args, r => { clearTimeout(t); (r && r.ok === false) ? rej(new Error(r.msg || ev + ' failed')) : res(r); });
});

// Kuma pushes the full monitor list as a broadcast after login, not as an ack.
let monitorList = {};
socket.on('monitorList', l => { monitorList = l || {}; });

async function main() {
  await new Promise((res, rej) => {
    socket.on('connect', res);
    socket.on('connect_error', e => rej(new Error('cannot reach Kuma: ' + e.message)));
    setTimeout(() => rej(new Error('connect timed out')), 15000);
  });

  await emit('login', { username: USER, password: PASS, token: '' });
  // Give the monitorList broadcast a moment to land.
  await new Promise(r => setTimeout(r, 1500));

  const existing = new Map(Object.values(monitorList).map(m => [m.name, m]));
  console.log(`Connected. ${existing.size} monitor(s) exist.\n`);

  const missing = MONITORS.filter(m => !existing.has(m.name));
  if (TOKENS) { printTokens(existing); return; }

  for (const m of MONITORS) {
    const have = existing.has(m.name);
    console.log(`  ${have ? 'have' : (APPLY ? 'ADD ' : 'will add')}  ${m.type.padEnd(5)} ${m.name}`);
  }

  if (!APPLY) {
    console.log(`\n${missing.length} to create. Re-run with --apply to write them, then --tokens for the push keys.`);
    return;
  }

  for (const m of missing) {
    const body = buildMonitor(m);
    try {
      await emit('add', body);
      console.log(`  added ${m.name}`);
    } catch (e) {
      console.log(`  FAILED ${m.name}: ${e.message}`);
    }
  }
  // Re-read so the push tokens Kuma just minted are available.
  await new Promise(r => setTimeout(r, 1500));
  const after = new Map(Object.values(monitorList).map(m => [m.name, m]));
  console.log('');
  printTokens(after);
}

function buildMonitor(m) {
  // Two version-specific quirks, learned the hard way against this 1.x image:
  //   - accepted_statuscodes must be present on EVERY type, not just http: the
  //     add handler runs .every() over it and throws "reading 'every'" if absent.
  //   - `conditions` must NOT be sent: it is a newer-Kuma column this image's
  //     monitor table does not have, and including it fails the INSERT.
  const base = { name: m.name, type: m.type, interval: m.interval || 60,
    retryInterval: 60, maxretries: 2, upsideDown: false, notificationIDList: {},
    accepted_statuscodes: ['200-299', '302'] };
  if (m.type === 'http') return { ...base, url: m.url, method: 'GET' };
  if (m.type === 'port') return { ...base, hostname: m.hostname, port: m.port };
  if (m.type === 'dns') return { ...base, hostname: m.hostname, dns_resolve_server: '1.1.1.1', dns_resolve_type: m.dns_resolve_type || 'A', port: 53 };
  // The server does NOT mint a push token on add — the UI generates one
  // client-side and sends it. Omit it and the monitor is created with an empty
  // token and no usable push URL. So we generate it here.
  if (m.type === 'push') return { ...base, retryInterval: m.interval, maxretries: 0, pushToken: pushToken() };
  throw new Error('unknown monitor type ' + m.type);
}

function printTokens(existing) {
  console.log('# Push tokens — paste into .env AND /docker/bext/.env, then rebuild workflows:');
  for (const m of MONITORS.filter(x => x.type === 'push')) {
    const found = existing.get(m.name);
    const tok = found && found.pushToken;
    console.log(`${m.env}=${tok || '(create it first with --apply)'}`);
  }
}

main()
  .then(() => { socket.close(); process.exit(0); })
  .catch(e => { console.error('\n' + e.message); socket.close(); process.exit(1); });
