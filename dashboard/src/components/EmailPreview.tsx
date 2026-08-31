'use client';

import { useEffect, useState } from 'react';

/**
 * Tomorrow's sheet, as an email, before it is sent.
 *
 * Same modal discipline as the delivered viewer: the HTML renders inside a
 * sandboxed iframe so its inline email styles cannot bleed into the panel and
 * nothing in an article title can execute. The banner is part of the fetched
 * document's intro, so the preview can never be mistaken for a delivered sheet.
 */
export function EmailPreview() {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setOpen(true);
    setHtml(null);
    setError(null);
    try {
      const r = await fetch('/api/preview-email', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (!j.html) { setError('Nothing qualifies yet — the sheet would be empty right now.'); return; }
      setHtml(j.html);
      setCount(j.count);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        onClick={load}
        className="rounded-md border border-brief-a/40 bg-brief-a/10 px-3 py-1.5 text-sm font-medium
                   text-brief-a transition hover:bg-brief-a/20"
      >
        Preview the email →
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-warn">
                  Preview — not sent
                </p>
                <p className="text-sm font-semibold text-ink-100">
                  Tomorrow&rsquo;s 05:00 sheet, rendered from live data
                  {count !== null && ` · ${count} items right now`}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-ink-300 transition hover:text-ink-100"
              >
                Close (Esc)
              </button>
            </header>

            <div className="flex-1 overflow-hidden bg-white">
              {error ? (
                <p className="p-6 text-sm text-blocked">{error}</p>
              ) : html === null ? (
                <p className="p-6 text-sm text-ink-600">Rendering the sheet from live data…</p>
              ) : (
                <iframe title="Email preview" srcDoc={html} sandbox="" className="h-full w-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
