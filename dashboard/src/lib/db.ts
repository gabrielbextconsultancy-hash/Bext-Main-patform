import { Pool } from 'pg';

// Postgres lives on the VPS behind loopback. Local dev reaches it through an
// SSH tunnel (see docs/05-runbook.md); deployed, the dashboard container talks
// to `postgres` on the bext_internal network.
//
// Cached on globalThis so Next's dev-mode module reloading doesn't leak pools.
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
    connectionTimeoutMillis: 5000,
  });

if (process.env.NODE_ENV !== 'production') globalForDb.pool = pool;

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

/**
 * Every page reads the database directly. When the tunnel is down that should
 * show as an honest empty state rather than a stack trace, so reads go through
 * this and callers render a "database unreachable" notice on null.
 */
export async function tryQuery<T>(text: string, params?: unknown[]): Promise<T[] | null> {
  try {
    return await query<T>(text, params);
  } catch {
    return null;
  }
}
