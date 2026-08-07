import {
  getReports,
  getPipelineReadiness,
  getHealth,
  getRecentScored,
  getScoreBands,
  getScoredCount,
  getCategories,
} from '@/lib/queries';
import { Card, DatabaseDown, Empty } from '@/components/ui';
import { ReportViewer } from '@/components/ReportViewer';
import { ScoredBrowser } from '@/components/ScoredBrowser';

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

export default async function ReportsPage() {
  const [reports, ready, health, scored, bands, totalScored, cats] = await Promise.all([
    getReports(),
    getPipelineReadiness(),
    getHealth(),
    getRecentScored(),
    getScoreBands(),
    getScoredCount(),
    getCategories(),
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
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-100">Daily Report</h1>
        <p className="mt-1 text-sm text-ink-400">
          Scheduled 05:00 Australia/Melbourne. Sent over SMTP; switches to Microsoft Graph once
          the tenant exists.
        </p>
      </header>

      {/* Readiness — the pass/fail check */}
      <Card
        title="Next run readiness"
        subtitle="What the 05:00 send would produce if it ran now."
      >
        {ready ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Fetched 24h" value={ready.articles_24h} />
              <Stat label="Analysed" value={ready.analysed_24h} />
              <Stat
                label="Qualifying (≥40)"
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

      {/* What was actually delivered */}
      <Card
        title="Delivered sheets"
        subtitle="Opens the exact HTML that was emailed, not a reconstruction of it."
      >
        <ReportViewer dates={reports.filter(r => r.status === 'sent').map(r => r.report_date)} />
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

      {/* Live scoring */}
      <Card
        title="Scoring, live"
        subtitle="The most recent scores, and the full set behind them. This is what the 05:00 sheet is drawn from."
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

        {!scored || scored.length === 0 ? (
          <Empty>Nothing scored yet.</Empty>
        ) : (
          <ul className="divide-y divide-ink-800/60">
            {scored.slice(0, 8).map(a => (
              <li key={a.id} className="flex gap-3 py-2.5">
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
