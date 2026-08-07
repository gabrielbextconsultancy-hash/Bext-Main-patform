import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { getReportHtml } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Serves the rendered HTML of one report so the panel can show exactly what was
 * emailed, rather than a reconstruction of it. Admin-only: the sheet is client
 * work product.
 */
export async function GET(req: Request) {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const date = new URL(req.url).searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 });
  }

  const html = await getReportHtml(date);
  if (html === null) {
    return NextResponse.json({ error: 'no report for that date' }, { status: 404 });
  }
  return NextResponse.json({ date, html });
}
