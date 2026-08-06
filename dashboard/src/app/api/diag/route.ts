import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Why the data layer is or is not working, from inside the deployed process.
 *
 * "Database unreachable" is the same banner whether the credentials are missing,
 * the host cannot route to the API, or a module failed to load — three very
 * different problems. Guessing between them from outside cost real time, so this
 * reports which one it actually is. Admin-only, and it never returns the token.
 */
export async function GET() {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.BEXT_API_URL;
  const token = process.env.API_TOKEN;

  const out: Record<string, unknown> = {
    node: process.version,
    api_url_set: Boolean(url),
    api_url: url ?? null,
    api_token_set: Boolean(token),
    api_token_length: token?.length ?? 0,
    pg_host: process.env.PG_HOST ?? null,
  };

  if (url && token) {
    // Health first: proves outbound HTTPS from this host works at all.
    const started = Date.now();
    try {
      const h = await fetch(`${url}/health`, { cache: 'no-store' });
      out.health_status = h.status;
      out.health_body = (await h.text()).slice(0, 200);
    } catch (e) {
      out.health_error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      out.health_cause = (e as { cause?: { code?: string } })?.cause?.code ?? null;
    }
    out.health_ms = Date.now() - started;

    // Then a real query, which additionally proves the token is accepted.
    try {
      const r = await fetch(`${url}/q`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT count(*)::int AS reports FROM reports' }),
        cache: 'no-store',
      });
      out.query_status = r.status;
      out.query_body = (await r.text()).slice(0, 200);
    } catch (e) {
      out.query_error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      out.query_cause = (e as { cause?: { code?: string } })?.cause?.code ?? null;
    }
  }

  return NextResponse.json(out);
}
