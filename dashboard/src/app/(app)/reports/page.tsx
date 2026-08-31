import {
  getReports,
  getPipelineReadiness,
  getHealth,
  getSentArticles,
  type SentArticle,
  getScoreBands,
  getScoredCount,
  getCategories,
  getReportReferences,
  getNextSendPreview,
} from '@/lib/queries';
import { Card, DatabaseDown, Empty } from '@/components/ui';
import { ReportViewer } from '@/components/ReportViewer';
import { ScoredBrowser } from '@/components/ScoredBrowser';
import { SourceReferences } from '@/components/SourceReferences';

/** Next 05:00 Australia/Melbourne, expressed in that zone. */
function nextRun() {
  const now = new Date();
  const mel = new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }));
  const next = new Date(mel);
  next.setHours(5, 0, 0, 0);
  if (mel >= next) next.setDate(next.getDate() + 1);
  const hrs = Math.round((next.getTime() - mel.getTime()) / 3_600_000);
  return `${next.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} 05:00 — in about ${hrs}h`;
}

function Sched({
  name,
  when,
  detail,
  highlight,
}: {
  name: string;
  when: string;
  detail: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? 'border-ok/30 bg-ok/5' : 'border-ink-800 bg-ink-850/50'
      }`}
    >
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{name}</p>
      <p className={`mt-0.5 text-sm font-semibold ${highlight ? 'text-ok' : 'text-ink-100'}`}>
        {when}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-ink-500">{detail}</p>
    </div>
  );
}

export const dynamic = 'force-dynamic';
// Operational data — re-read on every request rather than serving a cached page.
export const revalidate = 0;

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  sent: { label: 'Sent', cls: 'bg-ok/12 text-ok ring-ok/25', dot: 'bg-ok' },
  rendered: { label: 'Rendered, not sent', cls: 'bg-warn/12 text-warn ring-warn/25', dot: 'bg-warn' },
  draft: { label: 'Draft', cls: 'bg-ink-800 text-ink-400 ring-ink-700', dot: 'bg-ink-600' },
  failed: { label: 'Failed', cls: 'bg-blocked/12 text-blocked ring-blocked/25', dot: 'bg-blocked' },
};

function Pill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.draft;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

const fmtTime = (t: string | null) =>
  t
    ? new Date(t).toLocaleString('en-AU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Australia/Melbourne',
      })
    : '—';

/**
 * Groups delivered articles by the sheet they went out in. The query already
 * orders by report_date DESC then rank, so insertion order is the display
 * order and a Map preserves it.
 */
function groupByDate(rows: SentArticle[]): [string, SentArticle[]][] {
  const byDate = new Map<string, SentArticle[]>();
  for (const r of rows) {
    const g = byDate.get(r.report_date);
    if (g) g.push(r);
    else byDate.set(r.report_date, [r]);
  }
  return [...byDate];
}

export interface ReportParams { sheet?: string }

/** The page body, exported so the merged pipeline page can render it as a tab. */
export async function ReportsView(_props: { sp?: ReportParams; basePath?: string; extra?: Record<string, string> } = {}) {


  const [reports, ready, health, delivered, bands, totalScored, cats, refs, preview] =
    await Promise.all([
      getReports(),
      getPipelineReadiness(),
      getHealth(),
      getSentArticles(),
      getScoreBands(),
      getScoredCount(),
      getCategories(),
      getReportReferences(),
      getNextSendPreview(),
    ]);

  if (!reports) return <DatabaseDown />;

  const sent = reports.filter(r => r.status === 'sent').length;
  const failed = reports.filter(r => r.status === 'failed').length;
  const lastRun = health?.find(h => h.service === 'daily_report');

  // The report only has something to say if analysis has scored enough of the
  // last day's articles — surfaced up front so an empty send is explainable.
  const gate = ready
    ? ready.qualifying > 0
      ? { pass: true, msg: `${ready.qualifying} articles across ${ready.categories} sections would be included right now.` }
      : ready.analysed_24h === 0
        ? { pass: false, msg: 'Nothing analysed in the last 24 hours — the analysis workflow has not scored new articles, so the report would be empty.' }
        : { pass: false, msg: `${ready.analysed_24h} articles analysed but none scored 40 or above, so nothing qualifies for the sheet.` }
    : null;

  return (
    <div className="space-y-5">

      {/* Readiness — the pass/fail check */}
      <Card
        title="Next run readiness"
        subtitle="The publication day the next 05:00 send covers — the same day the audit counts."
      >
        {ready ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Fetched this day" value={ready.articles_24h} />
              <Stat label="Analysed" value={ready.analysed_24h} />
              <Stat
                label="Qualifying (≥1)"
                value={ready.qualifying}
                tone={ready.qualifying > 0 ? 'good' : 'bad'}
              />
              <Stat label="Sections" value={ready.categories} />
            </div>
            {gate && (
              <div
                className={`mt-4 flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                  gate.pass
                    ? 'border-ok/25 bg-ok/5 text-ink-300'
                    : 'border-warn/25 bg-warn/5 text-ink-300'
                }`}
              >
                <span className={gate.pass ? 'text-ok' : 'text-warn'}>{gate.pass ? '✓' : '!'}</span>
                <span>{gate.msg}</span>
              </div>
            )}
          </>
        ) : (
          <Empty>No pipeline data.</Empty>
        )}
      </Card>

      {/* Last recorded run */}
      <Card title="Last recorded run" subtitle="Written by the workflow itself after each send.">
        {lastRun ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className={lastRun.status === 'up' ? 'text-ok' : 'text-blocked'}>
              {lastRun.status === 'up' ? 'Succeeded' : 'Failed'}
            </span>
            <span className="text-ink-400">{fmtTime(lastRun.checked_at)}</span>
            {lastRun.detail && <span className="text-ink-300">{lastRun.detail}</span>}
          </div>
        ) : (
          <Empty>
            The workflow has not completed a run yet — nothing has been written to
            integration_health.
          </Empty>
        )}
      </Card>

      {/* Before and after, both present. They answer different questions and are
          read at different moments — what is about to go at four in the
          afternoon, what went at nine the next morning — so neither should be
          hidden behind the other. */}
      <Card
        title="Before — goes out tomorrow 05:00"
        subtitle={`The ${preview?.rows.length ?? 0} articles queued for the next send. Nothing here has been emailed yet.`}
      >
        {preview && preview.rows.length > 0 ? (
            <>
              <p className="mb-3 text-xs text-ink-400">
                Covering the {preview.day} publication day. Everything gathered today waits for
                tomorrow&rsquo;s 05:00 — nothing fetched today is sent today.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 text-left text-[10px] uppercase tracking-wide text-ink-400">
                      <th className="px-2 py-2">Score</th>
                      <th className="px-2 py-2">Article</th>
                      <th className="px-2 py-2">Section</th>
                      <th className="px-2 py-2">Written from</th>
                      <th className="px-2 py-2">Fetched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map(r => (
                      <tr key={r.id} className="border-b border-ink-800/60 align-top">
                        <td className="px-2 py-2 tnum text-ink-300">{r.score ?? '–'}</td>
                        <td className="max-w-[32rem] px-2 py-2">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-brief-a hover:underline"
                          >
                            {r.title}
                          </a>
                          <div className="text-xs text-ink-500">{r.source_name}</div>
                        </td>
                        <td className="px-2 py-2 text-xs text-ink-400">{r.category}</td>
                        {/* The distinction the sheet itself cannot show: a summary
                            written from the article, or from a feed teaser. */}
                        <td className="whitespace-nowrap px-2 py-2 text-xs">
                          {r.body_chars > 200 ? (
                            <span className="text-ok">article · {r.body_chars.toLocaleString()} chars</span>
                          ) : (
                            <span className="text-warn">teaser only</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-400">
                          {r.fetched_at}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
        ) : (
          <Empty>
            Nothing is queued for the next send yet — articles gathered today appear here as the
            scorer works through them.
          </Empty>
        )}
      </Card>

      <Card
        title="After — already delivered"
        subtitle="Opens the exact HTML that was emailed, not a reconstruction of it."
      >
        <ReportViewer dates={reports.filter(r => r.status === 'sent').map(r => r.report_date)} />
      </Card>

      {/* Provenance. Deliberately here and not in the emailed sheet: the client
          gets headlines and article links, while which index page each item was
          read from is operational detail. */}
      <Card
        title="Source references"
        subtitle="Where each sheet's articles were read from, and by which route. Internal — not included in the emailed report."
      >
        {refs ? <SourceReferences rows={refs} /> : <Empty>Reference data unavailable.</Empty>}
      </Card>

      {/* Schedule */}
      <Card title="Schedule" subtitle="When each workflow runs. All times Australia/Melbourne.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Sched name="Source Ingest" when="Every hour" detail="Fetches all active sources, deduplicates" />
          <Sched name="Article Analysis" when="Every 30 minutes" detail="Scores and summarises unanalysed articles" />
          <Sched name="Daily Report" when="05:00 daily" detail="Renders the sheet and emails it" highlight />
        </div>
        <p className="mt-3 border-t border-ink-800 pt-3 text-xs text-ink-400">
          Next report:{' '}
          <span className="text-ink-100 tnum">{nextRun()}</span>
          {' · '}cron <code className="rounded bg-ink-850 px-1 text-[11px]">0 5 * * *</code> in
          Australia/Melbourne, so it follows daylight saving rather than drifting an hour in October.
        </p>
      </Card>

      {/* What the recipient actually received */}
      <Card
        title="Sent to the recipient"
        subtitle="The articles that actually went out, newest sheet first, in the order they were read. Open the browser for everything scored, sent or not."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ScoredBrowser total={totalScored} categories={(cats ?? []).map(c => c.category)} />
        </div>

        {bands && bands.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {bands.map(b => (
              <span
                key={b.band}
                className={`rounded-lg px-2.5 py-1 text-xs tnum ${
                  b.band === '80-100'
                    ? 'bg-ok/12 text-ok'
                    : b.band === 'below 40'
                      ? 'bg-ink-800 text-ink-400'
                      : 'bg-progress/12 text-progress'
                }`}
              >
                {b.band}: {b.n}
              </span>
            ))}
          </div>
        )}

        {!delivered || delivered.length === 0 ? (
          <Empty>
            Nothing delivered yet. Articles appear here once a sheet has been sent — the browser
            above shows everything scored in the meantime.
          </Empty>
        ) : (
          <div className="space-y-5">
            {groupByDate(delivered).map(([date, items]) => (
              <section key={date}>
                <header className="mb-1.5 flex items-baseline gap-2">
                  <span className="rounded bg-ok/12 px-2 py-0.5 text-[11px] font-medium text-ok">
                    ✓ sent {date}
                  </span>
                  <span className="text-[11px] text-ink-500 tnum">
                    {items.length} article{items.length === 1 ? '' : 's'}
                  </span>
                </header>
                <ul className="divide-y divide-ink-800/60">
                  {items.map(a => (
                    <li key={`${date}-${a.id}`} className="flex gap-3 py-2.5">
                      <span
                        className={`mt-0.5 w-9 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold tnum ${
                          a.relevance_score >= 80
                            ? 'bg-ok/15 text-ok'
                            : a.relevance_score >= 40
                              ? 'bg-progress/15 text-progress'
                              : 'bg-ink-800 text-ink-500'
                        }`}
                      >
                        {a.relevance_score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-ink-100 hover:text-progress hover:underline"
                        >
                          {a.title}
                        </a>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {a.source_name} · {a.category}
                        </p>
                        {a.summary && (
                          <p className="mt-1 text-xs leading-relaxed text-ink-400">{a.summary}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      {/* History */}
      <Card
        title="History"
        subtitle={
          reports.length
            ? `${reports.length} report${reports.length === 1 ? '' : 's'} · ${sent} sent${failed ? ` · ${failed} failed` : ''}`
            : undefined
        }
      >
        {reports.length === 0 ? (
          <Empty>
            No reports generated yet. The first will appear after the 05:00 run, or when the
            workflow is executed manually from n8n.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-[10px] uppercase tracking-wider text-ink-400">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Items</th>
                  <th className="pb-2 pr-4 font-medium">Sent</th>
                  <th className="pb-2 font-medium">Recipient</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/60">
                {reports.map(r => (
                  <tr key={r.id}>
                    <td className="py-2.5 pr-4 tnum text-ink-100">{fmtDate(r.report_date)}</td>
                    <td className="py-2.5 pr-4">
                      <Pill status={r.status} />
                      {r.error && (
                        <p className="mt-1 max-w-md text-xs text-blocked">{r.error}</p>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 tnum text-ink-300">{r.item_count}</td>
                    <td className="py-2.5 pr-4 tnum text-ink-400">{fmtTime(r.sent_at)}</td>
                    <td className="py-2.5 text-ink-400">{r.recipient ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'good' | 'bad';
}) {
  const colour = tone === 'good' ? 'text-ok' : tone === 'bad' ? 'text-warn' : 'text-ink-100';
  return (
    <div className="rounded-lg bg-ink-850 px-3 py-3 text-center">
      <p className={`text-xl font-semibold tnum ${colour}`}>{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
    </div>
  );
}


/** The standalone /reports route. */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportParams>;
}) {
  return <ReportsView sp={await searchParams} />;
}
