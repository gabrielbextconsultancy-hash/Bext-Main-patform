#!/usr/bin/env node
/**
 * Does a stored session actually authenticate?
 *
 * Member-only sources fail in the worst possible way: the server returns 200 and
 * a perfectly valid page, just the logged-out one. Nothing errors, the health
 * table stays green, and the articles simply never appear. That is the same
 * silent-success shape that let DCCEEW report "ok" for weeks.
 *
 * So a session is never assumed. This asks for a page that only a member can see
 * and checks for something that only appears when signed in.
 *
 *   node sources/check-session.js              all configured sessions
 *   node sources/check-session.js cec-portal   just one
 *
 * Cookies come from SOURCE_COOKIES in .env, which is the same JSON the scrapling
 * service reads. They expire — when a member source goes quiet, run this first.
 */
'use strict';
require('dotenv').config();

const SCRAPLING = process.env.SCRAPLING_URL || 'http://127.0.0.1:8090/fetch';

// A probe needs a URL only a member can see, and a marker that appears only when
// signed in. Matching on the marker rather than the status code is the whole
// point: the logged-out page is also a 200.
const PROBES = {
  'cec-portal': {
    name: 'Clean Energy Council — member portal',
    url: 'https://portal.cleanenergycouncil.org.au/account/news',
    host: 'portal.cleanenergycouncil.org.au',
    // Signed out, this page renders the login form instead of the news list.
    signedOut: /name=["']password["']|\/account\/forgotpassword/i,
    signedIn: /Monday Megawatt|Latest News/i,
    login: 'https://portal.cleanenergycouncil.org.au/account/login',
    note: 'Craft CMS form login. Cookies: CraftSessionId and the *_identity pair.',
  },
  afr: {
    name: 'Australian Financial Review',
    url: 'https://www.afr.com/companies/energy',
    host: 'www.afr.com',
    signedOut: /already a subscriber|subscribe to continue/i,
    signedIn: null,
    login: 'https://www.afr.com/login',
    note: 'Index is readable signed out; this checks whether article bodies are.',
  },
};

const fetchVia = async (url) => {
  const r = await fetch(SCRAPLING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, include_html: true, timeout: 45 }),
  });
  if (!r.ok) throw new Error('scrapling service returned ' + r.status);
  return r.json();
};

(async () => {
  let cookies = {};
  try {
    cookies = JSON.parse(process.env.SOURCE_COOKIES || '{}');
  } catch (e) {
    console.error('SOURCE_COOKIES in .env is not valid JSON — fix it before anything else.');
    process.exit(1);
  }

  const wanted = process.argv[2];
  const keys = wanted ? [wanted] : Object.keys(PROBES);
  if (wanted && !PROBES[wanted]) {
    console.error('No probe called ' + wanted + '. Known: ' + Object.keys(PROBES).join(', '));
    process.exit(1);
  }

  let bad = 0;
  for (const key of keys) {
    const p = PROBES[key];
    const has = Object.prototype.hasOwnProperty.call(cookies, p.host);

    if (!has) {
      console.log('\n' + p.name);
      console.log('  no cookies configured for ' + p.host);
      console.log('  sign in at ' + p.login + ', export that domain\'s cookies,');
      console.log('  and add them to SOURCE_COOKIES in .env keyed by "' + p.host + '".');
      console.log('  ' + p.note);
      bad++;
      continue;
    }

    let res;
    try {
      res = await fetchVia(p.url);
    } catch (e) {
      console.log('\n' + p.name + '\n  could not reach the fetcher: ' + e.message);
      bad++;
      continue;
    }

    const html = res.html || '';
    const out = p.signedOut && p.signedOut.test(html);
    const inn = p.signedIn ? p.signedIn.test(html) : !out;
    const ok = inn && !out;

    console.log('\n' + p.name);
    console.log('  ' + p.url);
    console.log('  status ' + res.status + ', ' + html.length + ' bytes');
    console.log('  ' + (ok ? 'SIGNED IN — member content is reachable'
                            : 'SIGNED OUT — the page came back, but as a visitor'));
    if (!ok) {
      console.log('  The cookie has almost certainly expired. Sign in again at');
      console.log('  ' + p.login + ' and re-export.');
      bad++;
    }
  }

  console.log('');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAILED ' + (e.message || e)); process.exit(1); });
