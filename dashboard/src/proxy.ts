import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

// /proposal is a client-facing deliverable — shareable by link, so it stays
// outside the admin session (it carries its own noindex).
const PUBLIC = ['/login', '/api/login', '/proposal'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Next's proxy layer requires absolute redirect URLs, and behind Passenger the
  // request URL carries the internal backend host — so build every redirect from
  // the canonical APP_URL (set in env.local.json on the host) when present.
  const base = process.env.APP_URL || req.nextUrl.origin;

  // Force HTTPS. LiteSpeed terminates TLS and proxies plain HTTP to Passenger,
  // recording the original scheme in x-forwarded-proto — key on that (only when
  // explicitly "http") so we never loop on the already-internal backend hop.
  if (req.headers.get('x-forwarded-proto') === 'http' && base.startsWith('https://')) {
    return NextResponse.redirect(new URL(pathname + req.nextUrl.search, base), 301);
  }

  // The proposal is the landing page — it is the artefact being presented at the
  // moment, and it is public, so this has to resolve before the session check or
  // an anonymous visitor to the root gets bounced to a login they do not need.
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/proposal', base));
  }

  if (PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!ok) {
    return NextResponse.redirect(new URL('/login', base));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)'],
};
