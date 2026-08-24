import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { getReportArticles } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * The articles behind one daily report, fetched on demand when its row is opened
 * in the source-feed accordion. Lazy rather than preloaded so the list can be
 * paged without loading every report's items up front.
 */
export async function GET(req: Request) {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const rows = await getReportArticles(id);
  if (rows === null) return NextResponse.json({ error: 'database unreachable' }, { status: 503 });
  return NextResponse.json({ articles: rows });
}
