require('dotenv').config();
const { Client } = require('pg');
const wf = require('./n8n/workflows/BEXT-Daily-News-6-Teams-Card.json');
const node = (n) => wf.nodes.find(x => x.name === n);
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const DRY = process.argv.includes('--dry');

(async () => {
  const c = new Client({host:process.env.PG_HOST,port:+process.env.PG_PORT,database:process.env.PG_DB,user:process.env.PG_USER,password:process.env.PG_PASSWORD});
  await c.connect();
  const rows = (await c.query(node('Load the day').parameters.query)).rows;
  console.log('card would cover: sent ' + rows[0].report_date + ', covering ' + rows[0].covers + ' (' + rows.length + ' rows)');

  const build = new AsyncFn('$input', '$env', 'require', node('Build card and list').parameters.jsCode);
  const built = (await build({ all: () => rows.map(j => ({ json: j })), first: () => ({ json: rows[0] }) }, process.env, require))[0].json;
  console.log('card built: ' + Object.keys(built).join(', ').slice(0, 120));

  if (DRY) { console.log('--dry: not posted'); await c.end(); return; }
  const post = new AsyncFn('$input', '$env', 'require', node('Post to Teams').parameters.jsCode);
  const out = (await post.call(
    { helpers: { httpRequest: async (o) => {
        const r = await fetch(o.url, { method: o.method || 'POST', headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: JSON.stringify(o.body) });
        const t = await r.text();
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120));
        return t;
      } } },
    { all: () => [{ json: built }], first: () => ({ json: built }) }, process.env, require))[0].json;
  console.log('post result: ' + JSON.stringify(out).slice(0, 200));
  await c.end();
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
