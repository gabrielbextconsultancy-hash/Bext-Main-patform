import { tryQuery } from './db';
import type { Deliverable, Milestone, SourceRow, Engagement, WorkStatus } from './types';

export const getMilestones = () =>
  tryQuery<Milestone>(
    `SELECT id, engagement, title, detail, due_date::text, is_contracted, status, sort_order
     FROM milestones ORDER BY sort_order`
  );

export const getDeliverables = () =>
  tryQuery<Deliverable>(
    `SELECT id, engagement, milestone_id, title, description, status, evidence_url,
            brief_ref, sort_order
     FROM deliverables ORDER BY sort_order`
  );

export interface EngagementProgress {
  engagement: Engagement;
  total: number;
  done: number;
  in_progress: number;
  blocked: number;
}

export const getProgress = () =>
  tryQuery<EngagementProgress>(
    `SELECT engagement,
            count(*)::int                                        AS total,
            count(*) FILTER (WHERE status = 'done')::int          AS done,
            count(*) FILTER (WHERE status = 'in_progress')::int   AS in_progress,
            count(*) FILTER (WHERE status = 'blocked')::int       AS blocked
     FROM deliverables GROUP BY engagement`
  );

export interface SourceSummary {
  total: number;
  active: number;
  rss: number;
  scrape: number;
  failing: number;
  never_run: number;
}

export const getSourceSummary = async () => {
  const rows = await tryQuery<SourceSummary>(
    `SELECT count(*)::int                                              AS total,
            count(*) FILTER (WHERE active)::int                        AS active,
            count(*) FILTER (WHERE method = 'rss')::int                AS rss,
            count(*) FILTER (WHERE method = 'scrape')::int             AS scrape,
            count(*) FILTER (WHERE consecutive_failures >= 3)::int     AS failing,
            count(*) FILTER (WHERE last_status = 'never_run')::int     AS never_run
     FROM sources`
  );
  return rows?.[0] ?? null;
};

export const getSources = () =>
  tryQuery<SourceRow>(
    // The tier strip comes from the most recent run only. fetch_attempts keeps
    // every run, so without the run_at bound this would show a source as having
    // tried every route it has ever tried, which is the opposite of the point.
    `WITH latest AS (
       SELECT source_id, max(run_at) AS run_at FROM fetch_attempts GROUP BY source_id
     ),
     strip AS (
       SELECT a.source_id,
              array_agg(a.tier || ':' || a.outcome || ':' || a.articles_found
                        ORDER BY a.tier) AS tiers,
              sum(a.articles_found) FILTER (WHERE a.outcome = 'success') AS articles_last_run
       FROM fetch_attempts a
       JOIN latest l ON l.source_id = a.source_id AND a.run_at = l.run_at
       GROUP BY a.source_id
     )
     SELECT s.id, s.slug, s.name, s.category, s.method, s.active, s.last_fetch_at::text,
            s.last_status, s.consecutive_failures, s.satisfied_by_tier, s.email_authoritative,
            coalesce((s.config->>'requires_browser')::boolean, false) AS requires_browser,
            s.config->>'note' AS note,
            strip.tiers, strip.articles_last_run::int
     FROM sources s
     LEFT JOIN strip ON strip.source_id = s.id
     ORDER BY s.category, s.name`
  );

export interface TierSummary {
  tier: number;
  sources: number;
  articles: number;
}

/** How many sources each route ended up carrying, on the most recent run. */
export const getTierSummary = () =>
  tryQuery<TierSummary>(
    `SELECT satisfied_by_tier AS tier, count(*)::int AS sources,
            coalesce(sum(
              (SELECT max(a.articles_found) FROM fetch_attempts a
                WHERE a.source_id = s.id AND a.outcome = 'success')
            ), 0)::int AS articles
     FROM sources s
     WHERE s.active AND s.satisfied_by_tier IS NOT NULL
     GROUP BY 1 ORDER BY 1`
  );

export interface ReportRow {
  id: number;
  report_date: string;
  status: string;
  item_count: number;
  recipient: string | null;
  generated_at: string | null;
  sent_at: string | null;
  error: string | null;
}

/** Every report, newest first — drives the /reports panel. */
export const getReports = () =>
  tryQuery<ReportRow>(
    `SELECT id, report_date::text, status::text, item_count, recipient,
            generated_at::text, sent_at::text, error
     FROM reports ORDER BY report_date DESC LIMIT 60`
  );

/** The rendered HTML for one report, so the panel can preview what went out. */
export const getReportHtml = async (date: string) => {
  const rows = await tryQuery<{ html: string | null }>(
    `SELECT html FROM reports WHERE report_date = $1::date`,
    [date]
  );
  return rows?.[0]?.html ?? null;
};

/** The day's full fetch list, served to the Teams card's "View more" button. */
export const getFetchListHtml = async (date: string) => {
  const rows = await tryQuery<{ fetch_list_html: string | null }>(
    `SELECT fetch_list_html FROM reports WHERE report_date = $1::date`,
    [date]
  );
  return rows?.[0]?.fetch_list_html ?? null;
};

/** The management table behind /audit: every article of a publication day with
 *  its score, disposition, fetch time, and where it is going — filterable by
 *  disposition, source, and title search, paginated. The disposition CASE
 *  mirrors n8n/lib/day-audit.js exactly; if one changes, change both. */
export interface ManagementRow {
  id: string;
  title: string;
  url: string;
  source_name: string;
  brief_n: number | null;
  score: number | null;
  disposition: 'SENT' | 'QUEUED' | 'HELD' | 'EXCLUDED';
  reason: string;
  fetched_at: string;
  sent_report: string | null;
  sent_at: string | null;
}

const DISPOSITION_SQL = `
  CASE
    WHEN sent.report_date IS NOT NULL THEN 'SENT'
    WHEN a.content_kind IN ('reference', 'offtopic') THEN 'HELD'
    WHEN a.date_state = 'none' AND coalesce(an.relevance_score, -1) = 0 THEN 'HELD'
    WHEN NOT a.report_eligible THEN 'HELD'
    WHEN coalesce(an.relevance_score, -1) = 0 THEN 'EXCLUDED'
    ELSE 'QUEUED'
  END`;

const REASON_SQL = `
  CASE
    WHEN sent.report_date IS NOT NULL THEN 'sent in the ' || sent.report_date || ' report'
    WHEN a.content_kind = 'reference' THEN 'standing reference page (judge)'
    WHEN a.content_kind = 'offtopic' THEN 'off-topic article, not industry news (judge)'
    WHEN a.date_state = 'none' AND coalesce(an.relevance_score, -1) = 0 THEN 'website furniture (no date, score 0)'
    WHEN NOT a.report_eligible THEN 'stale-dated (older than 14 days)'
    WHEN coalesce(an.relevance_score, -1) = 0 THEN 'score 0 - no energy/building/climate bearing'
    WHEN an.relevance_score IS NULL THEN 'awaiting scoring, then the next report'
    ELSE 'goes out in the next 05:00 report'
  END`;

const MANAGEMENT_FROM = `
  FROM articles a
  JOIN sources s ON s.id = a.source_id
  LEFT JOIN article_analysis an ON an.article_id = a.id
  LEFT JOIN LATERAL (
    SELECT r.report_date::text, r.sent_at
    FROM report_items ri JOIN reports r ON r.id = ri.report_id
    WHERE ri.article_id = a.id AND r.status = 'sent' LIMIT 1) sent ON true
  WHERE (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date = $1::date`;

export const PAGE_SIZE = 50;

export async function getManagementRows(opts: {
  day: string; status?: string; src?: string; q?: string; page?: number;
}) {
  const params: unknown[] = [opts.day];
  let where = '';
  if (opts.status && ['SENT', 'QUEUED', 'HELD', 'EXCLUDED'].includes(opts.status)) {
    params.push(opts.status);
    where += ` AND ${DISPOSITION_SQL} = $${params.length}`;
  }
  if (opts.src) {
    params.push(Number(opts.src));
    where += ` AND s.id = $${params.length}`;
  }
  if (opts.q) {
    params.push('%' + opts.q + '%');
    where += ` AND a.title ILIKE $${params.length}`;
  }
  const countRows = await tryQuery<{ n: string }>(
    `SELECT count(*)::text AS n ${MANAGEMENT_FROM}${where}`, params
  );
  const total = Number(countRows?.[0]?.n ?? 0);

  const page = Math.max(1, opts.page ?? 1);
  params.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const rows = await tryQuery<ManagementRow>(
    `SELECT a.id::text, a.title, a.url, s.name AS source_name,
            (SELECT min(bl.n) FROM brief_links bl WHERE bl.source_id = s.id) AS brief_n,
            an.relevance_score AS score,
            ${DISPOSITION_SQL} AS disposition,
            ${REASON_SQL} AS reason,
            to_char(a.fetched_at AT TIME ZONE 'Australia/Melbourne', 'DD Mon HH24:MI') AS fetched_at,
            sent.report_date AS sent_report,
            to_char(sent.sent_at AT TIME ZONE 'Australia/Melbourne', 'DD Mon HH24:MI') AS sent_at
     ${MANAGEMENT_FROM}${where}
     ORDER BY an.relevance_score DESC NULLS LAST, a.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  return { rows: rows ?? [], total };
}

/** Live tally for one publication day — always current, unlike the stored
 *  audit snapshot, so the page and the numbers can never disagree. */
export async function getLiveTally(day: string) {
  const rows = await tryQuery<{ disposition: string; n: string }>(
    `SELECT ${DISPOSITION_SQL} AS disposition, count(*)::text AS n
     ${MANAGEMENT_FROM} GROUP BY 1`, [day]
  );
  const t = { fetched: 0, SENT: 0, QUEUED: 0, HELD: 0, EXCLUDED: 0 } as Record<string, number>;
  for (const r of rows ?? []) { t[r.disposition] = Number(r.n); t.fetched += Number(r.n); }
  return t;
}

/** Sources with at least one article on the day, for the filter dropdown —
 *  each carrying its brief-link number where one maps. */
export const getDaySources = (day: string) =>
  tryQuery<{ id: string; name: string; brief_n: number | null; n: string }>(
    `SELECT s.id::text, s.name,
            (SELECT min(bl.n) FROM brief_links bl WHERE bl.source_id = s.id) AS brief_n,
            count(*)::text AS n
     FROM articles a JOIN sources s ON s.id = a.source_id
     WHERE (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')::date = $1::date
     GROUP BY s.id, s.name ORDER BY count(*) DESC`, [day]
  );

/** The days that have any articles, newest first, for the day chips. */
export const getAuditDayList = () =>
  tryQuery<{ day: string }>(
    `SELECT DISTINCT (coalesce(published_at, fetched_at) AT TIME ZONE 'Australia/Melbourne')::date::text AS day
     FROM articles ORDER BY 1 DESC LIMIT 14`
  );

/** Pipeline readiness — what the report will have to work with at 05:00. */
export interface PipelineReadiness {
  articles_24h: number;
  analysed_24h: number;
  qualifying: number;
  categories: number;
}

export const getPipelineReadiness = async () => {
  const rows = await tryQuery<PipelineReadiness>(
    `SELECT
       count(*) FILTER (WHERE a.fetched_at > now() - interval '24 hours')::int AS articles_24h,
       count(an.article_id) FILTER (WHERE a.fetched_at > now() - interval '24 hours')::int AS analysed_24h,
       count(*) FILTER (WHERE a.fetched_at > now() - interval '24 hours'
                          AND a.report_eligible AND an.relevance_score >= 1)::int AS qualifying,
       count(DISTINCT s.category) FILTER (WHERE a.fetched_at > now() - interval '24 hours'
                                            AND a.report_eligible AND an.relevance_score >= 1)::int AS categories
     FROM articles a
     JOIN sources s ON s.id = a.source_id
     LEFT JOIN article_analysis an ON an.article_id = a.id`
  );
  return rows?.[0] ?? null;
};

export interface TodayReport {
  report_date: string;
  status: string;
  item_count: number;
  sent_at: string | null;
}

export const getLatestReport = async () => {
  const rows = await tryQuery<TodayReport>(
    `SELECT report_date::text, status::text, item_count, sent_at::text
     FROM reports ORDER BY report_date DESC LIMIT 1`
  );
  return rows?.[0] ?? null;
};

export interface HealthRow {
  service: string;
  status: string;
  detail: string | null;
  checked_at: string;
}

/** Latest row per service. */
export const getHealth = () =>
  tryQuery<HealthRow>(
    `SELECT DISTINCT ON (service) service, status::text, detail, checked_at::text
     FROM integration_health ORDER BY service, checked_at DESC`
  );

export interface IncidentSummaryRow {
  id: number;
  detected_at: string;
  workflow: string;
  rule_id: string | null;
  action: string;
  outcome: string;
  detail: string | null;
  resolved_at: string | null;
}

/** Open or recent incidents for architecture & ops health overlays. */
export const getRecentIncidents = () =>
  tryQuery<IncidentSummaryRow>(
    `SELECT id, detected_at::text, workflow, rule_id, action::text, outcome::text, detail, resolved_at::text
     FROM incidents
     ORDER BY detected_at DESC
     LIMIT 30`
  );

export function pct(p: { total: number; done: number }) {
  return p.total === 0 ? 0 : Math.round((p.done / p.total) * 100);
}

export function statusOf(deliverables: Deliverable[]): WorkStatus {
  if (deliverables.length === 0) return 'not_started';
  if (deliverables.some(d => d.status === 'blocked')) return 'blocked';
  if (deliverables.every(d => d.status === 'done')) return 'done';
  if (deliverables.some(d => d.status !== 'not_started')) return 'in_progress';
  return 'not_started';
}

/** Most recently scored articles — the live view of what the pipeline is doing. */
export interface ScoredArticle {
  id: number;
  title: string;
  url: string;
  source_name: string;
  category: string;
  relevance_score: number;
  summary: string;
  fetched_at: string;
}

export const getRecentScored = () =>
  tryQuery<ScoredArticle>(
    `SELECT a.id, a.title, a.url, s.name AS source_name, s.category,
            an.relevance_score, an.summary, a.fetched_at::text
     FROM article_analysis an
     JOIN articles a ON a.id = an.article_id
     JOIN sources  s ON s.id = a.source_id
     ORDER BY an.analysed_at DESC
     LIMIT 25`
  );

/** An article that actually reached the recipient, with the sheet it went out in. */
export interface SentArticle extends ScoredArticle {
  report_date: string;
  rank: number;
}

/**
 * What was actually delivered — the main panel shows this rather than whatever
 * was scored most recently, because the question being asked of this page is
 * "what did the client receive", not "what has the scorer touched".
 * Newest sheet first, and within a sheet the order the client read them in.
 */
export const getSentArticles = () =>
  tryQuery<SentArticle>(
    `SELECT a.id, a.title, a.url, s.name AS source_name, ri.category,
            coalesce(an.relevance_score, 0) AS relevance_score,
            coalesce(an.summary, '')        AS summary,
            a.fetched_at::text,
            r.report_date::text, ri.rank
     FROM report_items ri
     JOIN reports  r ON r.id = ri.report_id AND r.status = 'sent'
     JOIN articles a ON a.id = ri.article_id
     JOIN sources  s ON s.id = a.source_id
     LEFT JOIN article_analysis an ON an.article_id = a.id
     ORDER BY r.report_date DESC, ri.rank
     LIMIT 60`
  );

export interface ReportReference {
  report_date: string;
  source_name: string;
  source_url: string;
  method: string;
  satisfied_by_tier: number | null;
  items: number;
}

/**
 * Which sources fed each sheet, and the page each was read from.
 *
 * This is deliberately dashboard-only. The sheet the client receives carries
 * headlines and article links; it should not carry our plumbing — which index
 * page we scraped and by what route is an operational detail, and printing it in
 * a client deliverable would be noise at best.
 *
 * Here it answers the question that keeps coming up: an article appeared, where
 * did it actually come from.
 */
export const getReportReferences = () =>
  tryQuery<ReportReference>(
    `SELECT r.report_date::text,
            s.name AS source_name,
            coalesce(s.config->>'feed_url', s.url) AS source_url,
            s.method::text AS method,
            s.satisfied_by_tier,
            count(*)::int AS items
     FROM report_items ri
     JOIN reports  r ON r.id = ri.report_id AND r.status = 'sent'
     JOIN articles a ON a.id = ri.article_id
     JOIN sources  s ON s.id = a.source_id
     GROUP BY r.report_date, s.name, s.config, s.url, s.method, s.satisfied_by_tier
     ORDER BY r.report_date DESC, count(*) DESC, s.name
     LIMIT 200`
  );

/** Score distribution, so the panel shows the filter is doing real work. */
export const getScoreBands = () =>
  tryQuery<{ band: string; n: number }>(
    `SELECT CASE WHEN relevance_score >= 80 THEN '80-100'
                 WHEN relevance_score >= 60 THEN '60-79'
                 WHEN relevance_score >= 40 THEN '40-59'
                 ELSE 'below 40' END AS band,
            count(*)::int AS n
     FROM article_analysis GROUP BY 1 ORDER BY 1 DESC`
  );

/** Filters the scoring browser accepts. */
export interface ScoredFilter {
  q?: string;          // free text over title and summary
  band?: string;       // '80', '60', '40', 'below40'
  category?: string;
  sentOnly?: boolean;  // only articles that made it into a delivered report
}

export interface ScoredRow extends ScoredArticle {
  /** True when this article was included in a report that was actually sent. */
  in_report: boolean;
  report_date: string | null;
}

/** One page of scored articles, with the filters applied in SQL. */
export async function getScoredFiltered(
  f: ScoredFilter,
  offset: number,
  limit = 20
): Promise<{ rows: ScoredRow[]; total: number } | null> {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (f.q) {
    const like = p(`%${f.q}%`);
    where.push(`(a.title ILIKE ${like} OR an.summary ILIKE ${like})`);
  }
  if (f.band === '80') where.push('an.relevance_score >= 80');
  else if (f.band === '60') where.push('an.relevance_score BETWEEN 60 AND 79');
  else if (f.band === '40') where.push('an.relevance_score BETWEEN 40 AND 59');
  else if (f.band === 'below40') where.push('an.relevance_score < 40');
  if (f.category) where.push(`s.category = ${p(f.category)}`);
  // Only rows that reached a report that was genuinely sent, not merely rendered.
  if (f.sentOnly) where.push(`EXISTS (SELECT 1 FROM report_items ri JOIN reports r ON r.id = ri.report_id
                                      WHERE ri.article_id = a.id AND r.status = 'sent')`);

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await tryQuery<ScoredRow>(
    `SELECT a.id, a.title, a.url, s.name AS source_name, s.category,
            an.relevance_score, an.summary, a.fetched_at::text,
            EXISTS (SELECT 1 FROM report_items ri JOIN reports r ON r.id = ri.report_id
                    WHERE ri.article_id = a.id AND r.status = 'sent') AS in_report,
            (SELECT max(r.report_date)::text FROM report_items ri JOIN reports r ON r.id = ri.report_id
             WHERE ri.article_id = a.id AND r.status = 'sent') AS report_date
     FROM article_analysis an
     JOIN articles a ON a.id = an.article_id
     JOIN sources  s ON s.id = a.source_id
     ${clause}
     ORDER BY an.analysed_at DESC
     OFFSET ${p(offset)} LIMIT ${p(limit)}`,
    params
  );
  if (rows === null) return null;

  const totalRows = await tryQuery<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM article_analysis an
     JOIN articles a ON a.id = an.article_id
     JOIN sources  s ON s.id = a.source_id
     ${clause}`,
    params.slice(0, params.length - 2)
  );
  return { rows, total: totalRows?.[0]?.n ?? 0 };
}

/** Categories present, for the filter dropdown. */
export const getCategories = () =>
  tryQuery<{ category: string }>(
    `SELECT DISTINCT category FROM sources ORDER BY category`
  );

export const getScoredCount = async () => {
  const rows = await tryQuery<{ n: number }>(
    `SELECT count(*)::int AS n FROM article_analysis`
  );
  return rows?.[0]?.n ?? 0;
};

// ── Meeting pipeline ─────────────────────────────────────────────────────────

export interface MeetingRow {
  // Unique per meeting OCCURRENCE. meeting_id is NOT unique — a recurring
  // series shares one across every occurrence (migration 013), so this is the
  // row identity and the React key.
  transcript_id: string | null;
  meeting_id: string;
  subject: string;
  organiser_upn: string | null;
  started_at: string | null;
  status: 'transcribed' | 'drafted' | 'failed';
  attendee_count: number;
  transcript_path: string | null;
  minutes_path: string | null;
  draft_message_id: string | null;
  posted_at: string | null;
  post_error: string | null;
  error: string | null;
  folder_url: string | null;
  minutes_url: string | null;
  summary_url: string | null;
  transcript_url: string | null;
  minutes_pdf_url: string | null;
  summary_pdf_url: string | null;
  transcript_pdf_url: string | null;
  sent_at: string | null;
  has_extract: boolean;
  updated_at: string;
}

/**
 * Every meeting the pipeline has seen. Ordered newest first — the reason anyone
 * opens this page is to check the meeting they just had.
 */
export const getMeetings = () =>
  tryQuery<MeetingRow>(
    `SELECT transcript_id, meeting_id, subject, organiser_upn, started_at::text, status::text,
            coalesce(array_length(attendees, 1), 0) AS attendee_count,
            transcript_path, minutes_path, draft_message_id,
            posted_at::text, post_error, error,
            folder_url, minutes_url, summary_url, transcript_url,
            minutes_pdf_url, summary_pdf_url, transcript_pdf_url, sent_at::text,
            (extracted IS NOT NULL AND extracted::text <> '{}') AS has_extract,
            updated_at::text
       FROM meeting_minutes
      ORDER BY coalesce(started_at, created_at) DESC`
  );

export interface MeetingReadiness {
  total: number;
  drafted: number;
  failed: number;
  posted: number;
  sent: number;
  participants: number;
  last_success: string | null;
  last_attempt: string | null;
}

/** What the pipeline would have to work with right now. */
export const getMeetingReadiness = async () => {
  const rows = await tryQuery<MeetingReadiness>(
    `SELECT count(*)::int                                              AS total,
            count(*) FILTER (WHERE status = 'drafted')::int            AS drafted,
            count(*) FILTER (WHERE status = 'failed')::int             AS failed,
            count(*) FILTER (WHERE posted_at IS NOT NULL)::int         AS posted,
            count(*) FILTER (WHERE sent_at IS NOT NULL)::int            AS sent,
            (SELECT count(*)::int FROM participants)                   AS participants,
            max(updated_at) FILTER (WHERE status <> 'failed')::text    AS last_success,
            max(updated_at)::text                                      AS last_attempt
       FROM meeting_minutes`
  );
  return rows?.[0] ?? null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Engagement C — content generation for LinkedIn
// ─────────────────────────────────────────────────────────────────────────────

export type CycleStatus =
  | 'queued_topics' | 'scanning' | 'topics_ready'
  | 'queued_drafts' | 'drafting' | 'drafts_ready'
  | 'approved' | 'published' | 'failed' | 'abandoned';

export interface CycleRow {
  id: number;
  window_start: string;
  window_end: string;
  trigger: 'schedule' | 'manual';
  status: CycleStatus;
  selected_topic_id: number | null;
  human_perspective: string | null;
  error: string | null;
  created_at: string;
  topic_count: number;
  draft_count: number;
}

/** Every cycle, newest first — the hub's activity list. */
export const getCycles = () =>
  tryQuery<CycleRow>(
    `SELECT c.id, c.window_start::text, c.window_end::text, c.trigger, c.status::text,
            c.selected_topic_id, c.human_perspective, c.error, c.created_at::text,
            (SELECT count(*)::int FROM content_topics t WHERE t.cycle_id = c.id)  AS topic_count,
            (SELECT count(*)::int FROM linkedin_drafts d WHERE d.cycle_id = c.id) AS draft_count
       FROM content_cycles c
      ORDER BY c.created_at DESC
      LIMIT 60`
  );

export const getCycle = async (id: number) => {
  const rows = await tryQuery<CycleRow>(
    `SELECT c.id, c.window_start::text, c.window_end::text, c.trigger, c.status::text,
            c.selected_topic_id, c.human_perspective, c.error, c.created_at::text,
            (SELECT count(*)::int FROM content_topics t WHERE t.cycle_id = c.id)  AS topic_count,
            (SELECT count(*)::int FROM linkedin_drafts d WHERE d.cycle_id = c.id) AS draft_count
       FROM content_cycles c WHERE c.id = $1`,
    [id]
  );
  return rows?.[0] ?? null;
};

export interface TopicRow {
  id: number;
  cycle_id: number;
  rank: number;
  title: string;
  rationale: string;
  angle: string | null;
  article_ids: number[];
  score: number | null;
  sources: { id: number; title: string; url: string; source: string }[];
}

/** A cycle's three ranked topics, each with its supporting sources resolved. */
export const getCycleTopics = (cycleId: number) =>
  tryQuery<TopicRow>(
    `SELECT t.id, t.cycle_id, t.rank, t.title, t.rationale, t.angle, t.article_ids, t.score,
            coalesce(
              (SELECT json_agg(json_build_object('id', a.id, 'title', a.title, 'url', a.url, 'source', s.name)
                               ORDER BY a.id)
                 FROM articles a JOIN sources s ON s.id = a.source_id
                WHERE a.id = ANY(t.article_ids)),
              '[]'::json) AS sources
       FROM content_topics t
      WHERE t.cycle_id = $1
      ORDER BY t.rank`,
    [cycleId]
  );

export interface DraftRow {
  id: number;
  cycle_id: number;
  variant: 'A' | 'B';
  recommended: boolean;
  formula: string;
  goal: string;
  hook: string;
  body: string;
  char_count: number;
  hashtags: string[];
  visual_concept: string | null;
  cta: string | null;
  destination_url: string | null;
  audit: { blockers?: { rule: string; detail: string }[]; warnings?: { rule: string; detail: string }[] };
  status: 'draft' | 'approved' | 'published' | 'rejected' | 'failed';
  final_copy: string | null;
  post_at: string | null;
  post_url: string | null;
  published_at: string | null;
  error: string | null;
  claims: { id: number; claim: string; verdict: string; source_url: string | null; source_quote: string | null }[];
}

/** A cycle's drafts, recommended first, each with its fact-check claims. */
export const getCycleDrafts = (cycleId: number) =>
  tryQuery<DraftRow>(
    `SELECT d.id, d.cycle_id, d.variant, d.recommended, d.formula, d.goal, d.hook, d.body,
            d.char_count, d.hashtags, d.visual_concept, d.cta, d.destination_url, d.audit,
            d.status::text, d.final_copy, d.post_at::text, d.post_url, d.published_at::text, d.error,
            coalesce(
              (SELECT json_agg(json_build_object('id', cc.id, 'claim', cc.claim, 'verdict', cc.verdict,
                                                 'source_url', cc.source_url, 'source_quote', cc.source_quote)
                               ORDER BY cc.id)
                 FROM content_claims cc WHERE cc.draft_id = d.id),
              '[]'::json) AS claims
       FROM linkedin_drafts d
      WHERE d.cycle_id = $1
      ORDER BY d.recommended DESC, d.variant`,
    [cycleId]
  );

export interface PublishedRow {
  id: number;
  cycle_id: number;
  variant: string;
  status: string;
  post_at: string | null;
  published_at: string | null;
  post_url: string | null;
  topic_title: string | null;
  observations: number;
}

/** Approved and published posts — the schedule and history view. */
export const getPublishedPosts = () =>
  tryQuery<PublishedRow>(
    `SELECT d.id, d.cycle_id, d.variant, d.status::text, d.post_at::text, d.published_at::text, d.post_url,
            t.title AS topic_title,
            (SELECT count(*)::int FROM linkedin_performance p WHERE p.draft_id = d.id) AS observations
       FROM linkedin_drafts d
       LEFT JOIN content_topics t ON t.id = d.topic_id
      WHERE d.status IN ('approved', 'published')
      ORDER BY coalesce(d.published_at, d.post_at) DESC NULLS LAST
      LIMIT 60`
  );

export interface VoiceRow {
  author: string;
  audience: string;
  fingerprint: string;
  pillars: string[];
  banned_terms: string[];
  always_rules: string[];
  never_rules: string[];
  cta_style: string | null;
  post_windows: { day: number; from: string; to: string }[];
}

export const getVoice = async () => {
  const rows = await tryQuery<VoiceRow>(
    `SELECT author, audience, fingerprint, pillars, banned_terms, always_rules,
            never_rules, cta_style, post_windows
       FROM linkedin_voice WHERE id = 1`
  );
  return rows?.[0] ?? null;
};

export interface ReportArticleRow {
  report_id: number;
  article_id: number;
  category: string;
  rank: number;
  title: string;
  url: string;
  source: string;
  score: number | null;
  used: boolean;
}

/**
 * The articles behind one daily report, for the source-feed accordion. `used`
 * flags an article that already ended up in a drafted topic, so the feed does
 * not quietly recycle the same story.
 *
 * Takes a single report id, not an array: an `= ANY($1::int[])` array parameter
 * returned zero rows through the standalone build's bundled pg (it works in psql,
 * so the difference is the array-param encoding), and the accordion only ever
 * needs one report at a time. A scalar `= $1` is unambiguous and correct.
 */
export const getReportArticles = (reportId: number) =>
  tryQuery<ReportArticleRow>(
    `SELECT ri.report_id, a.id AS article_id, ri.category, ri.rank,
            a.title, a.url, s.name AS source, an.relevance_score AS score,
            -- "used" means the article ended up in a topic a cycle selected and
            -- drafted. article_ids live on content_topics, not on the drafts.
            EXISTS (
              SELECT 1 FROM content_topics t
               JOIN content_cycles c ON c.selected_topic_id = t.id
              WHERE a.id = ANY(t.article_ids)
            ) AS used
       FROM report_items ri
       JOIN articles a  ON a.id = ri.article_id
       JOIN sources s   ON s.id = a.source_id
       LEFT JOIN article_analysis an ON an.article_id = a.id
      WHERE ri.report_id = $1
      ORDER BY ri.category, ri.rank`,
    [reportId]
  );

/* ── The next send, before it happens ──────────────────────────────────────
 *
 * The delivered sheets show what the client received. This shows what they are
 * about to receive, using the same gates the report itself applies: the window
 * and its two-day reach-back, the gather cutoff at midnight, the exactly-once
 * ledger, and the four inclusion rules.
 *
 * The gates are duplicated here rather than shared, because the report's copy
 * lives inside an n8n Code node and the dashboard cannot import it. That is
 * exactly how the audit and the dashboard drifted apart (R038), so the shape is
 * kept deliberately close to the original and `day_start` is a parameter, which
 * lets preflight run both over the same day and compare.
 */
export interface PreviewRow {
  id: string;
  title: string;
  url: string;
  source_name: string;
  category: string;
  score: number | null;
  body_chars: number;
  fetched_at: string;
}

const PREVIEW_SQL = `
  WITH win AS (SELECT $1::date AS day_start)
  SELECT a.id::text,
         a.title,
         coalesce(a.canonical_url, a.url) AS url,
         s.name AS source_name,
         s.category,
         an.relevance_score AS score,
         length(coalesce(a.body_text, ''))::int AS body_chars,
         to_char(a.fetched_at AT TIME ZONE 'Australia/Melbourne', 'DD Mon HH24:MI') AS fetched_at
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN article_analysis an ON an.article_id = a.id
   CROSS JOIN win w
   WHERE (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')
           >= w.day_start - interval '2 days'
     AND (coalesce(a.published_at, a.fetched_at) AT TIME ZONE 'Australia/Melbourne')
           <  w.day_start + interval '1 day'
     AND (a.fetched_at AT TIME ZONE 'Australia/Melbourne')
           <  w.day_start + interval '1 day'
     AND NOT EXISTS (
       SELECT 1 FROM report_items ri JOIN reports r ON r.id = ri.report_id
        WHERE ri.article_id = a.id AND r.status = 'sent')
     AND (coalesce(s.config->>'always_relevant', '') = 'true'
          OR coalesce(an.relevance_score, 0) >= 1)
     AND coalesce(a.content_kind::text, '') NOT IN ('reference', 'offtopic')
     AND NOT (a.date_state = 'none' AND coalesce(an.relevance_score, 0) = 0)
     AND a.report_eligible
   ORDER BY s.category, coalesce(an.relevance_score, 0) DESC,
            coalesce(a.published_at, a.fetched_at) DESC`;

/** The publication day the NEXT 05:00 send will cover.
 *
 *  Before 05:00 the next run still covers yesterday; after it, today. Shifting
 *  back five hours and truncating expresses that in one term. */
export const nextSendDayStart = () =>
  `date_trunc('day', (now() AT TIME ZONE 'Australia/Melbourne') - interval '5 hours')::date`;

export async function getNextSendPreview(dayStart?: string) {
  const day = dayStart
    ? [dayStart]
    : (await tryQuery<{ d: string }>(`SELECT ${nextSendDayStart()}::text AS d`))?.[0]?.d;
  const d = Array.isArray(day) ? day[0] : day;
  if (!d) return null;
  const rows = await tryQuery<PreviewRow>(PREVIEW_SQL, [d]);
  return rows ? { day: d, rows } : null;
}
