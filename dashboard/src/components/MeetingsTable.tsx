'use client';

import { useMemo, useState } from 'react';
import type { MeetingRow } from '@/lib/queries';

// Stage flags arrive precomputed from the server page as plain booleans.
//
// Nothing named STAGES crosses the client boundary in either direction any more.
// Sharing that symbol — in a lib module, or exported from here — made Turbopack
// resolve the server page's copy to a client reference, and the page 500'd with
// "STAGES is on the client" while every other page rendered. Plain data has no
// such failure mode.
export type StageFlag = { key: string; label: string; ok: boolean };
export type MeetingWithStages = MeetingRow & { stages: StageFlag[] };

const stagesDone = (m: MeetingWithStages) => m.stages.filter((s) => s.ok).length;
const STAGE_COUNT = 6;

type SortKey = 'when' | 'subject' | 'organiser' | 'status' | 'stages';
type Dir = 'asc' | 'desc';

const PAGE_SIZES = [10, 25, 50];

export function MeetingsTable({ rows }: { rows: MeetingWithStages[] }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | MeetingRow['status']>('all');
  const [organiser, setOrganiser] = useState('all');
  const [sort, setSort] = useState<SortKey>('when');
  // Newest first by default: the reason anyone opens this page is the meeting
  // they just had.
  const [dir, setDir] = useState<Dir>('desc');
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);

  const organisers = useMemo(
    () => [...new Set(rows.map((r) => r.organiser_upn).filter(Boolean) as string[])].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (organiser !== 'all' && r.organiser_upn !== organiser) return false;
      if (!needle) return true;
      // Search the error text too — when something failed, that is what you are
      // looking for.
      return [r.subject, r.organiser_upn, r.error, r.post_error]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });

    const cmp: Record<SortKey, (a: MeetingWithStages, b: MeetingWithStages) => number> = {
      when: (a, b) => (a.started_at || a.updated_at || '').localeCompare(b.started_at || b.updated_at || ''),
      subject: (a, b) => (a.subject || '').localeCompare(b.subject || ''),
      organiser: (a, b) => (a.organiser_upn || '').localeCompare(b.organiser_upn || ''),
      status: (a, b) => a.status.localeCompare(b.status),
      stages: (a, b) => stagesDone(a) - stagesDone(b),
    };
    out = [...out].sort(cmp[sort]);
    if (dir === 'desc') out.reverse();
    return out;
  }, [rows, q, status, organiser, sort, dir]);

  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * size, current * size);

  const sortBy = (k: SortKey) => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(k);
      setDir(k === 'when' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="py-2 pr-3 font-medium">
      <button
        onClick={() => sortBy(k)}
        className="inline-flex items-center gap-1 transition hover:text-ink-100"
      >
        {children}
        <span className={sort === k ? 'text-ink-200' : 'text-ink-600'}>
          {sort === k ? (dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search meeting, organiser or error…"
          className="min-w-[220px] flex-1 rounded-lg border border-ink-800 bg-ink-950 px-3 py-1.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-ink-700 focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
          className="rounded-lg border border-ink-800 bg-ink-950 px-2 py-1.5 text-sm text-ink-200 focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="drafted">Drafted</option>
          <option value="transcribed">Transcribed</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={organiser}
          onChange={(e) => {
            setOrganiser(e.target.value);
            setPage(1);
          }}
          className="max-w-[200px] rounded-lg border border-ink-800 bg-ink-950 px-2 py-1.5 text-sm text-ink-200 focus:outline-none"
        >
          <option value="all">All organisers</option>
          {organisers.map((o) => (
            <option key={o} value={o}>
              {o.split('@')[0]}
            </option>
          ))}
        </select>
        <select
          value={size}
          onChange={(e) => {
            setSize(Number(e.target.value));
            setPage(1);
          }}
          className="rounded-lg border border-ink-800 bg-ink-950 px-2 py-1.5 text-sm text-ink-200 focus:outline-none"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg bg-ink-850 px-3 py-6 text-center text-sm text-ink-400">
          Nothing matches that.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-ink-400">
              <tr className="border-b border-ink-800">
                <Th k="subject">Meeting</Th>
                <Th k="when">When</Th>
                <Th k="organiser">Organiser</Th>
                <Th k="status">Status</Th>
                <Th k="stages">Stages</Th>
                <th className="py-2 font-medium">Documents</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.transcript_id ?? m.meeting_id} className="border-b border-ink-800/60 align-top">
                  <td className="py-3 pr-3 text-ink-100">
                    {m.subject}
                    {m.error && <p className="mt-1 text-[11px] text-blocked">{m.error}</p>}
                    {m.post_error && (
                      <p className="mt-1 text-[11px] text-warn">card: {m.post_error}</p>
                    )}
                  </td>
                  <td className="py-3 pr-3 tnum text-ink-300">{when(m.started_at)}</td>
                  <td className="py-3 pr-3 text-ink-300">
                    {m.organiser_upn ? m.organiser_upn.split('@')[0] : '—'}
                  </td>
                  <td className="py-3 pr-3">
                    <Pill status={m.status} />
                    {m.status === 'drafted' && (
                      <p className="mt-1 whitespace-nowrap text-[10px] text-ink-400">
                        {m.sent_at ? 'email sent' : 'draft — not sent'}
                      </p>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <StageBar m={m} />
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Doc href={m.folder_url} label="Folder" />
                      <Doc href={m.minutes_pdf_url} label="Minutes PDF" />
                      <Doc href={m.minutes_url} label="Minutes .docx" />
                      <Doc href={m.summary_pdf_url ?? m.summary_url} label="Summary" />
                      <Doc href={m.transcript_pdf_url ?? m.transcript_url} label="Transcript" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
        <span>
          {filtered.length === rows.length
            ? `${rows.length} meeting${rows.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${rows.length} meetings`}
          {pages > 1 && ` · page ${current} of ${pages}`}
        </span>
        {pages > 1 && (
          <div className="flex gap-1">
            <PageBtn disabled={current === 1} onClick={() => setPage(current - 1)}>
              Previous
            </PageBtn>
            <PageBtn disabled={current === pages} onClick={() => setPage(current + 1)}>
              Next
            </PageBtn>
          </div>
        )}
      </div>
    </div>
  );
}

/** Six pips, one per stage — the row-level version of the pipeline strip. */
function StageBar({ m }: { m: MeetingWithStages }) {
  const done = stagesDone(m);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex gap-0.5">
        {m.stages.map((s) => (
          <span
            key={s.key}
            title={s.label}
            className={`h-3.5 w-1.5 rounded-sm ${s.ok ? 'bg-ok' : 'bg-ink-700'}`}
          />
        ))}
      </span>
      <span className="tnum text-ink-400">
        {done}/{STAGE_COUNT}
      </span>
    </span>
  );
}

function PageBtn({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-ink-850 px-2.5 py-1 ring-1 ring-inset ring-ink-700 transition enabled:hover:text-ink-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

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

const STATUS: Record<MeetingRow['status'], { label: string; cls: string }> = {
  drafted: { label: 'Drafted', cls: 'bg-ok/12 text-ok ring-ok/25' },
  transcribed: { label: 'Transcribed', cls: 'bg-progress/12 text-progress ring-progress/25' },
  failed: { label: 'Failed', cls: 'bg-blocked/12 text-blocked ring-blocked/25' },
};

function Pill({ status }: { status: MeetingRow['status'] }) {
  const s = STATUS[status] ?? STATUS.failed;
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function Doc({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return <span className="rounded-md bg-ink-850 px-2 py-1 text-[11px] text-ink-600">{label}</span>;
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
