# BEXT Automation — project rules

## What this is

Automation platform for BEXT Consultancy (one-person energy & sustainability consultancy).
Two engagements, hard client deadlines between 11 Aug and 8 Sep 2026. See `README.md`.

**New session? Read `STRUCTURE.md` first** — repo map, engagement status, hosting, MCP/skill scope.

## Hard rules

1. **Never touch the Premier Fitness stack.** The same VPS runs docker project `n8n`
   (`/docker/n8n`) for a different client. BEXT lives in project `bext` (`/docker/bext`) only.
   The `n8n-pf` / `hostinger-pf` / `supabase-pf` MCP servers are PF-scoped — do not create BEXT
   workflows through `n8n-pf`.
2. **Every BEXT workflow is named `BEXT — ...` and tagged `BEXT Consultancy`.** Folders
   are an enterprise-licensed feature (`feat:folders` is rejected on Community), so tags
   are the grouping mechanism. `n8n/build-workflows.js` applies the tag automatically.
3. **Secrets never get committed.** `.env` is gitignored. Credentials live in n8n's credential
   store and `.env` — never inline in workflow JSON or SQL.
4. **`N8N_ENCRYPTION_KEY` is irreplaceable.** Losing it makes every stored credential unreadable.
   It is in `.env` and must stay backed up.
5. **Postgres and Qdrant bind to loopback only.** Never publish them on `0.0.0.0`.
6. **Report cron is `Australia/Melbourne`, not UTC.** Hardcoding UTC+10 makes the 05:00 AEST
   report drift an hour when DST starts.
7. **Export workflows after every change** to `n8n/workflows/*.json` and commit. The n8n UI is
   not the source of truth — the repo is.

## Conventions

- Migrations are numbered and append-only: `db/migrations/00N_description.sql`. Never edit an
  applied migration; write a new one.
- Source registry (`sources/registry.yaml`) is the single source of truth for what gets monitored.
  The `sources` table is seeded from it, never hand-edited.
- Dashboard reads the database directly through server components. No duplicated state.
- Timeline and coverage are database-driven (`milestones`, `deliverables`) — not hardcoded in the UI.

## Stack

n8n 2.32.6 (Community) · PostgreSQL 16 · Qdrant · Docker Compose · traefik + Let's Encrypt ·
Next.js 15 App Router + TypeScript + Tailwind v4 + shadcn/ui · Microsoft Graph · Gemini

---

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your
context window from flooding.

## BLOCKED commands

- **curl / wget** — intercepted. Use `ctx_fetch_and_index(url, source)` or
  `ctx_execute(language: "javascript", code: "const r = await fetch(...)")`.
- **Inline HTTP** (`fetch('http`, `requests.get(`, `http.request(`) in Bash — intercepted.
  Use `ctx_execute`.
- **WebFetch** — denied. Use `ctx_fetch_and_index` then `ctx_search`.

## Redirected tools

- **Bash** is for `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install` — short output only.
  Anything larger goes through `ctx_execute(language: "shell", code: "...")`.
- **Read** for editing is correct. Read for *analysis* → `ctx_execute_file(path, language, code)`.
- **Grep** with large results → `ctx_execute` with a shell grep.

## Hierarchy

1. `ctx_batch_execute(commands, queries)` — gather
2. `ctx_search(queries: [...])` — follow up, all questions in one call
3. `ctx_execute` / `ctx_execute_file` — process
4. `ctx_fetch_and_index` → `ctx_search` — web
5. `ctx_index(content, source)` — store

## Output

Keep responses under 500 words. Write artifacts to files, return path + one line.
