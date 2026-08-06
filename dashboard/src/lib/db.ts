import { Pool } from 'pg';

/**
 * Two ways to reach the data, chosen by environment.
 *
 * Locally, a direct Postgres connection over the SSH tunnel (see
 * docs/05-runbook.md). In production the dashboard runs on iFastNet cPanel while
 * Postgres is bound to loopback on the Hostinger VPS — there is no network path
 * between those two hosts, which is why every live page read "Database
 * unreachable" once deployed.
 *
 * So when BEXT_API_URL is set, reads go through the read-only API on the VPS
 * instead: HTTPS, bearer token, and a database role holding only SELECT.
 */
const API_URL = process.env.BEXT_API_URL;
const API_TOKEN = process.env.API_TOKEN;
const useApi = Boolean(API_URL && API_TOKEN);

const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    host: process.env.PG_HOST ?? '127.0.0.1',
    port: Number(process.env.PG_PORT ?? 5433),
    database: process.env.PG_DB ?? 'bext',
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    max: 5,
    connectionTimeoutMillis: 3000,
  });

// A failed background connection emits 'error' on the pool; without a listener
// that crashes the whole process (kills the app on hosts with no reachable DB).
pool.on('error', () => { /* surfaced by tryQuery callers as a null result */ });

if (process.env.NODE_ENV !== 'production') globalForDb.pool = pool;

async function queryViaApi<T>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await fetch(`${API_URL}/q`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: text, params: params ?? [] }),
    // Live operational data — never serve a cached view of it.
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`read API ${res.status}`);
  const { rows } = (await res.json()) as { rows: T[] };
  return rows;
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  if (useApi) return queryViaApi<T>(text, params);
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

/**
 * Reads that tolerate the database being out of reach: callers render a
 * "database unreachable" notice on null rather than throwing a stack trace at
 * whoever opened the page.
 */
export async function tryQuery<T>(text: string, params?: unknown[]): Promise<T[] | null> {
  try {
    return await query<T>(text, params);
  } catch {
    return null;
  }
}
