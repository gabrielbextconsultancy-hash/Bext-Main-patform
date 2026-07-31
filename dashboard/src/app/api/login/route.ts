import { NextResponse } from 'next/server';
import { checkCredentials, createSession, SESSION_COOKIE } from '@/lib/auth';

// Relative Location headers throughout — behind Passenger the request URL
// carries the internal host (sv70:3000), so absolute redirects would leak it.
export async function POST(req: Request) {
  const form = await req.formData();
  const user = String(form.get('username') ?? '');
  const pass = String(form.get('password') ?? '');

  if (!checkCredentials(user, pass)) {
    return new NextResponse(null, { status: 303, headers: { Location: '/login?error=1' } });
  }

  const { token, maxAge } = await createSession();
  const res = new NextResponse(null, { status: 303, headers: { Location: '/health' } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
    // TLS is live (AutoSSL); an .htaccess rule forces http→https so the cookie
    // is always sent back. Override with COOKIE_SECURE=false for plain-http dev.
    secure: process.env.COOKIE_SECURE !== 'false',
  });
  return res;
}
