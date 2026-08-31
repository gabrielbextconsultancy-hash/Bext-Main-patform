import type { SourcePulse } from '@/lib/queries';

/**
 * The brief's links, alive or not, at a glance — shared by the Sources tab and
 * the Daily report so both read from the same pulse and cannot disagree.
 *
 * Three states, deliberately by ARTICLE COUNT rather than fetch status: a fetch
 * can be green while the source hands back a page shell, which is exactly how
 * VicGrid served forty navigation links and zero news. Producing means articles
 * arrived within three days; quiet means mapped and active but nothing came,
 * which is either a publisher that posts weekly or a listing that needs the
 * sitemap remedy; inactive is a deliberate registry decision with its reason.
 */
export function SourcePulseCard({ pulse }: { pulse: SourcePulse }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850/40 p-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-[11px] uppercase tracking-wider text-ink-400">Brief links, live</span>
        <span className="text-green-300">
          <b className="tnum">{pulse.producing}</b> producing
        </span>
        <span className="text-amber-300">
          <b className="tnum">{pulse.quiet}</b> quiet 3 days
        </span>
        <span className="text-ink-400">
          <b className="tnum">{pulse.inactive}</b> inactive
        </span>
      </div>

      {/* What the three states MEAN, on the card rather than in a wiki: the
          numbers are only useful if the reader knows quiet is not failure. */}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
        Producing = at least one article held from the last 3 days. Quiet = checked and
        answering, but no articles held — a publisher that posts occasionally, a listing that
        hands back navigation instead of stories, or history cleared by a prune. Inactive =
        switched off in the registry on purpose; the reason is recorded beside it.
      </p>

      {pulse.quiet > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-amber-300/80 hover:text-amber-300">
            which are quiet, and since when
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-300">
            {pulse.quiet_list.map(q => (
              <li key={q.name}>
                {q.brief_n ? `#${q.brief_n} · ` : ''}{q.name}
                <span className="text-ink-500">
                  {' '}[{q.method}] · {q.last_article
                    ? `last article held ${q.last_article}`
                    : 'no articles held'} · checked {q.last_checked ?? 'never'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pulse.inactive > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
            which are inactive, and why
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-400">
            {pulse.inactive_list.map(q => (
              <li key={q.name}>
                {q.brief_n ? `#${q.brief_n} · ` : ''}{q.name}
                {q.note && <span className="text-ink-500"> — {q.note.slice(0, 110)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
