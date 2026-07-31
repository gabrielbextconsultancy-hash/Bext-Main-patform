import { getDeliverables, getMilestones, pct } from '@/lib/queries';
import { ENGAGEMENTS, type Engagement } from '@/lib/types';
import { Card, DatabaseDown, StatusPill, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

const ORDER: Engagement[] = ['daily_report', 'business_structure', 'infrastructure'];

const fmt = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

export default async function Deliverables() {
  const [milestones, deliverables] = await Promise.all([getMilestones(), getDeliverables()]);
  if (!milestones || !deliverables) return <DatabaseDown />;

  const milestoneById = new Map(milestones.map(m => [m.id, m]));
  const doneTotal = deliverables.filter(d => d.status === 'done').length;

  return (
    <div className="space-y-6">
      <Card
        title="Coverage"
        subtitle="Every outcome the two briefs ask for, and where it stands."
      >
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <p className="text-2xl font-semibold tnum">
              {doneTotal}
              <span className="text-ink-400">/{deliverables.length}</span>
            </p>
            <p className="text-xs text-ink-400">complete overall</p>
          </div>
          {ORDER.map(e => {
            const own = deliverables.filter(d => d.engagement === e);
            const done = own.filter(d => d.status === 'done').length;
            return (
              <div key={e}>
                <p className="flex items-baseline gap-2 text-sm">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: ENGAGEMENTS[e].accent }}
                  />
                  <span className="tnum font-medium">
                    {pct({ total: own.length, done })}%
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink-400">{ENGAGEMENTS[e].short}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {ORDER.map(engagement => {
        const own = deliverables.filter(d => d.engagement === engagement);
        if (own.length === 0) return null;

        // Group under the milestone each deliverable is due at.
        const groups = new Map<number | null, typeof own>();
        for (const d of own) {
          const key = d.milestone_id;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(d);
        }

        return (
          <Card key={engagement} title={ENGAGEMENTS[engagement].label}>
            <div className="space-y-6">
              {[...groups.entries()].map(([milestoneId, items]) => {
                const m = milestoneId ? milestoneById.get(milestoneId) : null;
                return (
                  <div key={String(milestoneId)}>
                    <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-ink-800 pb-1.5">
                      <h3 className="text-xs font-medium uppercase tracking-wider text-ink-400">
                        {m ? m.title : 'Unassigned'}
                      </h3>
                      {m?.due_date && (
                        <span className="shrink-0 text-xs tnum text-ink-400">
                          due {fmt(m.due_date)}
                        </span>
                      )}
                    </div>
                    <ul className="divide-y divide-ink-800/60">
                      {items.map(d => (
                        <li key={d.id} className="flex items-start gap-3 py-2.5">
                          <StatusPill status={d.status} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-ink-100">
                              {d.title}
                              {d.brief_ref && (
                                <span className="ml-2 rounded bg-ink-850 px-1.5 py-0.5 text-[10px] text-ink-400">
                                  {d.brief_ref}
                                </span>
                              )}
                            </p>
                            {d.description && (
                              <p className="mt-1 text-xs leading-relaxed text-ink-400">
                                {d.description}
                              </p>
                            )}
                            {d.evidence_url && (
                              <a
                                href={d.evidence_url}
                                className="mt-1 inline-block text-xs text-progress underline underline-offset-4"
                              >
                                evidence
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {deliverables.length === 0 && <Empty>No deliverables seeded.</Empty>}
    </div>
  );
}
