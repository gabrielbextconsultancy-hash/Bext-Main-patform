import { getDeliverables, getMilestones, statusOf } from '@/lib/queries';
import { ENGAGEMENTS, PROJECT_START, type Engagement, type Milestone } from '@/lib/types';
import { Card, DatabaseDown, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

const LANES: Engagement[] = ['infrastructure', 'daily_report', 'business_structure'];

const DAY = 86_400_000;
const toDate = (s: string) => new Date(s + 'T00:00:00').getTime();

/** Chart runs from the project start to two weeks past the final milestone, so
 *  the last bar does not sit flush against the right edge. */
function bounds(milestones: Milestone[]) {
  const dated = milestones.map(m => m.due_date).filter((d): d is string => !!d);
  const start = toDate(PROJECT_START);
  const lastDue = dated.length ? Math.max(...dated.map(toDate)) : start + 30 * DAY;
  return { start, end: lastDue + 7 * DAY };
}

function monthTicks(start: number, end: number) {
  const ticks: { at: number; label: string }[] = [];
  const d = new Date(start);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  while (d.getTime() < end) {
    ticks.push({
      at: d.getTime(),
      label: d.toLocaleDateString('en-AU', { month: 'long' }),
    });
    d.setMonth(d.getMonth() + 1);
  }
  return ticks;
}

const fmt = (t: number) =>
  new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

export default async function Timeline() {
  const [milestones, deliverables] = await Promise.all([getMilestones(), getDeliverables()]);
  if (!milestones || !deliverables) return <DatabaseDown />;

  const { start, end } = bounds(milestones);
  const span = end - start;
  const pos = (t: number) => ((t - start) / span) * 100;

  const today = Date.now();
  const todayInRange = today >= start && today <= end;

  return (
    <div className="space-y-6">
      <Card
        title="Plan timeline"
        subtitle={`${fmt(start)} to ${fmt(end)} 2026. Bars run from the previous milestone in the same workstream; milestone dates are the contracted ones.`}
      >
        {/* Month scale */}
        <div className="relative mb-3 ml-0 h-5 border-b border-ink-800 md:ml-[210px]">
          {monthTicks(start, end).map(t => (
            <span
              key={t.at}
              className="absolute top-0 -translate-x-1/2 text-[11px] text-ink-400"
              style={{ left: `${pos(t.at)}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>

        <div className="space-y-6">
          {LANES.map(lane => {
            const meta = ENGAGEMENTS[lane];
            const laneMilestones = milestones
              .filter(m => m.engagement === lane)
              .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));

            return (
              <div key={lane} className="md:flex md:items-start md:gap-4">
                {/* Lane label */}
                <div className="mb-2 flex items-center gap-2 md:mb-0 md:w-[194px] md:shrink-0 md:pt-1">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: meta.accent }}
                  />
                  <span className="text-sm font-medium text-ink-100">{meta.short}</span>
                </div>

                {/* Bars */}
                <div className="relative flex-1 space-y-1.5">
                  {todayInRange && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-10 w-px bg-warn/60"
                      style={{ left: `${pos(today)}%` }}
                    />
                  )}

                  {laneMilestones.map((m, i) => {
                    // Undated internal milestones get the full lane width up to today.
                    const barEnd = m.due_date ? toDate(m.due_date) : today;
                    const prev = laneMilestones[i - 1];
                    const barStart = prev?.due_date ? toDate(prev.due_date) : start;
                    const left = pos(barStart);
                    const width = Math.max(pos(barEnd) - left, 1.5);

                    const own = deliverables.filter(d => d.milestone_id === m.id);
                    const state = own.length ? statusOf(own) : m.status;
                    const doneCount = own.filter(d => d.status === 'done').length;

                    return (
                      <div key={m.id} className="group relative h-9">
                        <div
                          className="absolute inset-y-0 flex items-center rounded-md px-2.5 ring-1 ring-inset transition group-hover:brightness-125"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: `color-mix(in srgb, ${meta.accent} 18%, transparent)`,
                            // @ts-expect-error CSS custom property
                            '--tw-ring-color': `color-mix(in srgb, ${meta.accent} 45%, transparent)`,
                          }}
                        >
                          <span className="truncate text-xs text-ink-100">{m.title}</span>
                        </div>

                        {/* Milestone pin at the due date */}
                        {m.due_date && (
                          <div
                            className="absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `${pos(barEnd)}%` }}
                          >
                            <span
                              className="block h-3 w-3 rotate-45 rounded-[2px] ring-2 ring-ink-950"
                              style={{
                                background: m.is_contracted ? meta.accent : 'var(--color-ink-600)',
                              }}
                            />
                          </div>
                        )}

                        {/* Detail on hover */}
                        <div
                          className="pointer-events-none absolute top-full z-30 mt-1 hidden w-64 rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs shadow-xl group-hover:block"
                          style={{ left: `min(${left}%, calc(100% - 16rem))` }}
                        >
                          <p className="font-medium text-ink-100">{m.title}</p>
                          {m.due_date && (
                            <p className="mt-1 text-ink-400 tnum">
                              Due {fmt(toDate(m.due_date))}
                              {m.is_contracted ? ' · contracted' : ' · internal'}
                            </p>
                          )}
                          {own.length > 0 && (
                            <p className="mt-1 text-ink-400 tnum">
                              {doneCount} of {own.length} deliverables done
                            </p>
                          )}
                          {m.detail && <p className="mt-2 text-ink-300">{m.detail}</p>}
                          <div className="mt-2">
                            <StatusPill status={state} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-800 pt-4 text-xs text-ink-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-brief-a" />
            contracted milestone
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-ink-600" />
            internal milestone
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-px bg-warn/60" />
            today
          </span>
          <span>Hover a bar for detail.</span>
        </div>
      </Card>

      {/* Milestone list — the same data, readable without hovering */}
      <Card title="Milestones" subtitle="Contracted dates come straight from the briefs.">
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
    </div>
  );
}
