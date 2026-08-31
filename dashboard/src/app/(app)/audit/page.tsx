import {
  getManagementRows,
  getLiveTally,
  getDaySources,
  getDaySections,
  getAuditDayList,
  PAGE_SIZE,
  type ManagementRow,
} from '@/lib/queries';
import { Card, DatabaseDown, Empty } from '@/components/ui';
import { ArticleDetails } from '@/components/ArticleDetails';
import { FilterForm } from '@/components/FilterForm';

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

function qs(
  path: string,
  base: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

export interface AuditParams {
  day?: string; status?: string; src?: string; q?: string; page?: string; t?: string;
  section?: string; body?: string; dated?: string;
}

/** The page body, exported so the merged pipeline page can render it as a tab
 *  without this view and that one drifting into two implementations. */
export async function AuditView({
  sp,
  basePath = '/audit',
  // Params the host page needs kept on every link this view builds — the merged
  // pipeline page passes its tab here, so filtering or paging does not silently
  // navigate away from the tab the reader is on.
  extra = {},
}: {
  sp: AuditParams;
  basePath?: string;
  extra?: Record<string, string>;
}) {
  const { today, nextSend } = melbourne();
  const day = sp.day ?? today;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const renderedAt = new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  const [days, tally, sources, sections, result] = await Promise.all([
    getAuditDayList(),
    getLiveTally(day),
    getDaySources(day),
    getDaySections(day),
    getManagementRows({
      day, status: sp.status, src: sp.src, q: sp.q, page,
      section: sp.section, body: sp.body, dated: sp.dated,
    }),
  ]);
  if (days === null || sources === null) return <DatabaseDown />;

  const base = { ...extra, day, status: sp.status, src: sp.src, q: sp.q, section: sp.section, body: sp.body, dated: sp.dated };
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const tile = (label: string, n: number, status?: string) => (
    <a
      key={label}
      href={qs(basePath, base, { status, page: undefined })}
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
              href={qs(basePath, base, { t: String(Date.now()) })}
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
              href={qs(basePath, { ...base, status: undefined, src: undefined, q: undefined }, { day: d.day, page: undefined })}
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
          {tile(
            tally.analysed === tally.fetched
              ? 'analysed — all of them'
              : `analysed — ${tally.fetched - tally.analysed} still queued for the scorer`,
            tally.analysed,
            undefined,
          )}
          {tile('sent', tally.SENT, 'SENT')}
          {tile(`queued — go out ${nextSend}`, tally.QUEUED, 'QUEUED')}
          {tile('held', tally.HELD, 'HELD')}
          {tile('excluded (score 0)', tally.EXCLUDED, 'EXCLUDED')}
          {/* Publisher-dated versus assumed. "Confirmed" means the publisher
              itself dated the article to this day; "assumed" means no date was
              found and the day is merely when we fetched it - which is how old
              news wears today's date. These filter like the tiles above. */}
          <a
            href={qs(basePath, { ...base, status: undefined }, { dated: 'confirmed', page: undefined })}
            className={`flex-1 rounded-lg border px-3 py-2 ${
              sp.dated === 'confirmed' ? 'border-brief-a bg-brief-a/10' : 'border-ink-700 hover:border-ink-500'
            }`}
          >
            <span className="block text-lg font-bold text-green-300">{tally.confirmed}</span>
            <span className="text-xs text-ink-300">new — publisher dated it this day</span>
          </a>
          <a
            href={qs(basePath, { ...base, status: undefined }, { dated: 'assumed', page: undefined })}
            className={`flex-1 rounded-lg border px-3 py-2 ${
              sp.dated === 'assumed' ? 'border-brief-a bg-brief-a/10' : 'border-ink-700 hover:border-ink-500'
            }`}
          >
            <span className="block text-lg font-bold text-amber-300">{tally.assumed}</span>
            <span className="text-xs text-ink-300">day assumed — no date found, may be old</span>
          </a>
        </div>

        {/* Search + source filter. A plain GET form: no client code to break. */}
        <FilterForm action={basePath} className="mt-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="day" value={day} />
          {Object.entries(extra).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
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
          <select
            name="section"
            defaultValue={sp.section ?? ''}
            className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          >
            <option value="">every section</option>
            {(sections ?? []).map((c) => (
              <option key={c.category} value={c.category}>
                {c.category} ({c.n})
              </option>
            ))}
          </select>
          {/* What the summary was written from — the one dimension that says
              whether an item is worth reading or merely present. */}
          <select
            name="body"
            defaultValue={sp.body ?? ''}
            className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          >
            <option value="">read in full or teaser</option>
            <option value="article">read in full</option>
            <option value="teaser">teaser only</option>
          </select>
          <button
            type="submit"
            className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:border-brief-a"
          >
            Search
          </button>
          {(sp.q || sp.src || sp.status || sp.section || sp.body || sp.dated) && (
            <a href={qs(basePath, { ...extra, day }, {})} className="text-xs text-ink-400 hover:text-ink-200">
              clear filters
            </a>
          )}
        </FilterForm>
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
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Section</th>
                  <th className="px-2 py-2">Written from</th>
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

                    </td>
                    {/* The source, and how it was reached. A name explains
                        nothing on its own; the route, method and last successful
                        fetch are what answer "why did this give us this". */}
                    <td className="max-w-[15rem] px-2 py-2">
                      <a
                        href={qs(basePath, { ...extra, day }, { src: r.source_id, page: undefined })}
                        className="text-xs font-medium text-ink-200 hover:text-brief-a"
                      >
                        {r.brief_n ? `#${r.brief_n} · ` : ''}{r.source_name}
                      </a>
                      <ArticleDetails row={r} />
                    </td>
                    <td className="px-2 py-2">
                      <a
                        href={qs(basePath, { ...extra, day }, { section: r.category, page: undefined })}
                        className="whitespace-nowrap text-xs text-ink-400 hover:text-brief-a"
                      >
                        {r.category}
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      {r.body_chars > 200 ? (
                        <span className="text-green-300">
                          article · {r.body_chars.toLocaleString()} chars
                        </span>
                      ) : (
                        <span className="text-amber-300">teaser only</span>
                      )}
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
              <a href={qs(basePath, base, { page: String(page - 1) })} className="rounded border border-ink-700 px-3 py-1 hover:border-brief-a">
                ← prev
              </a>
            )}
            <span className="text-ink-400">page {page} of {pages}</span>
            {page < pages && (
              <a href={qs(basePath, base, { page: String(page + 1) })} className="rounded border border-ink-700 px-3 py-1 hover:border-brief-a">
                next →
              </a>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/** The standalone /audit route. The merged pipeline page renders AuditView
 *  directly, so both entry points share one implementation. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<AuditParams>;
}) {
  return <AuditView sp={await searchParams} />;
}
