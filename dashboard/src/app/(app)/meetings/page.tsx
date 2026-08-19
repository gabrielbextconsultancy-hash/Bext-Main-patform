import {
  getMeetings,
  getMeetingReadiness,
  type MeetingRow,
} from '@/lib/queries';
import { Card, DatabaseDown, Empty } from '@/components/ui';
import { MeetingsTable, STAGES } from '@/components/MeetingsTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MeetingsPage() {
  const [meetings, readiness] = await Promise.all([getMeetings(), getMeetingReadiness()]);

  if (!meetings) return <DatabaseDown />;

  const latest = meetings[0] ?? null;
  const healthy = readiness ? readiness.failed === 0 && readiness.drafted > 0 : false;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">Meeting Report</h1>
        <p className="mt-1 text-sm text-ink-400">
          Every meeting the pipeline has seen. Runs every 15 minutes; a transcript
          appears a few minutes after the meeting ends.
        </p>
      </header>

      <Card
        title="Pipeline check"
        subtitle="The six stages of the most recent meeting, in the order they run."
      >
        {latest ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {STAGES.map((s, i) => {
                const ok = s.of(latest);
                return (
                  <div key={s.key} className="flex items-center gap-2">
                    <div
                      className={`rounded-lg px-3 py-2 text-center ring-1 ring-inset ${
                        ok
                          ? 'bg-ok/12 text-ok ring-ok/25'
                          : 'bg-blocked/12 text-blocked ring-blocked/25'
                      }`}
                    >
                      <span className="block text-[11px] uppercase tracking-wider opacity-70">
                        {i + 1}
                      </span>
                      <span className="block text-xs font-medium">{s.label}</span>
                    </div>
                    {i < STAGES.length - 1 && <span className="text-ink-600">→</span>}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-ink-400">
              {latest.subject} · {when(latest.started_at)}
              {latest.error ? ` · ${latest.error}` : ''}
            </p>
          </>
        ) : (
          <Empty>No meeting has been processed yet.</Empty>
        )}
      </Card>

      <Card title="Readiness" subtitle="What the pipeline has produced so far.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Meetings" value={readiness?.total ?? 0} />
          <Stat label="Drafted" value={readiness?.drafted ?? 0} tone="good" />
          <Stat label="Failed" value={readiness?.failed ?? 0} tone={readiness?.failed ? 'bad' : undefined} />
          <Stat label="Posted" value={readiness?.posted ?? 0} tone="good" />
          <Stat label="Participants" value={readiness?.participants ?? 0} />
        </div>
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            healthy ? 'border-ok/25 bg-ok/5 text-ink-100' : 'border-warn/25 bg-warn/5 text-ink-100'
          }`}
        >
          <span className={healthy ? 'text-ok' : 'text-warn'}>{healthy ? '✓' : '!'}</span>{' '}
          {healthy
            ? `All ${readiness?.drafted} meetings processed cleanly. Last success ${when(readiness?.last_success ?? null)}.`
            : readiness?.failed
              ? `${readiness.failed} meeting(s) failed. See the table below for the reason.`
              : 'Nothing processed yet.'}
        </div>
        {readiness?.participants === 0 && (
          <p className="mt-2 text-xs text-warn">
            The participants table is empty, so open actions cannot be grouped by
            organisation in the follow-up email.
          </p>
        )}
      </Card>

      <Card title="Meetings" subtitle="Search, filter and sort. Documents open in SharePoint.">
        {meetings.length === 0 ? <Empty>Nothing yet.</Empty> : <MeetingsTable rows={meetings} />}
      </Card>
    </div>
  );
}

/** Melbourne, because that is where the meetings happen. */
function when(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Melbourne',
  });
}

function short(upn: string | null) {
  return upn ? upn.split('@')[0] : '—';
}

const STATUS: Record<MeetingRow['status'], { label: string; cls: string }> = {
  drafted: { label: 'Drafted', cls: 'bg-ok/12 text-ok ring-ok/25' },
  transcribed: { label: 'Transcribed', cls: 'bg-progress/12 text-progress ring-progress/25' },
  failed: { label: 'Failed', cls: 'bg-blocked/12 text-blocked ring-blocked/25' },
};

function Pill({ status }: { status: MeetingRow['status'] }) {
  const s = STATUS[status] ?? STATUS.failed;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  );
}

function Doc({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return (
      <span className="rounded-md bg-ink-850 px-2 py-1 text-[11px] text-ink-600">{label}</span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-md bg-ink-850 px-2 py-1 text-[11px] text-ink-300 ring-1 ring-inset ring-ink-700 transition hover:text-ink-100"
    >
      {label}
    </a>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  const colour = tone === 'good' ? 'text-ok' : tone === 'bad' ? 'text-warn' : 'text-ink-100';
  return (
    <div className="rounded-lg bg-ink-850 px-3 py-3 text-center">
      <p className={`text-xl font-semibold tnum ${colour}`}>{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
    </div>
  );
}
