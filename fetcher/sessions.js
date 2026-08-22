/**
 * Authenticated retrieval — tier 3 of the ingest ladder.
 *
 * Some sources put the content we need behind a member login. The Clean Energy
 * Council's Monday Megawatt archive, for instance, exists only inside
 * portal.cleanenergycouncil.org.au and not on the public site at all.
 *
 * Two things about this are easy to get wrong, and both have teeth.
 *
 * First, credentials. They are read from this process's environment at call
 * time, are never accepted over the wire, never logged, and never returned in a
 * response. A recipe names the environment variables it needs; it does not carry
 * values. Nothing here ever puts a password in a log line, including on failure.
 *
 * Second, and less obvious: a signed-out request to these sites returns 200 and
 * a perfectly valid page — the visitor's version. Nothing errors. If this module
 * returned that page, the ingest would parse a login screen, find no articles,
 * mark the source healthy and move on, and the member articles would silently
 * never appear. So every fetch asserts a signed-in marker and reports
 * `authenticated: false` when it is absent. The caller treats that as a refusal.
 */
'use strict';

/**
 * A login recipe per site.
 *
 * `verify` is the important field: a pattern that appears only when signed in.
 * `deniedBy` catches the signed-out page explicitly, so an expired session is
 * reported as expired rather than as an unexplained empty result.
 */
const RECIPES = {
  'cec-portal': {
    name: 'Clean Energy Council member portal',
    loginUrl: 'https://portal.cleanenergycouncil.org.au/account/login',
    // Craft CMS form login, confirmed 22 Aug 2026: no SSO redirect, no MFA step.
    userSelector: 'input[name="loginName"], input[type="email"]',
    passSelector: 'input[name="password"], input[type="password"]',
    submitSelector: 'button[type="submit"], input[type="submit"]',
    userEnv: 'CEC_PORTAL_USER',
    passEnv: 'CEC_PORTAL_PASS',
    // The news list only renders for a signed-in member.
    verify: /Monday Megawatt|Latest News/i,
    deniedBy: /\/account\/forgotpassword|name=["']password["']/i,
  },
};

const listRecipes = () => Object.keys(RECIPES);

/**
 * Sign in and keep the context. Logging in per fetch would be both slow and a
 * good way to trip a rate limit, so a signed-in context is reused until it dies.
 */
const contexts = new Map();

const newContext = (browser) => browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-AU',
  timezoneId: 'Australia/Melbourne',
  viewport: { width: 1440, height: 900 },
});

async function signIn(browser, site) {
  const r = RECIPES[site];
  if (!r) throw new Error('no login recipe for site "' + site + '"');

  const user = process.env[r.userEnv];
  const pass = process.env[r.passEnv];
  if (!user || !pass) {
    // Names the variable, never the value, so this is safe in any log.
    throw new Error('credentials not configured: set ' + r.userEnv + ' and ' + r.passEnv);
  }

  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await page.goto(r.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.fill(r.userSelector, user);
    await page.fill(r.passSelector, pass);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {}),
      page.click(r.submitSelector),
    ]);
    // Give a redirect chain a moment to settle before judging the result.
    await page.waitForTimeout(2000);

    const html = await page.content();
    if (r.deniedBy.test(html) && !r.verify.test(html)) {
      // Still looking at the login form: the credentials were rejected, or a
      // step we do not model (an interstitial, a consent page) is in the way.
      throw new Error('sign-in did not take — still on the login form');
    }
    return context;
  } finally {
    await page.close().catch(() => {});
  }
}

async function getContext(browser, site) {
  const existing = contexts.get(site);
  if (existing) {
    try {
      // Cheap liveness check; a closed context throws rather than reporting.
      existing.pages();
      return existing;
    } catch (e) {
      contexts.delete(site);
    }
  }
  const fresh = await signIn(browser, site);
  contexts.set(site, fresh);
  return fresh;
}

/**
 * Fetch one URL as a signed-in member.
 * Returns { html, authenticated, detail } — never throws for an expired session,
 * because "we are signed out" is information the caller needs, not an exception.
 */
async function sessionFetch(browser, { url, site, timeout = 60000 }) {
  const r = RECIPES[site];
  if (!r) return { html: '', authenticated: false, detail: 'no login recipe for site "' + site + '"' };

  const attempt = async (context) => {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForTimeout(1200);
      return await page.content();
    } finally {
      await page.close().catch(() => {});
    }
  };

  let html = '';
  try {
    html = await attempt(await getContext(browser, site));
  } catch (e) {
    return { html: '', authenticated: false, detail: String(e.message || e).slice(0, 200) };
  }

  // Sessions expire. One silent re-login, then believe the answer.
  if (r.deniedBy.test(html) && !r.verify.test(html)) {
    contexts.delete(site);
    try {
      html = await attempt(await getContext(browser, site));
    } catch (e) {
      return { html: '', authenticated: false, detail: 'session expired and re-login failed: ' + String(e.message || e).slice(0, 150) };
    }
  }

  const authenticated = r.verify.test(html) && !r.deniedBy.test(html);
  return {
    html,
    authenticated,
    detail: authenticated ? null : 'page returned ' + html.length + ' bytes but as a signed-out visitor',
  };
}

module.exports = { sessionFetch, listRecipes, RECIPES };
