import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The stored daily source-verification report.
 *
 * ?list=1          → the days that have one, newest first
 * ?date=YYYY-MM-DD → that day's PDF as application/pdf, or its HTML when the
 *                    fetcher was down that morning and only HTML was stored.
 *
 * Serves the STORED artefact, never a re-render: the point of the report is
 * that it describes the morning it was generated, and data moves.
 */
export async function GET(req: Request) {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const u = new URL(req.url);

  if (u.searchParams.get('list')) {
    const rows = await query<{ day: string; has_pdf: boolean }>(
      `SELECT day::text, (pdf IS NOT NULL) AS has_pdf
       FROM source_reports ORDER BY day DESC LIMIT 60`
    );
    return NextResponse.json({ days: rows });
  }

  const date = u.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 });
  }
  const rows = await query<{ html: string; pdf: Buffer | null }>(
    `SELECT html, pdf FROM source_reports WHERE day = $1::date`, [date]
  );
  if (!rows.length) return NextResponse.json({ error: 'no report for that day' }, { status: 404 });

  const { html, pdf } = rows[0];
  if (pdf) {
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="BEXT-Fetch-Audit-pubday-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  // The fetcher was down that morning; the HTML is the artefact that exists.
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
