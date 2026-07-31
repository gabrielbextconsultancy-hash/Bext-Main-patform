import { NextResponse } from 'next/server';
import { checkCredentials, createSession, SESSION_COOKIE } from '@/lib/auth';

export async function POST(req: Request) {
  const form = await req.formData();
  const user = String(form.get('username') ?? '');
  const pass = String(form.get('password') ?? '');

  if (!checkCredentials(user, pass)) {
    return NextResponse.redirect(new URL('/login?error=1', req.url), 303);
  }

  const { token, maxAge } = await createSession();
  const res = NextResponse.redirect(new URL('/health', req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
    // Site currently serves over HTTP until AutoSSL reissues; flip on once TLS is live.
    secure: false,
  });
  return res;
}
