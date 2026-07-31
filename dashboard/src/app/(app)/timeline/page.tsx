import { getDeliverables, getMilestones, statusOf } from '@/lib/queries';
import { ENGAGEMENTS, PROJECT_START, type Engagement, type Milestone } from '@/lib/types';
import {
  ENGAGEMENT_WORK,
  PLAN,
  SETUP_LABEL,
  TOOLS,
  type SetupStatus,
} from '@/lib/platform';
import { Card, SetupPill, CostBadge, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Timeline & Plan — BEXT Platform' };

const LANES: Engagement[] = ['infrastructure', 'daily_report', 'business_structure'];
const DAY = 86_400_000;
const toDate = (s: string) => new Date(s + 'T00:00:00').getTime();
const fmt = (t: number) =>
  new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

const CHECKLIST_ORDER: SetupStatus[] = ['in_progress', 'configured', 'pending', 'optional'];

function bounds(milestones: Milestone[]) {
  const dated = [...milestones.map(m => m.due_date).filter((d): d is string => !!d), ...PLAN.map(p => p.due)];
  const start = toDate(PROJECT_START);
  const lastDue = dated.length ? Math.max(...dated.map(toDate)) : start + 30 * DAY;
  return { start, end: lastDue + 7 * DAY };
}

export default async function Timeline() {
  const [milestones, deliverables] = await Promise.all([getMilestones(), getDeliverables()]);

  const today = Date.now();
  const highlights = TOOLS.filter(t => t.thisWeek);

  return (
    <div className="space-y-6">
      {/* ── This week ─────────────────────────────────────────────── */}
      <Card
        title="This week — starter setup"
        subtitle="Standing up the BEXT automation platform: VPS, n8n stack, subdomain hosting and this dashboard."
        className="border-progress/25"
      >
        <ul className="space-y-2">
          {highlights.map(t => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/50 px-3 py-2.5"
            >
              <SetupPill status={t.status} />
              <span className="min-w-[12rem] flex-1 text-sm text-ink-100">{t.name}</span>
              {t.note && <span className="text-xs text-ink-400">{t.note}</span>}
            </li>
          ))}
        </ul>
      </Card>

      {/* ── Setup checklist ───────────────────────────────────────── */}
      <Card
        title="Setup checklist"
        subtitle="Everything the platform uses — what is configured, what is being worked on, what remains. Free unless marked."
      >
        <div className="space-y-5">
          {CHECKLIST_ORDER.map(status => {
            const items = TOOLS.filter(t => t.status === status);
            if (!items.length) return null;
            return (
              <div key={status}>
                <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-400">
                  {SETUP_LABEL[status]}
                  <span className="tnum rounded bg-ink-800 px-1.5 py-0.5 text-[10px]">{items.length}</span>
                </p>
                <ul className="divide-y divide-ink-800 rounded-lg border border-ink-800">
                  {items.map(t => (
                    <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                          t.status === 'configured'
                            ? 'border-ok/50 bg-ok/15 text-ok'
                            : 'border-ink-700 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-[11rem] flex-1 text-sm text-ink-100">{t.name}</span>
                      <span className="hidden text-xs text-ink-400 md:block md:max-w-[22rem] md:truncate">
                        {t.purpose}
                      </span>
                      <CostBadge cost={t.cost} paid={t.paid} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Engagement plans — what we're doing, per the briefs ───── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {ENGAGEMENT_WORK.map(w => {
          const meta = ENGAGEMENTS[w.engagement as Engagement];
          const dates = PLAN.filter(p => p.engagement === w.engagement);
          return (
            <Card key={w.engagement} className="flex flex-col">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.accent }} />
                <h2 className="text-sm font-semibold text-ink-100">{w.title}</h2>
              </div>
              <p className="mb-3 text-xs text-ink-400">{w.goal}</p>
              <ul className="mb-4 space-y-1.5">
                {w.activities.map(a => (
                  <li key={a} className="flex gap-2 text-xs text-ink-300">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-600" />
                    {a}
                  </li>
                ))}
              </ul>
              {dates.length > 0 && (
                <div className="mt-auto border-t border-ink-800 pt-3">
                  {dates.map(d => {
                    const overdue = toDate(d.due) < today;
                    return (
                      <p key={d.title} className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
                        <span className="text-ink-300">{d.title}</span>
                        <span className={`tnum shrink-0 ${overdue ? 'text-blocked' : 'text-ink-400'}`}>
                          {fmt(toDate(d.due))}
                        </span>
                      </p>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* ── Contracted deadlines strip ────────────────────────────── */}
      <Card title="Contracted deadlines" subtitle="Dates come straight from the two briefs.">
        <ul className="divide-y divide-ink-800">
          {[...PLAN]
            .sort((a, b) => a.due.localeCompare(b.due))
            .map(p => {
              const meta = ENGAGEMENTS[p.engagement as Engagement];
              const days = Math.round((toDate(p.due) - today) / DAY);
              return (
                <li key={`${p.engagement}-${p.title}`} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: meta.accent }} />
                  <div className="min-w-[14rem] flex-1">
                    <p className="text-sm text-ink-100">{p.title}</p>
                    <p className="text-xs text-ink-400">{meta.label}</p>
                  </div>
                  <span className={`text-xs tnum ${days < 0 ? 'text-blocked' : days <= 7 ? 'text-warn' : 'text-ink-400'}`}>
                    {days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`}
                  </span>
                  <span className="w-[5.5rem] shrink-0 text-right text-sm tnum text-ink-300">
                    {fmt(toDate(p.due))}
                  </span>
                </li>
              );
            })}
        </ul>
      </Card>

      {/* ── Live milestone detail (needs database) ────────────────── */}
      {milestones && deliverables ? (
        <Card title="Milestones (live)" subtitle="Tracked in PostgreSQL — full detail per milestone.">
          <ul className="divide-y divide-ink-800">
            {[...milestones]
              .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
              .map(m => {
                const own = deliverables.filter(d => d.milestone_id === m.id);
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span
                      className="h-8 w-[3px] shrink-0 rounded-full"
                      style={{ background: ENGAGEMENTS[m.engagement].accent }}
                    />
                    <div className="min-w-[14rem] flex-1">
                      <p className="text-sm text-ink-100">{m.title}</p>
                      {m.detail && <p className="mt-0.5 text-xs text-ink-400">{m.detail}</p>}
                    </div>
                    <span className="text-xs text-ink-400 tnum">
                      {own.filter(d => d.status === 'done').length}/{own.length}
                    </span>
                    <span className="w-[5.5rem] shrink-0 text-right text-sm tnum text-ink-300">
                      {m.due_date ? fmt(toDate(m.due_date)) : '—'}
                    </span>
                    <StatusPill status={own.length ? statusOf(own) : m.status} />
                  </li>
                );
              })}
          </ul>
        </Card>
      ) : (
        <Card className="border-ink-800">
          <p className="text-xs text-ink-400">
            Live milestone tracking connects to PostgreSQL on the VPS — not reachable from this
            host yet. The plan above is the contracted source of truth.
          </p>
        </Card>
      )}
    </div>
  );
}
