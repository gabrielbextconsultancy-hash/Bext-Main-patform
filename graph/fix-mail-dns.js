#!/usr/bin/env node
/**
 * Repairs SPF and publishes DMARC for the address the daily report sends from.
 *
 *   node graph/fix-mail-dns.js            show current vs proposed, change nothing
 *   node graph/fix-mail-dns.js --apply    write the records
 *
 * Why this exists. The report has always sent — 409 successful runs — but arrives
 * in spam, because the SPF record for `bext` names none of the machines that
 * actually send it:
 *
 *   v=spf1 +a +mx +ip4:82.163.176.197 +ip4:185.2.168.24 ~all
 *
 *   +a   -> bext.dev-environment.site = 187.127.213.243, the Hostinger VPS
 *   +mx  -> `bext` has no MX record, so this matches nothing
 *   ip4  -> neither address is 185.2.168.30, which is what mail.dev-environment.site sends from
 *
 * Every mechanism misses. The parent domain was modernised at some point and this
 * subdomain was left on the old template, so the fix is to bring it into line.
 *
 * iFastNet routes outbound mail through MailChannels, so include:relay.mailchannels.net
 * is not optional — dropping it would break delivery even with the right IP.
 *
 * SAFETY. The zone dev-environment.site also hosts billing-agent, content.engine,
 * billsense and neuralyx.ai. mass_edit_zone rewrites by line index, so a careless
 * edit silently breaks someone else's mail. This touches `bext` and `_dmarc.bext`
 * and refuses everything else.
 */
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');

const HOST = 'cpanel.dev-environment.site';
const PORT = 2083;
const USER = process.env.CPANEL_USER || 'devenvir';
const ZONE = 'dev-environment.site';
const TOKEN = process.env.CPANEL_TOKEN;

const SPF_NAME = 'bext';
const DMARC_NAME = '_dmarc.bext';
// Mirrors the parent domain's working record. -a on the mail host rather than the
// bare +a, which resolves to the VPS and authorises the wrong machine.
const SPF_VALUE = 'v=spf1 +a:mail.dev-environment.site +ip4:185.2.168.30 +ip4:185.2.168.24 '
  + '+ip4:82.163.176.197 +include:relay.mailchannels.net +ip4:31.22.4.169 -all';
// p=none reports without asking anyone to reject. Tightening this before SPF is
// confirmed passing would make delivery worse, not better.
const DMARC_VALUE = 'v=DMARC1; p=none; rua=mailto:gabriel.bextconsultancy@gmail.com';

if (!TOKEN) {
  console.error('CPANEL_TOKEN missing from .env — see docs/INFRASTRUCTURE.md');
  process.exit(1);
}

const call = (pathname, body) => new Promise((resolve, reject) => {
  const payload = body ? new URLSearchParams(body).toString() : null;
  const req = https.request({
    host: HOST, port: PORT, path: pathname, method: body ? 'POST' : 'GET',
    rejectUnauthorized: false, timeout: 30000,
    headers: {
      Authorization: `cpanel ${USER}:${TOKEN}`,
      ...(payload ? {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      } : {}),
    },
  }, r => {
    let b = '';
    r.on('data', d => { b += d; });
    r.on('end', () => {
      try { resolve(JSON.parse(b)); }
      catch { reject(new Error(`HTTP ${r.statusCode}: ${b.slice(0, 200)}`)); }
    });
  });
  req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

const d64 = b => Buffer.from(b, 'base64').toString();
const e64 = s => Buffer.from(s, 'utf8').toString('base64');

(async () => {
  const zone = await call(`/execute/DNS/parse_zone?zone=${encodeURIComponent(ZONE)}`);
  if (!zone.status) throw new Error(JSON.stringify(zone.errors || zone).slice(0, 200));

  const rows = (zone.data || []).map(d => ({
    index: d.line_index,
    type: d.type,
    name: d.dname_b64 ? d64(d.dname_b64) : '',
    rtype: d.record_type,
    ttl: d.ttl,
    data: (d.data_b64 || []).map(d64),
  }));

  // The serial guards against a concurrent edit: cPanel rejects a stale one, which
  // is the behaviour we want rather than clobbering someone else's change.
  const soa = rows.find(r => r.rtype === 'SOA');
  const serial = soa ? soa.data[2] : null;

  const spf = rows.find(r => r.rtype === 'TXT' && r.name === SPF_NAME);
  const dmarc = rows.find(r => r.rtype === 'TXT' && r.name === DMARC_NAME);

  console.log(`zone ${ZONE}  ·  ${rows.length} records  ·  serial ${serial}\n`);

  console.log(`SPF   ${SPF_NAME}`);
  console.log(`  now      ${spf ? spf.data.join('') : '(missing)'}`);
  console.log(`  proposed ${SPF_VALUE}`);
  const spfSame = spf && spf.data.join('') === SPF_VALUE;
  console.log(`  ${spfSame ? 'already correct' : 'WILL CHANGE'}\n`);

  console.log(`DMARC ${DMARC_NAME}`);
  console.log(`  now      ${dmarc ? dmarc.data.join('') : '(missing)'}`);
  console.log(`  proposed ${DMARC_VALUE}`);
  const dmarcSame = dmarc && dmarc.data.join('') === DMARC_VALUE;
  console.log(`  ${dmarcSame ? 'already correct' : dmarc ? 'WILL CHANGE' : 'WILL ADD'}\n`);

  // Named so a reader can see what is deliberately left alone.
  const others = rows.filter(r => r.rtype === 'TXT'
    && /spf|dmarc/i.test(r.data.join(''))
    && r.name !== SPF_NAME && r.name !== DMARC_NAME);
  console.log(`untouched in this zone: ${others.map(o => o.name).join(', ') || '(none)'}`);

  if (!APPLY) {
    console.log('\n--check only. Nothing was changed. Re-run with --apply to write.');
    return;
  }
  if (spfSame && dmarcSame) { console.log('\nNothing to do.'); return; }
  if (!spf) throw new Error(`No TXT record named "${SPF_NAME}" — refusing to guess where it goes.`);

  const edits = [];
  if (!spfSame) {
    edits.push({
      line_index: spf.index, dname: SPF_NAME, ttl: spf.ttl || 14400,
      record_type: 'TXT', data: [SPF_VALUE],
    });
  }

  console.log('');
  for (const e of edits) {
    const r = await call('/execute/DNS/mass_edit_zone', {
      zone: ZONE, serial,
      edit: JSON.stringify({
        line_index: e.line_index, dname: e.dname, ttl: e.ttl,
        record_type: e.record_type, data: e.data,
      }),
    });
    console.log(`edit ${e.dname}: ${r.status ? 'ok' : 'FAILED ' + JSON.stringify(r.errors).slice(0, 200)}`);
    if (!r.status) process.exitCode = 1;
  }

  if (!dmarcSame) {
    // Edit when the record is already there, add only when it is genuinely absent.
    // Adding unconditionally publishes two DMARC records for one name, which
    // resolvers treat as no policy at all — worse than the single record we started
    // with. _dmarc.bext already exists here as "v=DMARC1; p=none;".
    const body = dmarc
      ? {
        zone: ZONE, serial,
        edit: JSON.stringify({
          line_index: dmarc.index, dname: DMARC_NAME, ttl: dmarc.ttl || 14400,
          record_type: 'TXT', data: [DMARC_VALUE],
        }),
      }
      : {
        zone: ZONE, serial,
        add: JSON.stringify({
          dname: DMARC_NAME, ttl: 14400, record_type: 'TXT',
          data: [DMARC_VALUE],
        }),
      };
    const r = await call('/execute/DNS/mass_edit_zone', body);
    console.log(`${dmarc ? 'edit' : 'add'} ${DMARC_NAME}: `
      + (r.status ? 'ok' : 'FAILED ' + JSON.stringify(r.errors).slice(0, 200)));
    if (!r.status) process.exitCode = 1;
  }

  console.log('\nDNS caches take a few minutes. Verify the record, then send a real');
  console.log('report and read the headers for spf=pass — the record alone is not proof.');
})().catch(e => { console.error('FAILED:', e.message.slice(0, 300)); process.exitCode = 1; });
