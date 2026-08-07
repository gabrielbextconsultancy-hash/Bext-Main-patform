import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { getScoredPage, getScoredCount } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

/** Pages through every scored article, for the modal on /reports. */
export async function GET(req: Request) {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const page = Math.max(0, Number(new URL(req.url).searchParams.get('page') ?? 0) || 0);
  const [rows, total] = await Promise.all([
    getScoredPage(page * PAGE_SIZE, PAGE_SIZE),
    getScoredCount(),
  ]);

  return NextResponse.json({
    rows: rows ?? [],
    page,
    pageSize: PAGE_SIZE,
    total,
    pages: Math.ceil(total / PAGE_SIZE),
  });
}
