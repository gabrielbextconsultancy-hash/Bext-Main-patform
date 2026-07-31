import { NextResponse } from 'next/server';
import {
  checkCredentials,
  createSession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from '@/lib/auth';

// Relative Location headers throughout — behind Passenger the request URL
// carries the internal host (sv70:3000), so absolute redirects would leak it.
export async function POST(req: Request) {
  const form = await req.formData();
  const user = String(form.get('username') ?? '');
  const pass = String(form.get('password') ?? '');

  if (!checkCredentials(user, pass)) {
    return new NextResponse(null, { status: 303, headers: { Location: '/login?error=1' } });
  }

  const { token } = await createSession();
  const res = new NextResponse(null, { status: 303, headers: { Location: '/health' } });
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return res;
}
