#!/usr/bin/env node
/**
 * Point the bext subdomain's mail at the server that actually holds its mailbox.
 *
 * THE FAULT. bext.dev-environment.site has an MX pointing at itself, and its A
 * record is 187.127.213.243 — the Hostinger VPS running n8n, Postgres and Qdrant.
 * That box runs no mail server and never has. So mail addressed to
 * reports@bext.dev-environment.site is delivered to a host that cannot accept it,
 * and nothing ever arrives. Outbound was unaffected, which is why this went
 * unnoticed: the daily report sends through SMTP directly and lands fine.
 *
 * The mailbox itself is real and lives on iFastNet at 185.2.168.30, alongside the
 * parent domain's mail. The parent resolves its own MX to dev-environment.site;
 * the subdomain simply inherited an A-record-shaped default when bext was pointed
 * at the VPS for the dashboard.
 *
 * THE FIX. One record: MX for `bext` becomes dev-environment.site, priority 0,
 * matching how mail.dev-environment.site is already configured.
 *
 * SAFETY. The zone also hosts billing-agent, content.engine, billsense and
 * neuralyx.ai. mass_edit_zone rewrites by line index, so this refuses to touch
 * any line whose name is not exactly `bext`, and sends the serial it read so a
 * concurrent edit is rejected rather than silently overwritten.
 *
 *   node graph/fix-mail-mx.js            print the diff, change nothing
 *   node graph/fix-mail-mx.js --apply    perform the edit
 */
'use strict';
require('dotenv').config();

const ZONE = 'dev-environment.site';
const NAME = 'bext';                       // the record to change, and the only one
const TARGET = 'dev-environment.site.';    // where the mail actually lives
const PRIORITY = 0;

const HOST = 'cpanel.dev-environment.site';
const USER = 'devenvir';
const TOKEN = process.env.CPANEL_TOKEN;
const APPLY = process.argv.includes('--apply');

const call = async (path, body) => {
  const url = `https://${HOST}:2083${path}`;
  const init = { headers: { Authorization: `cpanel ${USER}:${TOKEN}` } };
  if (body) {
    init.method = 'POST';
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(body).toString();
  }
  const r = await fetch(url, init);
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`${r.status} ${text.slice(0, 200)}`); }
};

const api2 = async (mod, fn, params = {}) => {
  const qs = new URLSearchParams({
    cpanel_jsonapi_module: mod, cpanel_jsonapi_func: fn, cpanel_jsonapi_apiversion: '2', ...params,
  }).toString();
  return call('/json-api/cpanel?' + qs);
};

/**
 * The second half of the fault, and the half DNS alone does not fix.
 *
 * Correcting the MX is not enough: Exim keeps its own view of which domains it
 * accepts locally. With the subdomain on "auto" routing, that view was decided
 * while the MX still pointed at the VPS — a remote host — so Exim recorded
 * alwaysaccept=0 and answers
 *
 *   550 Relay not permitted - domain bext.dev-environment.site is not a local domain
 *
 * even though cPanel lists the domain as a mail domain and now detects it as
 * local. Pinning the routing to "local" re-applies that decision.
 *
 * Scoped to the bext subdomain: the parent and the other tenants in this account
 * keep their own routing untouched.
 */
async function fixRouting() {
  const before = await api2('Email', 'listmxs', { domain: `${NAME}.${ZONE}` });
  const row = before?.cpanelresult?.data?.[0];
  if (!row) { console.log('\nCould not read mail routing — check it in cPanel > Email Routing.'); return; }

  console.log(`\nmail routing for ${NAME}.${ZONE}`);
  console.log(`  mxcheck      ${row.mxcheck}   (detected: ${row.detected})`);
  console.log(`  alwaysaccept ${row.alwaysaccept}`);

  if (String(row.alwaysaccept) === '1' && row.mxcheck === 'local') {
    console.log('  already accepting mail locally — nothing to do.');
    return;
  }
  if (!APPLY) { console.log('  would set mxcheck=local. Re-run with --apply.'); return; }

  const r = await api2('Email', 'setalwaysaccept', { domain: `${NAME}.${ZONE}`, mxcheck: 'local' });
  const err = r?.cpanelresult?.error || r?.cpanelresult?.data?.[0]?.statusmsg;
  console.log('  set mxcheck=local -> ' + (r?.cpanelresult?.event?.result === 1 ? 'ok' : JSON.stringify(err || r).slice(0, 200)));

  const after = await api2('Email', 'listmxs', { domain: `${NAME}.${ZONE}` });
  const a = after?.cpanelresult?.data?.[0];
  if (a) console.log(`  now: mxcheck=${a.mxcheck} alwaysaccept=${a.alwaysaccept}`);
  console.log('\nProve delivery rather than assuming it: node graph/verify-inbound-mail.js');
}

(async () => {
  if (!TOKEN) { console.error('CPANEL_TOKEN missing from .env'); process.exit(1); }

  const zone = await call(`/execute/DNS/parse_zone?zone=${encodeURIComponent(ZONE)}`);
  if (!zone?.data) { console.error('parse_zone failed: ' + JSON.stringify(zone).slice(0, 300)); process.exit(1); }

  const dec = (v) => Buffer.from(String(v), 'base64').toString('utf8');
  const rows = zone.data
    .filter(d => d.type === 'record')
    .map(d => ({
      index: d.line_index,
      ttl: d.ttl,
      name: d.dname_b64 ? dec(d.dname_b64) : d.dname,
      rtype: d.record_type,
      data: (d.data_b64 || []).map(dec),
    }));

  const soa = rows.find(r => r.rtype === 'SOA');
  const serial = soa ? soa.data[2] : null;
  console.log(`zone ${ZONE}  ·  ${rows.length} records  ·  serial ${serial}\n`);

  const mx = rows.find(r => r.rtype === 'MX' && r.name === NAME);
  if (!mx) {
    console.error(`No MX record named "${NAME}" in the zone. Refusing to guess — inspect the zone by hand.`);
    process.exit(1);
  }
  // Belt and braces: the line index is what gets rewritten, so re-check the name
  // on the exact line we are about to touch.
  if (mx.name !== NAME) {
    console.error(`Line ${mx.index} is "${mx.name}", not "${NAME}". Aborting.`);
    process.exit(1);
  }

  console.log(`MX  ${NAME}   (line ${mx.index})`);
  console.log(`  now      ${mx.data.join(' ')}`);
  console.log(`  proposed ${PRIORITY} ${TARGET}`);
  console.log('\n  Mail for this subdomain currently routes to the VPS, which runs no');
  console.log('  mail server. The mailbox is on iFastNet with the parent domain.\n');

  if (mx.data.join(' ') === `${PRIORITY} ${TARGET}`) {
    console.log('MX already correct.');
    await fixRouting();
    return;
  }

  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to make this change.');
    return;
  }

  const r = await call('/execute/DNS/mass_edit_zone', {
    zone: ZONE,
    serial,
    edit: JSON.stringify({
      line_index: mx.index,
      dname: NAME,
      ttl: mx.ttl || 14400,
      record_type: 'MX',
      data: [String(PRIORITY), TARGET],
    }),
  });

  if (r?.errors?.length) {
    console.error('edit FAILED ' + JSON.stringify(r.errors));
    process.exit(1);
  }
  console.log('edit ok — allow up to the TTL for resolvers to pick it up.');
  await fixRouting();
})().catch(e => { console.error('FAILED ' + e.message); process.exit(1); });
