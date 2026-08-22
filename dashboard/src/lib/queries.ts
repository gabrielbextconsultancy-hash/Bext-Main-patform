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
                          AND an.relevance_score >= 40)::int AS qualifying,
       count(DISTINCT s.category) FILTER (WHERE a.fetched_at > now() - interval '24 hours'
                                            AND an.relevance_score >= 40)::int AS categories
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
    `SELECT meeting_id, subject, organiser_upn, started_at::text, status::text,
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
