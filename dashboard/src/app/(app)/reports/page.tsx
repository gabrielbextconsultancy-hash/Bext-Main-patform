import {
  getReports,
  getPipelineReadiness,
  getHealth,
  getReportReferences,
  getNextSendPreview,
  getSourcePulse,
  getDeliveredGrouped,
} from '@/lib/queries';
import { Card, DatabaseDown, Empty } from '@/components/ui';
import { DeliveredSheets } from '@/components/DeliveredSheets';
import { EmailPreview } from '@/components/EmailPreview';
import { QueuedSheet } from '@/components/QueuedSheet';
import { SourcePulseCard } from '@/components/SourcePulseCard';
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


export interface ReportParams {
  sheet?: string;
}



/** The page body, exported so the merged pipeline page can render it as a tab. */
export async function ReportsView({
  sp = {},
  basePath = '/reports',
  extra = {},
}: {
  sp?: ReportParams;
  basePath?: string;
  extra?: Record<string, string>;
} = {}) {



  const [reports, ready, health, refs, preview, delivered, pulse] = await Promise.all([
    getReports(),
    getPipelineReadiness(),
    getHealth(),
    getReportReferences(),
    getNextSendPreview(),
    getDeliveredGrouped(),
    getSourcePulse(),
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
            {/* The three numbers a reader will compare are deliberately
                different sets, and unlabelled they read as a bug: Qualifying
                counts everything scored at least 1; the management table's
                QUEUED then subtracts what the judge held; the Before list adds
                the reach-back stragglers from the two prior days. */}
            {/* The gap between Qualifying and the Before list, itemised. Prose
                saying "they differ by a handful" was true at 3 and a lie at 34;
                the figures move nightly, so they are computed, not written. */}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
              Of the {ready.qualifying} qualifying,{' '}
              <span className="text-amber-300">{ready.held_unverified_age}</span> are waiting for a
              date to be read from their page and{' '}
              <span className="text-amber-300">{ready.held_by_judge}</span> were judged reference or
              off-topic — both refused by the send gate. The Before list is what remains, plus any
              unsent straggler from the two prior days. The date passes clear the first number
              through the evening, so the two converge by 05:00.
            </p>
            {pulse && (
              <div className="mt-4">
                <SourcePulseCard pulse={pulse} />
              </div>
            )}
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
        {/* The list says what; this shows how it will look in the inbox —
            rendered by the workflow's own node code against live data. */}
        <div className="mb-4">
          <EmailPreview />
        </div>
        {preview ? (
          <QueuedSheet rows={preview.rows} day={preview.day} />
        ) : (
          <Empty>Preview unavailable — the database could not be read.</Empty>
        )}
      </Card>

      <Card
        title="After — already delivered"
        subtitle={`${delivered?.length ?? 0} articles the client has received, grouped the way the brief reads: day, then the filtered link, then what it contributed. "View in sheet" opens the emailed report with that article outlined — a marking that exists only here.`}
      >
        <DeliveredSheets rows={delivered ?? []} />
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

      {/* "Sent to the recipient" and its floating score browser stood here.
          Both are gone. They listed the same articles the management table
          now carries, in a shape that could not be filtered and never said
          what an article was written from, why it was held, or which route
          fetched it. One table answering all of those beats two views that
          each answer part of one. */}

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
