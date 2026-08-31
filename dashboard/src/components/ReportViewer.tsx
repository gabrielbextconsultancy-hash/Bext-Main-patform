'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeliveredRow } from '@/lib/queries';

/**
 * The delivered articles as a table, and the sheet each one went out in.
 *
 * The HTML is rendered inside a sandboxed iframe rather than injected into the
 * page: it is email HTML with its own inline styles, and letting it into the
 * document would let those styles bleed into the dashboard. A sandbox with no
 * allow-scripts also means nothing in a fetched article title can execute here.
 *
 * Opening a row marks that article in the sheet with a red outline. The marking
 * happens HERE, in the browser, on a copy of the HTML — the stored report is
 * never modified and what the client received never carried it. It is a reading
 * aid for this panel and exists nowhere else.
 */

const HIGHLIGHT_ID = 'bext-highlighted-article';

/**
 * Return a copy of the sheet with the card containing `url` outlined.
 *
 * Parsed with DOMParser rather than matched with a regex: the card is an
 * ancestor of the link, not a string near it, and email HTML nests tables
 * several deep. Parsing does not execute anything — DOMParser builds an inert
 * document — and the result is serialised straight back to a string.
 */
function markArticle(html: string, url: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Each card links the article twice — once around the image, once around
    // the headline. Prefer the one carrying text: the image anchor's nearest
    // cell holds only the picture, and outlining that marks a photograph rather
    // than an article. Measured on the 31 Aug sheet, the image cell scored 0
    // characters against the headline cell's 419.
    const exact = Array.from(doc.querySelectorAll(`a[href="${CSS.escape(url)}"]`));
    const byPath = exact.length
      ? []
      // Sheets link the publisher URL; the row may carry the canonical one, so
      // fall back to matching on the path when the full URL does not hit.
      : Array.from(doc.querySelectorAll('a')).filter(a => {
          try {
            return new URL(a.getAttribute('href') ?? '', url).pathname === new URL(url).pathname;
          } catch {
            return false;
          }
        });
    const candidates = exact.length ? exact : byPath;
    const link =
      candidates.find(a => (a.textContent ?? '').trim().length > 10) ?? candidates[0];
    if (!link) return html;

    // Walk out to the first ancestor cell that actually holds the card's prose,
    // rather than the first cell of any kind.
    let card: Element = link;
    for (let i = 0; i < 8 && card.parentElement; i += 1) {
      card = card.parentElement;
      if (
        (card.tagName === 'TD' || card.tagName === 'TABLE') &&
        (card.textContent ?? '').trim().length > 80
      ) break;
    }

    card.setAttribute('id', HIGHLIGHT_ID);
    card.setAttribute(
      'style',
      `${card.getAttribute('style') ?? ''};outline:3px solid #ef4444;outline-offset:4px;` +
        'border-radius:6px;scroll-margin-top:24px;'
    );

    // A note at the top, so it is obvious the outline is ours and not the
    // client's copy. Placed in the body, not the stored row.
    const banner = doc.createElement('div');
    banner.setAttribute(
      'style',
      'background:#fee2e2;color:#991b1b;font:600 12px/1.5 Arial,sans-serif;' +
        'padding:8px 12px;border-bottom:1px solid #fecaca;'
    );
    banner.textContent =
      'Dashboard view only — the outlined article is the one you selected. The emailed report carried no highlight.';
    doc.body.insertBefore(banner, doc.body.firstChild);

    return '<!doctype html>' + doc.documentElement.outerHTML;
  } catch {
    // A sheet that will not parse is still worth showing, unmarked.
    return html;
  }
}

export function ReportViewer({
  dates,
  rows = [],
  total = 0,
  page = 1,
  pageSize = 20,
  prevHref = null,
  nextHref = null,
}: {
  dates: string[];
  rows?: DeliveredRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  // Precomputed hrefs, not a builder function: this is a client component, and
  // a function cannot cross the server boundary. TypeScript accepts the prop
  // happily and the page then 500s at request time, which is how this was
  // found — by fetching the page, not by compiling it.
  prevHref?: string | null;
  nextHref?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  const load = useCallback(async (date: string, url?: string) => {
    setOpen(date);
    setHtml(null);
    setError(null);
    setTarget(url ?? null);
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

  const marked = useMemo(
    () => (html && target ? markArticle(html, target) : html),
    [html, target]
  );

  // A blob URL rather than srcDoc, so the #fragment scrolls the sheet to the
  // outlined card on load. srcDoc has no URL, and therefore no fragment to
  // navigate to. Revoked when the modal closes.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!marked) { setSrc(null); return; }
    const u = URL.createObjectURL(new Blob([marked], { type: 'text/html' }));
    setSrc(target ? `${u}#${HIGHLIGHT_ID}` : u);
    return () => URL.revokeObjectURL(u);
  }, [marked, target]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {dates.length === 0 ? (
          <p className="text-sm text-ink-400">No reports to open yet.</p>
        ) : (
          dates.slice(0, 10).map(d => (
            <button
              key={d}
              onClick={() => load(d)}
              className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-100 transition hover:border-ink-600"
            >
              Open {d}
            </button>
          ))
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-2 py-2">Score</th>
                <th className="px-2 py-2">Article</th>
                <th className="px-2 py-2">Section</th>
                <th className="px-2 py-2">Written from</th>
                <th className="px-2 py-2">Sent</th>
                <th className="px-2 py-2">In the sheet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.report_date}-${r.id}`} className="border-b border-ink-800/60 align-top">
                  <td className="px-2 py-2 tnum text-ink-300">{r.score ?? '–'}</td>
                  <td className="max-w-[30rem] px-2 py-2">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-brief-a hover:underline"
                    >
                      {r.title}
                    </a>
                    <div className="text-xs text-ink-500">{r.source_name}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-400">{r.category}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">
                    {r.body_chars > 200 ? (
                      <span className="text-green-300">
                        article · {r.body_chars.toLocaleString()} chars
                      </span>
                    ) : (
                      <span className="text-amber-300">teaser only</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-300">
                    {r.report_date}
                    {r.sent_at && <div className="text-ink-500">{r.sent_at}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => load(r.report_date, r.url)}
                      className="whitespace-nowrap rounded-md border border-ink-700 px-2.5 py-1 text-xs
                                 text-ink-200 transition hover:border-brief-a hover:text-brief-a"
                    >
                      View in sheet →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 && prevHref && (
            <a href={prevHref} className="rounded border border-ink-700 px-3 py-1 hover:border-brief-a">
              ← prev
            </a>
          )}
          <span className="text-ink-400">
            page {page} of {pages} · {total} delivered
          </span>
          {page < pages && nextHref && (
            <a href={nextHref} className="rounded border border-ink-700 px-3 py-1 hover:border-brief-a">
              next →
            </a>
          )}
        </div>
      )}

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
                <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">As delivered</p>
                <p className="text-sm font-semibold text-ink-100">
                  Industry Daily Report — {open}
                </p>
                {target && (
                  <p className="text-[11px] text-blocked">
                    one article outlined for you — the emailed sheet had no highlight
                  </p>
                )}
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
              ) : src === null ? (
                <p className="p-6 text-sm text-ink-600">Loading…</p>
              ) : (
                <iframe
                  title={`Report ${open}`}
                  src={src}
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
