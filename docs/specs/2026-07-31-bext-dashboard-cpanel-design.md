# BEXT Dashboard on cPanel — design (approved 2026-07-31)

## Goal
Host the management dashboard at **bext.dev-environment.site** (iFastNet cPanel, Node 22 /
Passenger). Hostinger VPS stays n8n-only. Two primary pages behind a login.

## Decisions
- **Runtime:** existing `dashboard/` Next.js 16 app, `output: 'standalone'`, Node 22 Selector app.
- **Auth:** server cookie session. `middleware` guards all routes except `/login`, `/api/login`,
  static assets. Credentials from `ADMIN_USER`/`ADMIN_PASS` env (default `admin`/`admin123` for now).
  Signed httpOnly cookie (HMAC-SHA256, `SESSION_SECRET` env).
- **Data:** static config in `src/lib/platform.ts` — tools/tech-stack (from PLAN 1 PDF) and
  engagement plan/deadlines (from the two project briefs). No DB dependency; existing DB pages
  keep their graceful "database unreachable" state.
- **Navigation:** sidebar management shell. Order: Connection Health (landing, `/` redirects),
  Timeline & Plan, then existing Overview / Deliverables / Sources.

## Pages
1. **/health — Connection Health**: tool cards grouped by category (Infrastructure, Automation,
   AI, Microsoft, Development, Hosting). Each: name, purpose, endpoint/config summary, cost,
   owner, status pill (operational / optional / planned).
2. **/timeline — Timeline & Plan**: static engagement timeline —
   Daily Report (draft 11 Aug → final 18 Aug 2026), Business Structure (draft 11 Aug →
   schematic 25 Aug → final 8 Sep 2026) — plus "tools we use freely for now" tech-stack list.
   DB milestone chart retained below as a secondary section.

## Deploy (follow-on step)
GitHub `Bext-Main-patform` ← push `master`. GitHub Actions → cPanel UAPI git pull +
`.cpanel.yml` deploy (npm ci, next build, Passenger restart). cPanel Node app root:
`/home/devenvir/bext.dev-environment.site/dashboard`, startup via standalone server.
