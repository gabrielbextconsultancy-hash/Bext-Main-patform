'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Opens the report that was actually emailed, in a modal over the panel.
 *
 * The HTML is rendered inside a sandboxed iframe rather than injected into the
 * page: it is email HTML with its own inline styles, and letting it into the
 * document would let those styles bleed into the dashboard. srcDoc plus a
 * sandbox with no allow-scripts also means nothing in a fetched article title
 * can execute here.
 */
export function ReportViewer({ dates }: { dates: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (date: string) => {
    setOpen(date);
    setHtml(null);
    setError(null);
    try {
      const r = await fetch(`/api/report?date=${date}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setHtml((await r.json()).html);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {dates.length === 0 ? (
          <p className="text-sm text-ink-400">No reports to preview yet.</p>
        ) : (
          dates.map(d => (
            <button
              key={d}
              onClick={() => load(d)}
              className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-100 transition hover:border-ink-600"
            >
              View {d}
            </button>
          ))
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="flex h-full max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">
                  As delivered
                </p>
                <p className="text-sm font-semibold text-ink-100">
                  Industry Daily Report — {open}
                </p>
              </div>
              <button
                onClick={() => setOpen(null)}
                className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-ink-300 transition hover:text-ink-100"
              >
                Close (Esc)
              </button>
            </header>

            <div className="flex-1 overflow-hidden bg-white">
              {error ? (
                <p className="p-6 text-sm text-blocked">{error}</p>
              ) : html === null ? (
                <p className="p-6 text-sm text-ink-600">Loading…</p>
              ) : (
                <iframe
                  title={`Report ${open}`}
                  srcDoc={html}
                  sandbox=""
                  className="h-full w-full border-0"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
