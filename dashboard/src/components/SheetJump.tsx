'use client';

import { useEffect, useMemo, useState } from 'react';
import { HIGHLIGHT_ID, markArticle } from './sheet-mark';
import { EmailPreview } from './EmailPreview';

/**
 * "Show me this article inside the sheet" — from the management table, where
 * the question is asked most and was the only place it could not be answered.
 *
 * Which sheet depends on what happened to the article, and that is the whole
 * point: a SENT article opens the email it actually went out in, a QUEUED one
 * opens the preview of the sheet it is about to go out in. Anything held or
 * excluded has no sheet to open and says so rather than offering a dead button.
 *
 * Marking runs through the shared sheet-mark module, the same one the delivered
 * archive and the preview use, so all three agree on which card an article is.
 */
export function SheetJump({
  disposition,
  url,
  sentReport,
}: {
  disposition: string;
  url: string;
  sentReport: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const marked = useMemo(() => (html ? markArticle(html, url) : null), [html, url]);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!marked) { setSrc(null); return; }
    const u = URL.createObjectURL(new Blob([marked], { type: 'text/html;charset=utf-8' }));
    setSrc(`${u}#${HIGHLIGHT_ID}`);
    return () => URL.revokeObjectURL(u);
  }, [marked]);

  // Queued: the sheet does not exist yet, so the preview is the honest answer.
  if (disposition === 'QUEUED') return <EmailPreview target={url} compact />;
  if (disposition !== 'SENT' || !sentReport) {
    return <span className="text-xs text-ink-600">not in a sheet</span>;
  }

  const load = async () => {
    setOpen(true);
    setHtml(null);
    setError(null);
    try {
      const r = await fetch(`/api/report?date=${sentReport}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setHtml((await r.json()).html);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <button
        onClick={load}
        className="whitespace-nowrap rounded-md border border-ink-700 px-2.5 py-1 text-xs
                   text-ink-200 transition hover:border-brief-a hover:text-brief-a"
      >
        View in sheet →
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
                <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">As delivered</p>
                <p className="text-sm font-semibold text-ink-100">
                  Industry Daily Report — sent {sentReport}
                </p>
                <p className="text-[11px] text-blocked">
                  this article outlined — the emailed sheet carried no highlight
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-ink-300 hover:text-ink-100"
              >
                Close (Esc)
              </button>
            </header>
            <div className="flex-1 overflow-hidden bg-white">
              {error ? (
                <p className="p-6 text-sm text-blocked">{error}</p>
              ) : src === null ? (
                <p className="p-6 text-sm text-ink-600">Loading…</p>
              ) : (
                <iframe title={`Report ${sentReport}`} src={src} sandbox="" className="h-full w-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
