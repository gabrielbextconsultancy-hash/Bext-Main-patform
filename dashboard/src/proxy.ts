import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

const PUBLIC = ['/login', '/api/login'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  // Next's proxy layer requires absolute redirect URLs. Behind Passenger the
  // request URL carries the internal backend host, so build redirects from the
  // canonical APP_URL (env.local.json on the host) when it is set.
  const base = process.env.APP_URL || req.nextUrl.origin;
  if (!ok) {
    return NextResponse.redirect(new URL('/login', base));
  }

  // Landing page is Connection Health.
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/health', base));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)'],
};
