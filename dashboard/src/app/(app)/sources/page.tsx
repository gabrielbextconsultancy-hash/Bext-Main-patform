import { getSources, getSourceSummary, getTierSummary } from '@/lib/queries';
import { TIER_LABELS } from '@/lib/types';
import { Card, DatabaseDown, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  ok: 'text-ok',
  empty: 'text-warn',
  error: 'text-blocked',
  never_run: 'text-ink-400',
};

/** The page body, exported so the merged pipeline page can render it as a tab. */
export async function SourcesView({
  // Where a source name should lead. Standalone this is the audit page; inside
  // the pipeline it is the management tab, so the click stays on the tab strip.
  articlesHref = (id: number | string) => `/audit?src=${id}`,
}: {
  articlesHref?: (id: number | string) => string;
} = {}) {
  const [sources, summary, tiers] = await Promise.all([
    getSources(),
    getSourceSummary(),
    getTierSummary(),
  ]);
  if (!sources) return <DatabaseDown />;

  // A source with no successful tier is the one case that must not be quiet:
  // it means every route was tried and none of them worked.
  const exhausted = sources.filter(s => s.active && s.satisfied_by_tier === null && s.tiers?.length);

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

      <Card
        title="How the last run got its articles"
        subtitle="Each source escalates through five routes and stops at the first that delivers. A route that never had to run is not a route that failed."
      >
        {tiers?.length ? (
          <div className="space-y-2">
            {tiers.map(t => (
              <div key={t.tier} className="flex items-baseline gap-3 text-sm">
                <span className="tnum w-8 text-right text-ink-100">{t.sources}</span>
                <span className="text-ink-400">{TIER_LABELS[t.tier]}</span>
              </div>
            ))}
            {exhausted.length > 0 && (
              <div className="mt-3 border-t border-ink-800 pt-3 text-sm">
                <span className="tnum w-8 text-right text-blocked">{exhausted.length}</span>
                <span className="ml-3 text-blocked">
                  exhausted every route — {exhausted.map(s => s.name).join(', ')}
                </span>
              </div>
            )}
          </div>
        ) : (
          <Empty>No run recorded yet since per-route logging began.</Empty>
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
                  <th className="pb-2 font-medium">Route</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/60">
                {items.map(s => (
                  <tr key={s.id} className={s.active ? '' : 'opacity-45'}>
                    <td className="py-2 pr-4">
                      {/* The third edge of the triangle. Sources explains how a
                          feed is reached; the management table shows what it
                          actually produced. Without this the two sat side by
                          side and had to be joined by hand. */}
                      <a
                        href={articlesHref(s.id)}
                        className="text-ink-100 underline-offset-2 hover:text-brief-a hover:underline"
                        title="See every article this source produced"
                      >
                        {s.name}
                      </a>
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
                    <td className="py-2 pr-4">
                      <TierStrip tiers={s.tiers} satisfied={s.satisfied_by_tier} />
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

/**
 * The five routes, in escalation order, as they went on the last run.
 *
 * The point of showing skipped tiers rather than only the winner is that
 * "we stopped because we had what we needed" and "we never tried" look identical
 * otherwise — which is exactly how DCCEEW reported ok for weeks while returning
 * nothing at all.
 */
function TierStrip({ tiers, satisfied }: { tiers: string[] | null; satisfied: number | null }) {
  if (!tiers?.length) {
    return <span className="text-xs text-ink-400" title="No run recorded since attempt logging began">—</span>;
  }

  const byTier = new Map<number, { outcome: string; found: number }>();
  for (const entry of tiers) {
    const [tier, outcome, found] = entry.split(':');
    byTier.set(Number(tier), { outcome, found: Number(found) || 0 });
  }

  const MARK: Record<string, { glyph: string; className: string }> = {
    success: { glyph: '●', className: 'text-ok' },
    empty: { glyph: '○', className: 'text-warn' },
    refused: { glyph: '✕', className: 'text-blocked' },
    error: { glyph: '✕', className: 'text-blocked' },
    skipped: { glyph: '·', className: 'text-ink-400/50' },
  };

  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2, 3, 4].map(n => {
        const a = byTier.get(n);
        const mark = a ? (MARK[a.outcome] ?? MARK.skipped) : MARK.skipped;
        const label = TIER_LABELS[n];
        const detail = !a
          ? 'not recorded'
          : a.outcome === 'success'
            ? `delivered ${a.found} article${a.found === 1 ? '' : 's'}`
            : a.outcome;
        return (
          <span key={n} className={`text-sm leading-none ${mark.className}`} title={`${n}. ${label} — ${detail}`}>
            {mark.glyph}
          </span>
        );
      })}
      {satisfied !== null && (
        <span className="ml-1 text-[11px] text-ink-400" title={TIER_LABELS[satisfied]}>
          {['email', 'direct', 'browser', 'signed in', 'model'][satisfied]}
        </span>
      )}
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


/** The standalone /sources route. */
export default async function Sources() {
  return <SourcesView />;
}
