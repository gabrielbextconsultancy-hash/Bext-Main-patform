'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CycleRow, ReportRow, ReportArticleRow } from '@/lib/queries';
import { ContentStatus } from './ContentStatus';
import { Pipeline } from './Pipeline';

/**
 * The content hub: the daily news the pipeline produced, and the cycles built
 * from it.
 *
 * The daily reports are paged, and each report's articles are pulled on demand
 * when its row is opened, so any report on any page shows its own items rather
 * than only the most recent few. Starting a cycle POSTs to /api/content/action,
 * which hands off to n8n; the page never calls Gemini or writes Postgres directly.
 */
const PAGE_SIZE = 12;

export function ContentHub({ cycles, reports }: { cycles: CycleRow[]; reports: ReportRow[] }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(reports[0]?.id ?? null);
  const [articles, setArticles] = useState<Record<number, ReportArticleRow[] | 'loading' | 'error'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pages = Math.max(1, Math.ceil(reports.length / PAGE_SIZE));
  const shown = reports.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function loadArticles(reportId: number) {
    if (articles[reportId] && articles[reportId] !== 'error') return;
    setArticles((a) => ({ ...a, [reportId]: 'loading' }));
    try {
      const res = await fetch(`/api/content/report-articles?id=${reportId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setArticles((a) => ({ ...a, [reportId]: data.articles as ReportArticleRow[] }));
    } catch {
      setArticles((a) => ({ ...a, [reportId]: 'error' }));
    }
  }

  function toggle(reportId: number) {
    const next = open === reportId ? null : reportId;
    setOpen(next);
    if (next != null) loadArticles(next);
  }

  async function startCycle(reportId?: number) {
    setBusy(reportId ? `report-${reportId}` : 'new');
    setError(null);
    try {
      const res = await fetch('/api/content/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_cycle', report_ids: reportId ? [reportId] : [], requested_by: 'dashboard' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'could not start the cycle');
      if (data.row?.id) router.push(`/content/${data.row.id}`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not start the cycle');
    } finally {
      setBusy(null);
    }
  }

  // Open the first report on this page by default when paging.
  function goPage(p: number) {
    const np = Math.max(0, Math.min(pages - 1, p));
    setPage(np);
    const first = reports[np * PAGE_SIZE]?.id ?? null;
    setOpen(first);
    if (first != null) loadArticles(first);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brief-b/30 bg-brief-b/5 p-4">
        <div>
          <p className="text-sm font-semibold text-ink-100">Turn the fortnight into a post</p>
          <p className="mt-0.5 text-xs text-ink-400">
            Scans the last 14 days, ranks three topics, and drafts two variants. You pick, edit, and approve.
          </p>
        </div>
        <button
          onClick={() => startCycle()}
          disabled={busy !== null}
          className="rounded-lg bg-brief-b px-4 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'new' ? 'Starting…' : 'Start a cycle'}
        </button>
      </div>

      {error && <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{error}</p>}

      {/* The pipeline, horizontal, as an always-visible map of the flow. It lights
          up per cycle inside a cycle's workspace; here it shows the shape. */}
      <Pipeline />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-xl border border-ink-800 bg-ink-900/60 p-5">
          <header className="mb-3 flex items-baseline justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink-100">Daily news</h2>
              <p className="mt-0.5 text-xs text-ink-400">Open one to see what it carried, or repurpose it into a cycle.</p>
            </div>
            <span className="text-[11px] text-ink-600">{reports.length} reports</span>
          </header>

          {reports.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">No reports yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-ink-800/70">
                {shown.map((r) => {
                  const isOpen = open === r.id;
                  const arts = articles[r.id];
                  return (
                    <li key={r.id} className="py-2">
                      <div className="flex items-center gap-3">
                        <button onClick={() => toggle(r.id)} className="flex flex-1 items-center gap-2 text-left">
                          <span className={`text-ink-500 transition ${isOpen ? 'rotate-90' : ''}`}>›</span>
                          <span className="text-sm text-ink-100">{r.report_date}</span>
                          <span className="text-xs text-ink-500">{r.item_count} items</span>
                        </button>
                        <button
                          onClick={() => startCycle(r.id)}
                          disabled={busy !== null}
                          className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-ink-300 transition hover:border-brief-b hover:text-brief-b disabled:opacity-50"
                        >
                          {busy === `report-${r.id}` ? 'Starting…' : 'Repurpose'}
                        </button>
                      </div>
                      {isOpen && (
                        <div className="mt-2 pl-6">
                          {arts === 'loading' && <p className="text-xs text-ink-500">Loading items…</p>}
                          {arts === 'error' && <p className="text-xs text-warn">Could not load items.</p>}
                          {Array.isArray(arts) && arts.length === 0 && (
                            <p className="text-xs text-ink-500">No stored items for this report.</p>
                          )}
                          {Array.isArray(arts) && arts.length > 0 && (
                            <ul className="space-y-1.5">
                              {arts.map((a) => (
                                <li key={a.article_id} className="flex items-baseline gap-2 text-[13px]">
                                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-600">{a.category}</span>
                                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-ink-300 hover:text-ink-100 hover:underline">
                                    {a.title}
                                  </a>
                                  <span className="shrink-0 text-[10px] text-ink-600">{a.source}{a.score != null ? ` · ${a.score}` : ''}</span>
                                  {a.used && <span className="shrink-0 rounded bg-ink-800 px-1 text-[9px] text-ink-400">used</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {pages > 1 && (
                <div className="mt-3 flex items-center justify-between border-t border-ink-800 pt-3 text-xs text-ink-400">
                  <button onClick={() => goPage(page - 1)} disabled={page === 0} className="rounded px-2 py-1 transition hover:text-ink-100 disabled:opacity-40">‹ Newer</button>
                  <span>Page {page + 1} of {pages}</span>
                  <button onClick={() => goPage(page + 1)} disabled={page >= pages - 1} className="rounded px-2 py-1 transition hover:text-ink-100 disabled:opacity-40">Older ›</button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="rounded-xl border border-ink-800 bg-ink-900/60 p-5">
          <header className="mb-3">
            <h2 className="text-sm font-semibold text-ink-100">Cycles</h2>
            <p className="mt-0.5 text-xs text-ink-400">In progress and recent. Open one to pick a topic or review drafts.</p>
          </header>
          {cycles.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">No cycles yet. Start one above.</p>
          ) : (
            <ul className="space-y-2">
              {cycles.map((c) => (
                <li key={c.id}>
                  <Link href={`/content/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-ink-800 px-3 py-2 transition hover:border-ink-700 hover:bg-ink-850/60">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-ink-200">{c.window_start} → {c.window_end}</p>
                      <p className="text-[11px] text-ink-500">
                        {c.trigger === 'schedule' ? 'Fortnightly' : 'Manual'} · {c.topic_count} topics · {c.draft_count} drafts
                      </p>
                    </div>
                    <ContentStatus status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
