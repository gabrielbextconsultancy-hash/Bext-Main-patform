-- A read-only Postgres role for Grafana, so the self-healing dashboard can read
-- the incident log without handing a dashboard the application's write access.
--
-- Deliberately split in two: this migration creates the role and the grants, both
-- safe to commit. The role's PASSWORD and LOGIN are set separately on the VPS from
-- GRAFANA_DB_PASSWORD in .env (docs/OBSERVABILITY.md) — a password never belongs in
-- a committed migration. Until that step runs the role cannot log in, which is the
-- safe default.
--
-- Grafana only ever SELECTs. If a panel needs a new table later, add its GRANT in a
-- new migration rather than widening this role to ALL TABLES — a read-only role that
-- can see everything is still a bigger blast radius than one that sees the incident
-- log and the health tables it is meant to.

BEGIN;

DO $$ BEGIN
  CREATE ROLE grafana_ro NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO grafana_ro;

-- The self-healing dashboard's tables, and nothing else.
GRANT SELECT ON incidents, heal_rules, heal_watermark, integration_health, reports TO grafana_ro;

COMMIT;
