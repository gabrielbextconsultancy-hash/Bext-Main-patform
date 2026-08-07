'use client';

import { useCallback, useEffect, useState } from 'react';

interface Row {
  id: number;
  title: string;
  url: string;
  source_name: string;
  category: string;
  relevance_score: number;
  summary: string;
  fetched_at: string;
}

const band = (n: number) =>
  n >= 80 ? 'bg-ok/15 text-ok' : n >= 40 ? 'bg-progress/15 text-progress' : 'bg-ink-800 text-ink-500';

/**
 * Every scored article, paged, in a modal.
 *
 * Inline on the page this was capped at 25 rows with no way to see the rest —
 * fine as a sample, useless for judging whether the filter is behaving across
 * eighteen hundred articles. Paging in a modal keeps the panel readable while
 * making the whole set reachable.
 */
export function ScoredBrowser({ total }: { total: number }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: Row[]; pages: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/scored?page=${p}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setData(await r.json());
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !data) load(0);
  }, [open, data, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowRight' && data && page < data.pages - 1) load(page + 1);
      if (e.key === 'ArrowLeft' && page > 0) load(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, page, data, load]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-100 transition hover:border-ink-600"
      >
        Browse all {total.toLocaleString()} scored articles →
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">AI scoring</p>
                <p className="text-sm font-semibold text-ink-100">
                  {data ? `${data.total.toLocaleString()} articles scored` : 'Loading…'}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-ink-300 transition hover:text-ink-100"
              >
                Close (Esc)
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {error ? (
                <p className="text-sm text-blocked">{error}</p>
              ) : !data || loading ? (
                <p className="text-sm text-ink-500">Loading…</p>
              ) : (
                <ul className="divide-y divide-ink-800/60">
                  {data.rows.map(a => (
                    <li key={a.id} className="flex gap-3 py-3">
                      <span
                        className={`mt-0.5 w-9 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold tnum ${band(a.relevance_score)}`}
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
            </div>

            {data && (
              <footer className="flex items-center gap-3 border-t border-ink-800 px-5 py-3">
                <button
                  onClick={() => load(page - 1)}
                  disabled={page === 0 || loading}
                  className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-100 disabled:opacity-35"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => load(page + 1)}
                  disabled={page >= data.pages - 1 || loading}
                  className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-100 disabled:opacity-35"
                >
                  Next →
                </button>
                <span className="text-xs tabular-nums text-ink-400">
                  Page {page + 1} of {data.pages}
                </span>
                <span className="ml-auto text-[11px] text-ink-600">← → to page</span>
              </footer>
            )}
          </div>
        </div>
      )}
    </>
  );
}
