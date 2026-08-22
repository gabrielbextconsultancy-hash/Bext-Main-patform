# Sources that need an account

Everything here was measured on **22 August 2026**, not assumed. Each source was
fetched with browser-fingerprint impersonation (`bext-scrapling`) and the response
classified by *kind of gate*, because the remedy is different for each kind.

**Result: 61 of 68 sources are healthy and need nothing from you.** The list below
is the remainder.

Sign up with **gabriel.bextconsultancy@gmail.com** — that is the mailbox the
pipeline reads.

---

## Why most of the "blocked" sources turned out not to need an account

Worth knowing before you spend time signing up for anything. Most of what looked
like a paywall was not one.

A web application firewall can fingerprint the TLS handshake, and Node's `fetch`
and headless Chromium both have handshakes that are recognisably not a browser.
Those sites were refusing us over the handshake, before any question of accounts
arose. Reproducing Chrome's fingerprint fixed them outright:

| Source | Before | After |
|---|---|---|
| DCCEEW | 403 — registry said "no solvable challenge" | **200** |
| EcoGeneration | 403 | **200** |
| NABERS | unreachable | **200** |
| S&P Global | 403 — registry said "subscriber content" | **200** |
| Clean Energy Council | 8 links parsed | **654** |

DCCEEW had a second problem worth remembering: the faceted URL
(`?f[0]=news_type…`) trips the firewall *even with* impersonation, while the plain
`/about/news` path does not. If a government source starts 403ing, check the query
string before concluding you have been blocked.

**So: no account was needed for any of those.** Four sources remain that genuinely
need one.

---

## 1. Reuters — free account

- Status: **401** to every automated request, impersonation included.
- Sign up: <https://www.reuters.com/account/register/sign-up/>
- Then subscribe to the newsletters: <https://www.reuters.com/newsletters/>
  — the ones worth taking are **Sustainable Switch** and **Power Up**.

## 2. IEA — free newsletter

- Status: **403** to plain HTTP, headless Chromium, and impersonation alike.
- Subscribe: <https://www.iea.org/subscribe-to-data-services/newsletters>
  — take **IEA Newsletter** and **Energy Efficiency**.

## 3. Australian Financial Review — you already have this

You mentioned you sign in with your Google account. Two things are true and worth
separating:

- The **index page is already readable** — headlines are being collected today.
- **Article bodies are not.** They sit behind "already a subscriber", so the
  relevance scorer only ever sees a headline and standfirst. Several of the
  articles you flagged as missing on 21 August were AFR ones.

AFR retired its RSS feeds; `/newsfeed/about` now offers only subscribe links, so
there is no feed to point at. Two ways to deepen it:

- **Newsletters** (free with your account): <https://www.afr.com/newsletters>
  — **Before the Bell** and **Energy & Climate**.
- **Session cookie**, if you want full article text. See *Using your logged-in
  session* below.

## 4. The Australian — subscriber wall

- Status: 200 but truncated, `paywall` marker present.
- Not currently in the registry; it appeared in the articles you flagged.
- Newsletters: <https://www.theaustralian.com.au/newsletters>

---

## After you subscribe

The newsletters land in `gabriel.bextconsultancy@gmail.com` and n8n reads that
mailbox on the same schedule as everything else, parsing the links into the same
`articles` table the scrapers feed. Migration `013_newsletter_ingest.sql` already
carries the sender patterns:

| Source | Matches mail from |
|---|---|
| AFR | `%@afr.com`, `%@nine.com.au` |
| The Australian | `%@theaustralian.com.au`, `%@news.com.au` |
| Reuters | `%@reuters.com` |
| IEA | `%@iea.org` |

**One thing needed from you before that runs:** an IMAP app password for the Gmail
account, created at <https://myaccount.google.com/apppasswords> (requires 2-step
verification). Paste it straight into n8n's credential store — send it to me and
it is in a transcript, which is not where credentials belong.

### Why IMAP and not the Gmail MCP server

MCP is an agent-session transport: it works while someone is driving it. The
report runs at 05:00 AEST whether or not any agent is alive, so a pipeline behind
MCP would ingest only when a session happens to be open — the same silent-failure
shape that let DCCEEW report "ok" for weeks while returning nothing. IMAP polling
runs unattended, uses the same credential store and health table as every other
source, and needs no Google Cloud project or OAuth consent screen.

The Gmail MCP server is still worth having for setting up labels and inspecting
what arrives. It just should not be the load-bearing path.

---

## When a logged-in fetch is possible, and when it is not

Member-only sources fall into three classes. The class decides the remedy, so
check which one you are looking at before spending effort.

### Class A — cookie export works

The site uses an ordinary form login and keeps the session in cookies. Export
them once and the fetcher is a member until they expire. **This is the good case.**

Signals: a `<input type="password">` form on the site's own domain; session
cookies set on that domain; no redirect to a separate identity provider.

- **Clean Energy Council member portal** — confirmed 22 Aug 2026. Craft CMS form
  login at `portal.cleanenergycouncil.org.au/account/login`, session held in
  `CraftSessionId` plus the `*_identity` pair, alongside `AWSALB` and
  `CRAFT_CSRF_TOKEN`. No SSO, no MFA in the flow. The Monday Megawatt archive
  lives here and is not on the public site.
- **AFR** — same shape, though only article bodies are gated.

### Class B — needs a live browser session

The login redirects through a separate identity provider (Azure AD B2C, Auth0,
Okta, Microsoft Entra, Cognito), or the session is bound to more than a cookie —
a device fingerprint, a rotating token, a TLS-bound session. An exported cookie
either will not authenticate or dies within minutes.

Signals: a redirect to `login.microsoftonline.com`, `*.b2clogin.com`,
`*.auth0.com`, `*.okta.com`; a `code`/`state` query dance; tokens in local
storage rather than cookies.

Remedy is a browser that stays signed in and is driven per fetch — heavier, and
worth building only for a source that earns it. None of the current sources need
this.

### Class C — not automatable

Multi-factor on every request, a CAPTCHA on the login, or terms that forbid
automated access. Remedy is the newsletter route, or nothing.

### Before using a member session for client work

Member portal content is licensed to **you** as a member. Republishing it in a
report that goes to a client can breach the membership terms even though the
fetching is trivially possible. Worth a glance at the CEC terms, or a word with
them, before Monday Megawatt items appear in a BEXT deliverable. Flagging it
because it is easy to miss — technically nothing stops it. Your call, not mine.

---

## Using your logged-in session

For a source where an account unlocks content rather than merely access, the
fetcher can reuse a session **you** establish. It never signs in itself — no
password or SSO flow passes through the automation.

1. Sign in normally in your own browser.
2. Export the cookies for that domain (any "cookies.txt" style extension).
3. Add them to `.env` as JSON, keyed by host:

   ```
   SOURCE_COOKIES={"www.afr.com":{"ADVANCE_SESSION":"…"}}
   ```

4. `docker compose up -d scrapling`
5. Prove it worked: `node sources/check-session.js`

Step 5 matters more than it looks. A signed-out fetch returns **200 and a
perfectly valid page** — just the visitor's version. Nothing errors and the health
table stays green while the member articles quietly never arrive. `check-session.js`
asks for a page only a member can see and looks for a marker only a member gets,
so an expired cookie reports as expired instead of as healthy.

Treat these as credentials: they are in `.env`, which is gitignored, and they
expire. **When a subscriber source starts returning the paywall again, an expired
cookie is the first thing to check** — the symptom looks identical to being
blocked.

---

## Still open, unrelated to accounts

| Source | Problem |
|---|---|
| `unfccc` | Returns a 954-byte stub; client-rendered. Falls to the browser tier. |
| `aer-registers` | Same — 2 KB stub at `/industry/registers`. |

`aer-news` and `ahc` had the same symptom and turned out to be moved pages, now
corrected in the registry (`/news/articles` → `/news`, `aidc.org.au/media-releases`
→ `aidc.org.au/aidc-media-releases`).
