export type Engagement = 'infrastructure' | 'daily_report' | 'business_structure';
export type WorkStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';

export interface Milestone {
  id: number;
  engagement: Engagement;
  title: string;
  detail: string | null;
  due_date: string | null;
  is_contracted: boolean;
  status: WorkStatus;
  sort_order: number;
}

export interface Deliverable {
  id: number;
  engagement: Engagement;
  milestone_id: number | null;
  title: string;
  description: string | null;
  status: WorkStatus;
  evidence_url: string | null;
  brief_ref: string | null;
  sort_order: number;
}

export interface SourceRow {
  id: number;
  slug: string;
  name: string;
  category: string;
  method: 'rss' | 'scrape' | 'api';
  active: boolean;
  last_fetch_at: string | null;
  last_status: 'ok' | 'empty' | 'error' | 'never_run';
  consecutive_failures: number;
}

export const ENGAGEMENTS: Record<Engagement, { label: string; short: string; accent: string }> = {
  infrastructure: { label: 'Infrastructure', short: 'Infra', accent: 'var(--accent-infra)' },
  daily_report: { label: 'A — Industry Daily Report', short: 'Daily Report', accent: 'var(--accent-a)' },
  business_structure: { label: 'B — Business Structure Efficiency', short: 'Business Structure', accent: 'var(--accent-b)' },
};

export const STATUS_LABEL: Record<WorkStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

/** Milestones carry a due date but no start date. A bar has to start somewhere:
 *  it runs from the previous milestone in the same engagement, or from the
 *  engagement's first day if it is the first. Honest about being derived. */
export const PROJECT_START = '2026-07-28';
