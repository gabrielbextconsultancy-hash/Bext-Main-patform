// Simple signed-cookie session. One admin user, credentials from env with the
// agreed interim defaults. Uses Web Crypto so the same code runs in route
// handlers (Node) and middleware (Edge). Swap for a real user store later.
const USER = process.env.ADMIN_USER ?? 'admin';
const PASS = process.env.ADMIN_PASS ?? 'admin123';
const SECRET = process.env.SESSION_SECRET ?? 'bext-dev-secret-change-me';

export const SESSION_COOKIE = 'bext_session';

// A year. Combined with the sliding renewal below, signing in once keeps you
// signed in — the session only ends when the cookie is cleared.
const MAX_AGE_S = 60 * 60 * 24 * 365;

// Renew once the session is past its halfway point, so anyone using the
// dashboard regularly never reaches the expiry at all.
const RENEW_AFTER_S = MAX_AGE_S / 2;

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
  return (await readSession(token)).valid;
}

/**
 * Verifies the token and reports whether it is worth reissuing. The proxy uses
 * `shouldRenew` to slide the expiry forward on an ordinary page view, so an
 * active session never lapses.
 */
export async function readSession(
  token: string | undefined
): Promise<{ valid: boolean; shouldRenew: boolean }> {
  const no = { valid: false, shouldRenew: false };
  if (!token) return no;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return no;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return no;
  if (sig !== (await hmac(exp))) return no;

  const remainingS = (expiresAt - Date.now()) / 1000;
  return { valid: true, shouldRenew: remainingS < RENEW_AFTER_S };
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: MAX_AGE_S,
  // TLS is live (AutoSSL) and http is forced to https, so the cookie always
  // comes back. Override with COOKIE_SECURE=false for plain-http local dev.
  secure: process.env.COOKIE_SECURE !== 'false',
} as const;
