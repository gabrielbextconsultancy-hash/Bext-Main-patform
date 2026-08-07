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
    `SELECT id, slug, name, category, method, active, last_fetch_at::text,
            last_status, consecutive_failures,
            coalesce((config->>'requires_browser')::boolean, false) AS requires_browser,
            config->>'note' AS note
     FROM sources ORDER BY category, name`
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
