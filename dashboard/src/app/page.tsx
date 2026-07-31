import Link from 'next/link';
import {
  getDeliverables,
  getMilestones,
  getProgress,
  getSourceSummary,
  getLatestReport,
  getHealth,
  pct,
} from '@/lib/queries';
import { ENGAGEMENTS, type Engagement } from '@/lib/types';
import { Card, Ring, DatabaseDown, StatusPill, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

const ORDER: Engagement[] = ['daily_report', 'business_structure', 'infrastructure'];

function daysUntil(date: string) {
  const due = new Date(date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function formatDue(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
}

export default async function Overview() {
  const [milestones, deliverables, progress, sources, report, health] = await Promise.all([
    getMilestones(),
    getDeliverables(),
    getProgress(),
    getSourceSummary(),
    getLatestReport(),
    getHealth(),
  ]);

  if (!milestones || !deliverables || !progress) return <DatabaseDown />;

  const contracted = milestones
    .filter(m => m.is_contracted && m.due_date)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!));

  const byEngagement = new Map(progress.map(p => [p.engagement, p]));

  return (
    <div className="space-y-6">
      {/* Engagement progress */}
      <div className="grid gap-4 md:grid-cols-3">
        {ORDER.map(key => {
          const p = byEngagement.get(key) ?? { total: 0, done: 0, in_progress: 0, blocked: 0 };
          const meta = ENGAGEMENTS[key];
          const next = contracted.find(m => m.engagement === key);
          return (
            <div key={key} className="rounded-xl border border-ink-800 bg-ink-900/60 p-5">
              <div className="flex items-start gap-4">
                <Ring value={pct(p)} accent={meta.accent} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug">{meta.short}</p>
                  <p className="mt-1 text-xs text-ink-400 tnum">
                    {p.done} of {p.total} deliverables
                  </p>
                  {p.in_progress > 0 && (
                    <p className="mt-0.5 text-xs text-progress tnum">{p.in_progress} in progress</p>
                  )}
                  {p.blocked > 0 && (
                    <p className="mt-0.5 text-xs text-blocked tnum">{p.blocked} blocked</p>
                  )}
                </div>
              </div>
              {next?.due_date && (
                <p className="mt-4 border-t border-ink-800 pt-3 text-xs text-ink-400">
                  Next: <span className="text-ink-300">{next.title}</span>
                  {' · '}
                  <span className="tnum">{formatDue(next.due_date)}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Contracted dates */}
      <Card title="Contracted dates" subtitle="Every hard date in the two signed briefs.">
        <ul className="divide-y divide-ink-800">
          {contracted.map(m => {
            const d = daysUntil(m.due_date!);
            const urgent = d >= 0 && d <= 14;
            return (
              <li key={m.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <span
                  className="h-8 w-[3px] shrink-0 rounded-full"
                  style={{ background: ENGAGEMENTS[m.engagement].accent }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-100">{m.title}</p>
                  <p className="truncate text-xs text-ink-400">{ENGAGEMENTS[m.engagement].label}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm tnum text-ink-100">{formatDue(m.due_date!)}</p>
                  <p className={`text-xs tnum ${urgent ? 'text-warn' : 'text-ink-400'}`}>
                    {d < 0 ? `${-d} days ago` : d === 0 ? 'today' : `in ${d} days`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Daily report pipeline */}
        <Card title="Daily report" subtitle="Engagement A pipeline.">
          {sources ? (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat label="Sources" value={sources.active} />
                <Stat label="RSS" value={sources.rss} />
                <Stat label="Scraped" value={sources.scrape} />
              </div>
              <p className="mt-4 border-t border-ink-800 pt-3 text-xs text-ink-400">
                {report ? (
                  <>
                    Latest sheet <span className="text-ink-300 tnum">{report.report_date}</span>
                    {' — '}
                    {report.item_count} items, {report.status}
                  </>
                ) : (
                  'No report generated yet. The pipeline runs once ingest is live.'
                )}
              </p>
              {sources.failing > 0 && (
                <p className="mt-1 text-xs text-blocked tnum">
                  {sources.failing} source(s) failing three runs or more
                </p>
              )}
            </>
          ) : (
            <Empty>No sources seeded.</Empty>
          )}
        </Card>

        {/* Platform health */}
        <Card title="Platform" subtitle="Recorded by the health-check workflow.">
          {health && health.length > 0 ? (
            <ul className="space-y-2">
              {health.map(h => (
                <li key={h.service} className="flex items-center justify-between text-sm">
                  <span className="text-ink-300">{h.service.replace(/_/g, ' ')}</span>
                  <span
                    className={
                      h.status === 'up'
                        ? 'text-ok'
                        : h.status === 'degraded'
                          ? 'text-warn'
                          : 'text-blocked'
                    }
                  >
                    {h.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              Nothing recorded yet — the health-check workflow writes here every 15 minutes.
            </Empty>
          )}
        </Card>
      </div>

      {/* In flight */}
      <Card title="In progress" subtitle="What is actively being worked on.">
        {deliverables.some(d => d.status === 'in_progress' || d.status === 'blocked') ? (
          <ul className="space-y-2">
            {deliverables
              .filter(d => d.status === 'in_progress' || d.status === 'blocked')
              .map(d => (
                <li key={d.id} className="flex items-center gap-3 text-sm">
                  <StatusPill status={d.status} />
                  <span className="min-w-0 flex-1 truncate text-ink-300">{d.title}</span>
                  <span className="shrink-0 text-xs text-ink-400">
                    {ENGAGEMENTS[d.engagement].short}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <Empty>Nothing in flight.</Empty>
        )}
        <Link
          href="/deliverables"
          className="mt-4 inline-block text-xs text-ink-400 underline underline-offset-4 hover:text-ink-100"
        >
          All {deliverables.length} deliverables
        </Link>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-ink-850 py-3">
      <p className="text-xl font-semibold tnum">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
    </div>
  );
}
