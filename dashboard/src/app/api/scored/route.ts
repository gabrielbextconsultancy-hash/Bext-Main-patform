import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { getScoredFiltered } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

/**
 * Pages and filters the scored articles for the browser on /reports.
 *
 * Filters are applied in SQL rather than in the client, because the set is
 * already 1,300 rows and growing hourly — paging through everything to filter it
 * in the browser would get slower every day.
 */
export async function GET(req: Request) {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const page = Math.max(0, Number(sp.get('page') ?? 0) || 0);

  const result = await getScoredFiltered(
    {
      q: sp.get('q')?.trim() || undefined,
      band: sp.get('band') || undefined,
      category: sp.get('category') || undefined,
      sentOnly: sp.get('sent') === '1',
    },
    page * PAGE_SIZE,
    PAGE_SIZE
  );

  if (result === null) {
    return NextResponse.json({ error: 'database unreachable' }, { status: 503 });
  }

  return NextResponse.json({
    rows: result.rows,
    page,
    pageSize: PAGE_SIZE,
    total: result.total,
    pages: Math.max(1, Math.ceil(result.total / PAGE_SIZE)),
  });
}
