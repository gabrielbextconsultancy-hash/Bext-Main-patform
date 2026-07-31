import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

const PUBLIC = ['/login', '/api/login'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  // Relative Location headers — the internal request URL carries the
  // Passenger backend host, so absolute redirects would leak/break it.
  if (!ok) {
    return new NextResponse(null, { status: 307, headers: { Location: '/login' } });
  }

  // Landing page is Connection Health.
  if (pathname === '/') {
    return new NextResponse(null, { status: 307, headers: { Location: '/health' } });
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)'],
};
