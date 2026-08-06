/**
 * Read-only query API.
 *
 * The dashboard runs on iFastNet cPanel; Postgres runs on the Hostinger VPS bound
 * to loopback. There is no network path between them, so every "live DB" page was
 * showing "Database unreachable" in production while working locally over the SSH
 * tunnel.
 *
 * Rather than expose Postgres to the internet, this sits behind traefik with TLS
 * and a bearer token, and connects as a role that only holds SELECT. Even with the
 * token, nothing here can write.
 *
 *   POST /q   { "sql": "SELECT ...", "params": [...] }   -> { rows }
 *   GET  /health
 */
const http = require('http');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT ?? 8090);
const TOKEN = process.env.API_TOKEN;
if (!TOKEN || TOKEN.length < 24) {
  console.error('API_TOKEN missing or too short — refusing to start');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PG_HOST ?? 'postgres',
  port: Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DB ?? 'bext',
  user: process.env.PG_USER,          // bext_ro — SELECT only
  password: process.env.PG_PASSWORD,
  max: 4,
  statement_timeout: 10000,
  connectionTimeoutMillis: 5000,
});
pool.on('error', () => { /* surfaced per-request */ });

// Belt and braces alongside the read-only role: reject anything that is not a
// plain SELECT before it reaches the database.
const READ_ONLY = /^\s*(select|with)\b/i;
const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy)\b/i;

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return pool.query('SELECT 1')
      .then(() => json(res, 200, { ok: true }))
      .catch(e => json(res, 503, { ok: false, error: e.message }));
  }
  if (req.method !== 'POST' || req.url !== '/q') return json(res, 404, { error: 'POST /q' });

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${TOKEN}`) return json(res, 401, { error: 'unauthorized' });

  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 200_000) req.destroy(); });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    const sql = String(body?.sql ?? '');
    if (!READ_ONLY.test(sql) || FORBIDDEN.test(sql)) {
      return json(res, 400, { error: 'only SELECT queries are accepted' });
    }
    try {
      const { rows } = await pool.query(sql, Array.isArray(body.params) ? body.params : []);
      json(res, 200, { rows });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
});

server.listen(PORT, () => console.log(`bext read API on ${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { server.close(); pool.end().finally(() => process.exit(0)); });
}
