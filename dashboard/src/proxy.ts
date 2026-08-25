import { NextResponse, type NextRequest } from 'next/server';
import {
  createSession,
  readSession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from '@/lib/auth';

// /proposal is a client-facing deliverable — shareable by link, so it stays
// outside the admin session (it carries its own noindex).
//
// /api/fetched is the target of the Teams card's "View more" button, opened in
// the Teams in-app browser which holds no dashboard session. It carries its own
// token in the query string and enforces it in the route handler, so the session
// guard must let it reach that handler rather than bouncing it to /login — the
// bounce is exactly what made the SharePoint link fail.
const PUBLIC = ['/login', '/api/login', '/proposal', '/api/fetched'];

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

  const { valid, shouldRenew } = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!valid) {
    return NextResponse.redirect(new URL('/login', base));
  }

  const res = NextResponse.next();
  // Slide the expiry forward on ordinary use, so signing in once is enough and
  // the session ends only when the cookie is cleared.
  if (shouldRenew) {
    const { token } = await createSession();
    res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  }
  return res;
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)'],
};
