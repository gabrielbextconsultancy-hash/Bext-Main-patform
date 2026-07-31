import { byCategory, setupCounts, TOOLS } from '@/lib/platform';
import { Card, CostBadge, SetupPill } from '@/components/ui';

export const metadata = { title: 'Connection Health — BEXT Platform' };

export default function Health() {
  const counts = setupCounts();
  const groups = byCategory();
  const highlights = TOOLS.filter(t => t.thisWeek);

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <Card
        title="Connection health"
        subtitle="Every tool and configuration in the BEXT platform, and where it stands."
      >
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <p className="text-2xl font-semibold tnum text-ok">{counts.configured}</p>
            <p className="text-xs text-ink-400">configured</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tnum text-progress">{counts.in_progress}</p>
            <p className="text-xs text-ink-400">in progress</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tnum text-warn">{counts.pending}</p>
            <p className="text-xs text-ink-400">pending</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tnum text-ink-400">{counts.optional}</p>
            <p className="text-xs text-ink-400">optional</p>
          </div>
          <div className="ml-auto">
            <p className="text-2xl font-semibold tnum">
              {counts.configured}
              <span className="text-ink-400">/{counts.total - counts.optional}</span>
            </p>
            <p className="text-xs text-ink-400">core stack ready</p>
          </div>
        </div>
      </Card>

      {/* This week focus */}
      <Card
        title="This week"
        subtitle="Current sprint — starter setup for the BEXT automation platform."
        className="border-progress/25"
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {highlights.map(t => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/50 px-3 py-2.5"
            >
              <SetupPill status={t.status} />
              <span className="truncate text-sm text-ink-100">{t.name}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Tool cards by category */}
      {[...groups.entries()].map(([category, tools]) =>
        tools.length === 0 ? null : (
          <Card key={category} title={category}>
            <div className="grid gap-3 md:grid-cols-2">
              {tools.map(t => (
                <div
                  key={t.id}
                  className="rounded-lg border border-ink-800 bg-ink-950/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-ink-100">{t.name}</p>
                    <SetupPill status={t.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-400">{t.purpose}</p>
                  {t.endpoint && (
                    <p className="mt-2 truncate font-mono text-[11px] text-ink-300">
                      {t.endpoint}
                    </p>
                  )}
                  {t.note && <p className="mt-1.5 text-[11px] text-ink-400">{t.note}</p>}
                  <div className="mt-2.5 flex items-center gap-2">
                    <CostBadge cost={t.cost} paid={t.paid} />
                    <span className="text-[10px] text-ink-600">owner: {t.owner}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )
      )}
    </div>
  );
}
