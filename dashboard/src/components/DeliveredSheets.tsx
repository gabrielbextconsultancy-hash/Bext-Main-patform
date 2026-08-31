'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DeliveredRow } from '@/lib/queries';
import { HIGHLIGHT_ID, markArticle } from './sheet-mark';

/**
 * The delivered archive as the operator reads it: day → source → articles.
 *
 * The flat table answered "what went out" but not "what did each brief link
 * contribute" — the question the Source references card already answers for
 * routes, and the shape asked for here. Native <details> accordions, so a
 * collapsed day costs nothing and the browser handles the state; only the
 * newest day starts open.
 *
 * Every article row keeps the jump into the sheet it was delivered in, marked
 * by the shared sheet-mark module — one implementation with the preview, so
 * the two can never disagree about which card an article is.
 */

interface DayGroup {
  date: string;
  covered: string;
  sources: { key: string; label: string; method: string; route: string | null; rows: DeliveredRow[] }[];
  items: number;
}

function groupRows(rows: DeliveredRow[]): DayGroup[] {
  const days = new Map<string, Map<string, DeliveredRow[]>>();
  for (const r of rows) {
    if (!days.has(r.report_date)) days.set(r.report_date, new Map());
    const bySrc = days.get(r.report_date)!;
    const key = r.source_id;
    if (!bySrc.has(key)) bySrc.set(key, []);
    bySrc.get(key)!.push(r);
  }
  return [...days].map(([date, bySrc]) => {
    const covered = new Date(date + 'T00:00:00');
    covered.setDate(covered.getDate() - 1);
    const sources = [...bySrc.values()].map(list => ({
      key: list[0].source_id,
      label: (list[0].brief_n ? `#${list[0].brief_n} · ` : '') + list[0].source_name,
      method: (list[0].source_method ?? 'scrape').toUpperCase(),
      route: list[0].source_route,
      rows: list,
    }));
    return {
      date,
      covered: covered.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      sources,
      items: sources.reduce((a, s) => a + s.rows.length, 0),
    };
  });
}

export function DeliveredSheets({ rows }: { rows: DeliveredRow[] }) {
  const groups = useMemo(() => groupRows(rows), [rows]);

  const [open, setOpen] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  const load = async (date: string, url?: string) => {
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
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const marked = useMemo(
    () => (html && target ? markArticle(html, target) : html),
    [html, target]
  );
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!marked) { setSrc(null); return; }
    const u = URL.createObjectURL(new Blob([marked], { type: 'text/html;charset=utf-8' }));
    setSrc(target ? `${u}#${HIGHLIGHT_ID}` : u);
    return () => URL.revokeObjectURL(u);
  }, [marked, target]);

  if (groups.length === 0) {
    return <p className="text-sm text-ink-400">Nothing delivered yet.</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {groups.map((g, gi) => (
          <details
            key={g.date}
            open={gi === 0}
            className="rounded-lg border border-ink-800 bg-ink-850/40"
          >
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-3 px-4 py-3">
              <span className="text-sm font-semibold text-ink-100">{g.covered}</span>
              <span className="text-xs text-ink-500">
                sent {g.date} · {g.sources.length} sources · {g.items} items
              </span>
              <button
                onClick={e => { e.preventDefault(); load(g.date); }}
                className="ml-auto rounded-md border border-ink-700 px-2.5 py-1 text-xs text-ink-200
                           transition hover:border-brief-a hover:text-brief-a"
              >
                Open the sheet →
              </button>
            </summary>

            <div className="space-y-1.5 px-3 pb-3">
              {g.sources.map(srcGroup => (
                <details key={g.date + srcGroup.key} className="rounded-md border border-ink-800/70">
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-3 py-2">
                    <span className="text-sm text-ink-100">{srcGroup.label}</span>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-400">
                      {srcGroup.method}
                    </span>
                    {srcGroup.route && (
                      <a
                        href={srcGroup.route}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="max-w-[26rem] truncate text-[11px] text-brief-a/80 hover:underline"
                      >
                        {srcGroup.route.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                    <span className="ml-auto text-xs text-ink-500 tnum">
                      {srcGroup.rows.length} item{srcGroup.rows.length === 1 ? '' : 's'}
                    </span>
                  </summary>

                  <div className="overflow-x-auto px-2 pb-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-ink-800 text-left text-[10px] uppercase tracking-wide text-ink-500">
                          <th className="px-2 py-1.5">Score</th>
                          <th className="px-2 py-1.5">Article</th>
                          <th className="px-2 py-1.5">Section</th>
                          <th className="px-2 py-1.5">Written from</th>
                          <th className="px-2 py-1.5">Sent</th>
                          <th className="px-2 py-1.5">In the sheet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {srcGroup.rows.map(r => (
                          <tr key={`${r.report_date}-${r.id}`} className="border-b border-ink-800/50 align-top">
                            <td className="px-2 py-2 tnum text-ink-300">{r.score ?? '–'}</td>
                            <td className="max-w-[26rem] px-2 py-2">
                              <a
                                href={r.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium text-brief-a hover:underline"
                              >
                                {r.title}
                              </a>
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-400">{r.category}</td>
                            <td className="whitespace-nowrap px-2 py-2 text-xs">
                              {r.body_chars > 200 ? (
                                <span className="text-green-300">article · {r.body_chars.toLocaleString()} chars</span>
                              ) : (
                                <span className="text-amber-300">teaser only</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-300">{r.sent_at ?? r.report_date}</td>
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
                </details>
              ))}
            </div>
          </details>
        ))}
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
                <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">As delivered</p>
                <p className="text-sm font-semibold text-ink-100">Industry Daily Report — sent {open}</p>
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
                <iframe title={`Report ${open}`} src={src} sandbox="" className="h-full w-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
