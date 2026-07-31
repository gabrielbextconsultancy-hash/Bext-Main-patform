-- 001_init.sql — BEXT application schema
--
-- Applied to the `bext` database. n8n's own metadata lives in the separate
-- `n8n` database and is never touched by these migrations.
--
--   psql -U bext -d bext -f 001_init.sql
--
-- Append-only: never edit this file once applied. Write a new migration.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Engagement tracking — drives the dashboard timeline and coverage pages
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE engagement AS ENUM ('infrastructure', 'daily_report', 'business_structure');
CREATE TYPE work_status AS ENUM ('not_started', 'in_progress', 'blocked', 'done');

CREATE TABLE milestones (
  id            serial PRIMARY KEY,
  engagement    engagement  NOT NULL,
  title         text        NOT NULL,
  detail        text,
  -- Contract date from the brief. Nullable for internal milestones we set ourselves.
  due_date      date,
  is_contracted boolean     NOT NULL DEFAULT false,
  status        work_status NOT NULL DEFAULT 'not_started',
  sort_order    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deliverables (
  id            serial PRIMARY KEY,
  engagement    engagement  NOT NULL,
  milestone_id  int         REFERENCES milestones(id) ON DELETE SET NULL,
  title         text        NOT NULL,
  description   text,
  status        work_status NOT NULL DEFAULT 'not_started',
  -- Link to the artefact that proves this is done: a doc, a workflow, a commit.
  evidence_url  text,
  -- Which section of the brief this satisfies, e.g. "B.3 Meeting Workflow".
  brief_ref     text,
  sort_order    int         NOT NULL DEFAULT 0,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deliverables_engagement_idx ON deliverables (engagement, sort_order);
CREATE INDEX deliverables_milestone_idx  ON deliverables (milestone_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Engagement A — industry source monitoring
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE ingest_method AS ENUM ('rss', 'scrape', 'api');
CREATE TYPE fetch_status  AS ENUM ('ok', 'empty', 'error', 'never_run');

CREATE TABLE sources (
  id              serial PRIMARY KEY,
  -- Stable identifier from sources/registry.yaml. The registry is the source of
  -- truth; this table is seeded from it and never hand-edited.
  slug            text        NOT NULL UNIQUE,
  name            text        NOT NULL,
  -- Report section headings, exactly as named in the brief.
  category        text        NOT NULL,
  subcategory     text,
  url             text        NOT NULL,
  method          ingest_method NOT NULL,
  -- For method='scrape': {"item": "...", "title": "...", "link": "...", "date": "..."}
  -- For method='rss':    optional {"feed_url": "..."} when it differs from url.
  -- Also carries per-source filters, e.g. the AER/AEMC register categories.
  config          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  active          boolean     NOT NULL DEFAULT true,
  last_fetch_at   timestamptz,
  last_status     fetch_status NOT NULL DEFAULT 'never_run',
  last_error      text,
  -- Incremented on failure, reset on success. Health check alerts at 3.
  consecutive_failures int    NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sources_active_idx   ON sources (active) WHERE active;
CREATE INDEX sources_category_idx ON sources (category);

CREATE TABLE articles (
  id            bigserial PRIMARY KEY,
  source_id     int         NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url           text        NOT NULL UNIQUE,
  title         text        NOT NULL,
  author        text,
  published_at  timestamptz,
  summary_raw   text,        -- excerpt as published, before any AI touches it
  body          text,
  -- sha256 of normalised title+body. Catches the same story syndicated across
  -- sites under different URLs, which is common across AEMO/AER/RenewEconomy.
  content_hash  text        NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX articles_hash_idx      ON articles (content_hash);
CREATE INDEX articles_published_idx ON articles (published_at DESC NULLS LAST);
CREATE INDEX articles_source_idx    ON articles (source_id, fetched_at DESC);

CREATE TABLE article_analysis (
  article_id      bigint PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  summary         text        NOT NULL,
  -- 0–100. Ranks items within a report section; low scores drop off the sheet.
  relevance_score int         NOT NULL CHECK (relevance_score BETWEEN 0 AND 100),
  topics          text[]      NOT NULL DEFAULT '{}',
  entities        text[]      NOT NULL DEFAULT '{}',
  model           text        NOT NULL,
  tokens_used     int,
  analysed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX article_analysis_score_idx ON article_analysis (relevance_score DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Engagement A — the daily sheet
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE report_status AS ENUM ('draft', 'rendered', 'sent', 'failed');

CREATE TABLE reports (
  id            serial PRIMARY KEY,
  -- One sheet per day, in Australia/Melbourne terms.
  report_date   date        NOT NULL UNIQUE,
  status        report_status NOT NULL DEFAULT 'draft',
  html          text,
  recipient     text,
  item_count    int         NOT NULL DEFAULT 0,
  generated_at  timestamptz,
  sent_at       timestamptz,
  error         text
);

CREATE TABLE report_items (
  id          bigserial PRIMARY KEY,
  report_id   int    NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  article_id  bigint NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  category    text   NOT NULL,
  rank        int    NOT NULL,
  blurb       text   NOT NULL,
  UNIQUE (report_id, article_id)
);

CREATE INDEX report_items_report_idx ON report_items (report_id, category, rank);

-- ─────────────────────────────────────────────────────────────────────────────
-- Platform health — drives the dashboard integrations page
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE health_status AS ENUM ('up', 'degraded', 'down', 'unconfigured');

CREATE TABLE integration_health (
  id            serial PRIMARY KEY,
  service       text        NOT NULL,
  status        health_status NOT NULL,
  detail        text,
  -- For OAuth-backed services, so the dashboard can warn before expiry.
  token_expires_at timestamptz,
  checked_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_health_service_idx ON integration_health (service, checked_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at maintenance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER milestones_touch   BEFORE UPDATE ON milestones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER deliverables_touch BEFORE UPDATE ON deliverables
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER sources_touch      BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
