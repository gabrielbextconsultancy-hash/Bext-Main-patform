'use client';

import { useEffect, useState } from 'react';
import type { ManagementRow } from '@/lib/queries';

/**
 * Everything known about one article, as a record rather than a row.
 *
 * The table answers "what happened to all of them"; this answers "what happened
 * to this one, and why". A table cannot: the reason an article was held, the
 * summary that was written for it, the route its source was reached by, and the
 * brief link it answers to are all prose, and prose in a cell is unreadable.
 *
 * Every value here already travelled with the row, so opening the window costs
 * no query — it is the same data the table declined to show.
 */

const CHIP: Record<string, string> = {
  SENT: 'bg-green-900/40 text-green-300',
  QUEUED: 'bg-blue-900/40 text-blue-300',
  HELD: 'bg-amber-900/40 text-amber-300',
  EXCLUDED: 'bg-ink-800 text-ink-300',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-ink-800/60 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-100">{children}</dd>
    </div>
  );
}

export function ArticleDetails({ row }: { row: ManagementRow }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scored = row.score !== null && row.score !== undefined;
  const readInFull = row.body_chars > 200;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-0.5 block text-left text-[11px] text-ink-500 hover:text-brief-a"
      >
        view more details
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">Article record</p>
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm font-semibold text-brief-a hover:underline"
                >
                  {row.title}
                </a>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg border border-ink-700 px-3 py-1 text-xs text-ink-300 hover:text-ink-100"
              >
                Close (Esc)
              </button>
            </header>

            <div className="grid gap-x-6 overflow-y-auto px-5 py-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 mt-2 text-[10px] uppercase tracking-[0.14em] text-brief-a">
                  This article
                </p>
                <dl>
                  <Field label="Relevance score">
                    {scored ? (
                      <span className="font-semibold tnum">{row.score}</span>
                    ) : (
                      <span className="text-ink-400">not scored yet</span>
                    )}
                  </Field>
                  <Field label="Section">{row.category}</Field>
                  <Field label="Disposition">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${CHIP[row.disposition]}`}>
                      {row.disposition}
                    </span>
                    <span className="mt-1 block text-xs text-ink-400">{row.reason}</span>
                  </Field>
                  {/* Analysed and qualifying are the two facts the tiles report
                      for the whole day; this is the same pair for one article. */}
                  <Field label="Analysed">
                    {row.analysed_at ? (
                      <>
                        {row.analysed_at}
                        {row.model && <span className="text-ink-500"> · {row.model}</span>}
                      </>
                    ) : (
                      <span className="text-amber-300">waiting for the scorer</span>
                    )}
                  </Field>
                  <Field label="Qualifies for the sheet">
                    {row.disposition === 'QUEUED' || row.disposition === 'SENT' ? (
                      <span className="text-green-300">yes</span>
                    ) : (
                      <span className="text-amber-300">no — {row.reason}</span>
                    )}
                  </Field>
                  <Field label="Written from">
                    {readInFull ? (
                      <span className="text-green-300">
                        the article · {row.body_chars.toLocaleString()} characters
                      </span>
                    ) : (
                      <span className="text-amber-300">
                        the feed teaser only — no article body was retrieved
                      </span>
                    )}
                  </Field>
                  <Field label="Fetched">{row.fetched_at}</Field>
                  <Field label="Published">
                    {row.published_at ?? (
                      <span className="text-ink-400">
                        no publication date{row.date_state ? ` (${row.date_state})` : ''}
                      </span>
                    )}
                  </Field>
                  <Field label="Sent / will send">
                    {row.disposition === 'SENT'
                      ? (row.sent_at ?? row.sent_report ?? 'sent')
                      : row.disposition === 'QUEUED'
                        ? 'the next 05:00 report'
                        : '—'}
                  </Field>
                </dl>
              </div>

              <div>
                <p className="mb-1 mt-2 text-[10px] uppercase tracking-[0.14em] text-brief-a">
                  Where it came from
                </p>
                <dl>
                  <Field label="Source">
                    {row.brief_n ? `#${row.brief_n} · ` : ''}
                    {row.source_name}
                  </Field>
                  {/* The brief's own hyperlink, which is what the client signed
                      off on, kept distinct from the feed we actually poll. */}
                  <Field label="Brief link">
                    {row.brief_url ? (
                      <a
                        href={row.brief_url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-xs text-brief-a hover:underline"
                      >
                        {row.brief_url}
                      </a>
                    ) : (
                      <span className="text-ink-400">not named in the brief</span>
                    )}
                  </Field>
                  <Field label="Site">
                    {row.source_url ? (
                      <a
                        href={row.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-xs text-ink-200 hover:text-brief-a hover:underline"
                      >
                        {row.source_url}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Field>
                  <Field label="Retrieval method">{row.source_method ?? '—'}</Field>
                  <Field label="Route polled">
                    {row.source_route ? (
                      <a
                        href={row.source_route}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-xs text-ink-200 hover:text-brief-a hover:underline"
                      >
                        {row.source_route}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Field>
                  <Field label="Source last produced">{row.source_last_fetch ?? 'never'}</Field>
                  <Field label="Source health">
                    {row.source_active === false ? (
                      <span className="text-ink-400">inactive — not being polled</span>
                    ) : (row.source_failures ?? 0) > 0 ? (
                      <span className="text-amber-300">
                        {row.source_failures} consecutive failures
                      </span>
                    ) : (
                      <span className="text-green-300">healthy</span>
                    )}
                  </Field>
                  {row.content_kind && row.content_kind !== 'unknown' && (
                    <Field label="Judged as">{row.content_kind}</Field>
                  )}
                </dl>
              </div>

              {row.summary && (
                <div className="sm:col-span-2">
                  <p className="mb-1 mt-3 text-[10px] uppercase tracking-[0.14em] text-brief-a">
                    The summary written for the client
                  </p>
                  <p className="rounded-lg border border-ink-800 bg-ink-850/50 p-3 text-sm leading-relaxed text-ink-200">
                    {row.summary}
                  </p>
                  {row.topics && row.topics.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pb-3">
                      {row.topics.map(t => (
                        <span
                          key={t}
                          className="rounded-full bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
