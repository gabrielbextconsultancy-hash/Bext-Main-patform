import { getSources, getSourceSummary } from '@/lib/queries';
import { Card, DatabaseDown, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  ok: 'text-ok',
  empty: 'text-warn',
  error: 'text-blocked',
  never_run: 'text-ink-400',
};

export default async function Sources() {
  const [sources, summary] = await Promise.all([getSources(), getSourceSummary()]);
  if (!sources) return <DatabaseDown />;

  const byCategory = new Map<string, typeof sources>();
  for (const s of sources) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }

  return (
    <div className="space-y-6">
      <Card
        title="Source registry"
        subtitle="Every source named in the Industry Daily Report brief, with the URLs recovered from that document's hyperlinks."
      >
        {summary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Total" value={summary.total} />
            <Stat label="Active" value={summary.active} />
            <Stat label="RSS feed" value={summary.rss} />
            <Stat label="Scraped" value={summary.scrape} />
            <Stat label="Failing" value={summary.failing} tone={summary.failing ? 'bad' : undefined} />
          </div>
        ) : (
          <Empty>Nothing seeded.</Empty>
        )}
      </Card>

      {[...byCategory.entries()].map(([category, items]) => (
        <Card key={category} title={category} subtitle={`${items.length} sources`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 font-medium">Method</th>
                  <th className="pb-2 font-medium">Last fetch</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/60">
                {items.map(s => (
                  <tr key={s.id} className={s.active ? '' : 'opacity-45'}>
                    <td className="py-2 pr-4">
                      <span className="text-ink-100">{s.name}</span>
                      {!s.active && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-400">
                          inactive
                        </span>
                      )}
                      {s.note && (
                        <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-ink-400">
                          {s.note}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-ink-400">
                      {s.method}
                      {s.requires_browser && (
                        <span
                          className="ml-2 rounded bg-progress/12 px-1.5 py-0.5 text-[10px] text-progress"
                          title="Refuses plain HTTP requests — rendered through the headless browser service"
                        >
                          browser
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 tnum text-ink-400">
                      {s.last_fetch_at
                        ? new Date(s.last_fetch_at).toLocaleString('en-AU', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className={`py-2 ${STATUS_STYLE[s.last_status] ?? 'text-ink-400'}`}>
                      {s.last_status.replace('_', ' ')}
                      {s.consecutive_failures >= 3 && (
                        <span className="ml-2 tnum text-blocked">
                          ×{s.consecutive_failures}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <div className="rounded-lg bg-ink-850 px-3 py-3 text-center">
      <p className={`text-xl font-semibold tnum ${tone === 'bad' ? 'text-blocked' : ''}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
    </div>
  );
}
