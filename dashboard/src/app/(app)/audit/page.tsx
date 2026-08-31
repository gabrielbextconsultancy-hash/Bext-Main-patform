import {
  getManagementRows,
  getLiveTally,
  getDaySources,
  getAuditDayList,
  PAGE_SIZE,
  type ManagementRow,
} from '@/lib/queries';
import { Card, DatabaseDown, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * The daily-report management table.
 *
 * Every article of a publication day, live from the database: score, the
 * article with its link, disposition with reason, when it was fetched, and
 * when it goes out — filterable by disposition, source (with its brief-link
 * number), and title search, paginated. Live on purpose: the stored audit
 * snapshot is built at fixed times and made the numbers here disagree with
 * the numbers there; a management view must never argue with itself.
 */

const CHIP: Record<string, string> = {
  SENT: 'text-green-300 bg-green-900/40',
  QUEUED: 'text-blue-300 bg-blue-900/40',
  HELD: 'text-amber-300 bg-amber-900/40',
  EXCLUDED: 'text-ink-300 bg-ink-800',
};

function scoreClass(n: number | null) {
  if (n === null) return 'text-ink-300 bg-ink-800';
  if (n >= 80) return 'text-green-900 bg-green-200';
  if (n >= 55) return 'text-teal-900 bg-teal-200';
  if (n >= 20) return 'text-amber-900 bg-amber-200';
  return 'text-ink-700 bg-ink-300';
}

/** Melbourne "today", and the next 05:00 send for queued rows. */
function melbourne() {
  const mel = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }));
  const today = mel.toISOString().slice(0, 10);
  const next = new Date(mel);
  next.setHours(5, 0, 0, 0);
  if (mel >= next) next.setDate(next.getDate() + 1);
  const nextSend = next.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' 05:00';
  return { today, nextSend };
}

function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/audit?${s}` : '/audit';
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; status?: string; src?: string; q?: string; page?: string; t?: string }>;
}) {
  const sp = await searchParams;
  const { today, nextSend } = melbourne();
  const day = sp.day ?? today;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const renderedAt = new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  const [days, tally, sources, result] = await Promise.all([
    getAuditDayList(),
    getLiveTally(day),
    getDaySources(day),
    getManagementRows({ day, status: sp.status, src: sp.src, q: sp.q, page }),
  ]);
  if (days === null || sources === null) return <DatabaseDown />;

  const base = { day, status: sp.status, src: sp.src, q: sp.q };
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const tile = (label: string, n: number, status?: string) => (
    <a
      key={label}
      href={qs(base, { status, page: undefined })}
      className={`flex-1 rounded-lg border px-3 py-2 ${
        (sp.status ?? '') === (status ?? '')
          ? 'border-brief-a bg-brief-a/10'
          : 'border-ink-700 hover:border-ink-500'
      }`}
    >
      <span className="block text-lg font-bold text-ink-100">{n}</span>
      <span className="text-xs text-ink-300">{label}</span>
    </a>
  );

  return (
    <div className="space-y-5">
      <Card title="Daily report — management table">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-sm text-ink-300">
            Every article of the day, live: what was fetched, what each scored, what went out and
            when, what waits for the next 05:00, and what is held — with the brief link each source
            answers to. Queued items go out {nextSend}.
          </p>
          {/* The page reads the database on every load, so refreshing is the whole
              mechanism — no cache to bust. The stamp makes the freshness checkable
              rather than a claim: ingest lands hourly, scoring within the half hour. */}
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-ink-400">read at {renderedAt}</span>
            <a
              href={qs(base, { t: String(Date.now()) })}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200
                         hover:border-brief-a hover:text-brief-a"
            >
              ↻ Refresh
            </a>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(days ?? []).map((d) => (
            <a
              key={d.day}
              href={qs({ ...base, status: undefined, src: undefined, q: undefined }, { day: d.day, page: undefined })}
              className={`rounded-full border px-3 py-1 text-xs ${
                d.day === day
                  ? 'border-brief-a bg-brief-a/10 text-brief-a'
                  : 'border-ink-700 text-ink-300 hover:border-ink-500'
              }`}
            >
              {d.day}
            </a>
          ))}
        </div>

        {/* Disposition tiles double as filters; the active one highlights. */}
        <div className="mt-4 flex flex-wrap gap-2">
          {tile('fetched this day', tally.fetched, undefined)}
          {tile('sent', tally.SENT, 'SENT')}
          {tile(`queued — go out ${nextSend}`, tally.QUEUED, 'QUEUED')}
          {tile('held', tally.HELD, 'HELD')}
          {tile('excluded (score 0)', tally.EXCLUDED, 'EXCLUDED')}
        </div>

        {/* Search + source filter. A plain GET form: no client code to break. */}
        <form method="get" action="/audit" className="mt-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="day" value={day} />
          {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="search titles…"
            className="w-56 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-100
                       placeholder:text-ink-500 focus:border-brief-a focus:outline-none"
          />
          <select
            name="src"
            defaultValue={sp.src ?? ''}
            className="max-w-[22rem] rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          >
            <option value="">every source</option>
            {(sources ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.brief_n ? `#${s.brief_n} · ` : ''}{s.name} ({s.n})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:border-brief-a"
          >
            Filter
          </button>
          {(sp.q || sp.src || sp.status) && (
            <a href={qs({ day }, {})} className="text-xs text-ink-400 hover:text-ink-200">
              clear filters
            </a>
          )}
        </form>
      </Card>

      <Card title={`${result.total} article${result.total === 1 ? '' : 's'} · ${day}`}>
        {result.rows.length === 0 ? (
          <Empty>Nothing matches these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-[10px] uppercase tracking-wide text-ink-400">
                  <th className="px-2 py-2">Score</th>
                  <th className="px-2 py-2">Article</th>
                  <th className="px-2 py-2">Disposition</th>
                  <th className="px-2 py-2">Fetched</th>
                  <th className="px-2 py-2">Sent / will send</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r: ManagementRow) => (
                  <tr key={r.id} className="border-b border-ink-800/60 align-top">
                    <td className="px-2 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${scoreClass(r.score)}`}>
                        {r.score ?? '–'}
                      </span>
                    </td>
                    <td className="max-w-[30rem] px-2 py-2">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-brief-a hover:underline"
                      >
                        {r.title}
                      </a>
                      <div className="text-xs text-ink-400">
                        {r.brief_n ? `#${r.brief_n} · ` : ''}{r.source_name}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${CHIP[r.disposition]}`}>
                        {r.disposition}
                      </span>
                      <div className="max-w-[16rem] text-xs text-ink-400">{r.reason}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-300">{r.fetched_at}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      {r.disposition === 'SENT' ? (
                        <span className="text-green-300">{r.sent_at ?? r.sent_report}</span>
                      ) : r.disposition === 'QUEUED' ? (
                        <span className="text-blue-300">{nextSend}</span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            {page > 1 && (
              <a href={qs(base, { page: String(page - 1) })} className="rounded border border-ink-700 px-3 py-1 hover:border-brief-a">
                ← prev
              </a>
            )}
            <span className="text-ink-400">page {page} of {pages}</span>
            {page < pages && (
              <a href={qs(base, { page: String(page + 1) })} className="rounded border border-ink-700 px-3 py-1 hover:border-brief-a">
                next →
              </a>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
