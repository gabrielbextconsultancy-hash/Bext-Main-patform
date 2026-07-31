// Simple signed-cookie session. One admin user, credentials from env with the
// agreed interim defaults. Uses Web Crypto so the same code runs in route
// handlers (Node) and middleware (Edge). Swap for a real user store later.
const USER = process.env.ADMIN_USER ?? 'admin';
const PASS = process.env.ADMIN_PASS ?? 'admin123';
const SECRET = process.env.SESSION_SECRET ?? 'bext-dev-secret-change-me';

export const SESSION_COOKIE = 'bext_session';
const MAX_AGE_S = 60 * 60 * 12; // 12h

async function hmac(payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  // base64url without Buffer — middleware may run on the Edge runtime.
  const bytes = String.fromCharCode(...new Uint8Array(sig));
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function checkCredentials(user: string, pass: string) {
  return user === USER && pass === PASS;
}

/** Token = expiry.signature — no server-side state. */
export async function createSession() {
  const exp = Date.now() + MAX_AGE_S * 1000;
  return { token: `${exp}.${await hmac(String(exp))}`, maxAge: MAX_AGE_S };
}

export async function verifySession(token: string | undefined) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  return sig === (await hmac(exp));
}
