import type { ReportReference } from '@/lib/queries';

const TIER_LABEL = ['email', 'direct', 'browser', 'signed in', 'model'];

/**
 * Where each sheet's articles came from — the source, the exact page it was read
 * from, and the route that delivered it.
 *
 * Operational, not client-facing. The emailed sheet carries headlines and links
 * to the articles themselves; which index page we scraped is our business.
 */
export function SourceReferences({ rows }: { rows: ReportReference[] }) {
  if (!rows.length) {
    return <p className="text-sm text-ink-400">No sent sheets to trace yet.</p>;
  }

  const byDate = new Map<string, ReportReference[]>();
  for (const r of rows) {
    if (!byDate.has(r.report_date)) byDate.set(r.report_date, []);
    byDate.get(r.report_date)!.push(r);
  }
  // Most recent sheet expanded, the rest collapsed — the older ones are for
  // answering a specific question, not for scanning.
  const dates = [...byDate.entries()];

  return (
    <div className="space-y-3">
      {dates.map(([date, refs], i) => (
        <details key={date} open={i === 0} className="group rounded-lg border border-ink-800 bg-ink-900/40">
          <summary
            className="flex cursor-pointer list-none items-center gap-3 px-4 py-3
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-a"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
                 className="size-4 shrink-0 text-ink-400 transition group-open:rotate-90" aria-hidden="true">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-medium text-ink-100">
              {new Date(date).toLocaleDateString('en-AU', {
                weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
              })}
            </span>
            <span className="tnum text-xs text-ink-400">
              {refs.length} source{refs.length === 1 ? '' : 's'} ·{' '}
              {refs.reduce((n, r) => n + r.items, 0)} items
            </span>
          </summary>

          <div className="overflow-x-auto border-t border-ink-800">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-[10px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Read from</th>
                  <th className="px-4 py-2 font-medium">Route</th>
                  <th className="px-4 py-2 text-right font-medium">Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/60">
                {refs.map(r => (
                  <tr key={r.source_name}>
                    <td className="px-4 py-2 align-top text-ink-100">{r.source_name}</td>
                    <td className="px-4 py-2 align-top">
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-[12px] text-brief-a underline-offset-2 hover:underline
                                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-a"
                      >
                        {r.source_url.replace(/^https?:\/\//, '')}
                      </a>
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-400">
                        {r.method}
                      </span>
                    </td>
                    <td className="px-4 py-2 align-top text-ink-300">
                      {r.satisfied_by_tier !== null ? TIER_LABEL[r.satisfied_by_tier] : '—'}
                    </td>
                    <td className="tnum px-4 py-2 text-right align-top text-ink-300">{r.items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
