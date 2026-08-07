'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Row {
  id: number;
  title: string;
  url: string;
  source_name: string;
  category: string;
  relevance_score: number;
  summary: string;
  in_report: boolean;
  report_date: string | null;
}

const band = (n: number) =>
  n >= 80 ? 'bg-ok/15 text-ok' : n >= 40 ? 'bg-progress/15 text-progress' : 'bg-ink-800 text-ink-500';

const BANDS = [
  { v: '', label: 'All scores' },
  { v: '80', label: '80–100' },
  { v: '60', label: '60–79' },
  { v: '40', label: '40–59' },
  { v: 'below40', label: 'Below 40' },
];

/**
 * The full scored set, filtered and paged, in a modal.
 *
 * Filtering happens server-side: the set is already over a thousand rows and
 * grows hourly, so pulling it all down to filter in the browser would get slower
 * every day. Each article shows whether it actually reached a delivered report,
 * which is the link between what the AI scored and what the client received.
 */
export function ScoredBrowser({ total, categories }: { total: number; categories: string[] }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [bandF, setBandF] = useState('');
  const [category, setCategory] = useState('');
  const [sentOnly, setSentOnly] = useState(false);
  const [data, setData] = useState<{ rows: Row[]; pages: number; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(p) });
        if (q) params.set('q', q);
        if (bandF) params.set('band', bandF);
        if (category) params.set('category', category);
        if (sentOnly) params.set('sent', '1');
        const r = await fetch(`/api/scored?${params}`, { cache: 'no-store' });
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        setData(await r.json());
        setPage(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [q, bandF, category, sentOnly]
  );

  // Any filter change resets to the first page — page 4 of the old filter is
  // meaningless under the new one.
  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(0), q ? 300 : 0);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [open, q, bandF, category, sentOnly, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') setOpen(false);
      if (e.target instanceof HTMLInputElement) return; // don't page while typing
      if (e.key === 'ArrowRight' && data && page < data.pages - 1) load(page + 1);
      if (e.key === 'ArrowLeft' && page > 0) load(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, page, data, load]);

  const clearAll = () => { setQ(''); setBandF(''); setCategory(''); setSentOnly(false); };
  const active = Boolean(q || bandF || category || sentOnly);

  const sel =
    'rounded-lg border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs text-ink-100 outline-none focus:border-ink-600';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-100 transition hover:border-ink-600"
      >
        Browse &amp; filter all {total.toLocaleString()} scored articles →
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
            onClick={e => e.stopPropagation()}
          >
            <header className="border-b border-ink-800 px-5 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">AI scoring</p>
                  <p className="text-sm font-semibold text-ink-100">
                    {data
                      ? `${data.total.toLocaleString()} article${data.total === 1 ? '' : 's'}${active ? ' matching' : ' scored'}`
                      : 'Loading…'}
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-ink-300 transition hover:text-ink-100"
                >
                  Close (Esc)
                </button>
              </div>

              {/* Filters */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Search title or summary…"
                  className={`${sel} min-w-[190px] flex-1 placeholder:text-ink-600`}
                />
                <select value={bandF} onChange={e => setBandF(e.target.value)} className={sel}>
                  {BANDS.map(b => (
                    <option key={b.v} value={b.v}>{b.label}</option>
                  ))}
                </select>
                <select value={category} onChange={e => setCategory(e.target.value)} className={sel}>
                  <option value="">All categories</option>
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-ink-300">
                  <input
                    type="checkbox"
                    checked={sentOnly}
                    onChange={e => setSentOnly(e.target.checked)}
                    className="accent-ok"
                  />
                  Sent only
                </label>
                {active && (
                  <button onClick={clearAll} className="text-xs text-ink-400 underline underline-offset-4 hover:text-ink-100">
                    Clear
                  </button>
                )}
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {error ? (
                <p className="text-sm text-blocked">{error}</p>
              ) : loading || !data ? (
                <p className="text-sm text-ink-500">Loading…</p>
              ) : data.rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-400">
                  Nothing matches those filters.
                </p>
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
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-ink-100 hover:text-progress hover:underline"
                          >
                            {a.title}
                          </a>
                          {a.in_report && (
                            <span
                              title={`Included in the report sent on ${a.report_date}`}
                              className="shrink-0 rounded-full bg-ok/12 px-2 py-0.5 text-[10px] font-medium text-ok ring-1 ring-inset ring-ok/25"
                            >
                              ✓ sent {a.report_date}
                            </span>
                          )}
                        </div>
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
