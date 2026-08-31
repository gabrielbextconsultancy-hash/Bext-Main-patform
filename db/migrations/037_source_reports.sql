-- The daily source-verification report: where every sent article came from,
-- which brief links produced, which sat quiet and which are off — compiled at
-- 05:00 beside the send it describes, and kept per day so "what did you check
-- on the 3rd" has a stored answer rather than a reconstruction.
--
-- The PDF is rendered by the fetcher at build time and stored as bytes, so the
-- artefact the operator downloads is the artefact that was generated that
-- morning — not a re-render from data that has since moved. html is kept
-- beside it as the fallback for a morning the fetcher was down.
CREATE TABLE IF NOT EXISTS source_reports (
  day        date PRIMARY KEY,
  html       text NOT NULL,
  pdf        bytea,
  tally      jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
