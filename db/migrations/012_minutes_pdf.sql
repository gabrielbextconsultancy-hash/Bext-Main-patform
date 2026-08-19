-- 012 — keep the Word and PDF copies of each document separately.
--
-- 011 stored one url per document and the workflow wrote `pdf || docx` into it,
-- so whichever existed won and the other became unreachable. They are not
-- interchangeable: the .docx is what BEXT edits before sending, and the PDF is
-- what previews inline in Teams and SharePoint without Word. The card and the
-- dashboard want the PDF; a reviewer wants the Word file.
--
-- Nullable because PDF conversion is best-effort — Graph declines it for some
-- documents, and a missing preview must never fail a run.

ALTER TABLE meeting_minutes
  ADD COLUMN IF NOT EXISTS minutes_pdf_url    text,
  ADD COLUMN IF NOT EXISTS summary_pdf_url    text,
  ADD COLUMN IF NOT EXISTS transcript_pdf_url text;

COMMENT ON COLUMN meeting_minutes.minutes_pdf_url IS
  'PDF rendering of Minutes.docx. Previews inline in Teams; null when conversion failed.';
COMMENT ON COLUMN meeting_minutes.minutes_url IS
  'Word copy of the minutes — the editable one. See minutes_pdf_url for the preview.';

-- When the minutes email actually went out. Null means it is still a draft
-- awaiting review, which is the behaviour whenever MEETING_REPORT_RECIPIENT is
-- unset — so this doubles as the record of which mode a run used.
ALTER TABLE meeting_minutes
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

COMMENT ON COLUMN meeting_minutes.sent_at IS
  'Set when the minutes email was sent. Null = still an unsent draft.';
