'use client';

import { useMemo, useState } from 'react';
import type { PreviewRow } from '@/lib/queries';
import { EmailPreview } from './EmailPreview';

/**
 * The queue for tomorrow's 05:00, filterable the same way the archive is.
 *
 * Same client-side discipline as DeliveredSheets: every queued row is already
 * on the page, so search and the dropdowns are instant, and the pagination
 * beneath them pages the FILTERED set. The Published column shows the
 * publisher's own date where one was read — a page opened and found dateless
 * says so, and anything whose age is unverified never reaches this table at
 * all (the report gate refuses it upstream).
 */

const PAGE = 20;

export function QueuedSheet({ rows, day }: { rows: PreviewRow[]; day: string }) {
  const [q, setQ] = useState('');
  const [srcF, setSrcF] = useState('');
  const [secF, setSecF] = useState('');
  const [bodyF, setBodyF] = useState('');
  const [datedF, setDatedF] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r =>
      (!needle || r.title.toLowerCase().includes(needle)) &&
      (!srcF || r.source_name === srcF) &&
      (!secF || r.category === secF) &&
      (!bodyF || (bodyF === 'article' ? r.body_chars > 200 : r.body_chars <= 200)) &&
      (!datedF || (datedF === 'dated' ? r.published_at !== null : r.published_at === null))
    );
  }, [rows, q, srcF, secF, bodyF, datedF]);

  const options = useMemo(() => ({
    sources: [...new Set(rows.map(r => r.source_name))].sort(),
    sections: [...new Set(rows.map(r => r.category))].sort(),
  }), [rows]);

  const filtering = !!(q.trim() || srcF || secF || bodyF || datedF);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);
  const setAnd = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const inputCls =
    'rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100';

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-400">
        Nothing is queued for the next send yet — articles gathered today appear here as the
        scorer works through them.
      </p>
    );
  }

  return (
    <>
      <p className="mb-3 text-xs text-ink-400">
        Covering the {day} publication day. Everything gathered today waits for
        tomorrow&rsquo;s 05:00 — nothing fetched today is sent today.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={e => setAnd(setQ)(e.target.value)}
          placeholder="search queued titles…"
          className={`w-56 ${inputCls} placeholder:text-ink-500 focus:border-brief-a focus:outline-none`}
        />
        <select value={srcF} onChange={e => setAnd(setSrcF)(e.target.value)} className={`max-w-[18rem] ${inputCls}`}>
          <option value="">every source</option>
          {options.sources.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={secF} onChange={e => setAnd(setSecF)(e.target.value)} className={inputCls}>
          <option value="">every section</option>
          {options.sections.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={bodyF} onChange={e => setAnd(setBodyF)(e.target.value)} className={inputCls}>
          <option value="">read in full or teaser</option>
          <option value="article">read in full</option>
          <option value="teaser">teaser only</option>
        </select>
        <select value={datedF} onChange={e => setAnd(setDatedF)(e.target.value)} className={inputCls}>
          <option value="">dated or dateless</option>
          <option value="dated">publisher dated</option>
          <option value="undated">no date on the page</option>
        </select>
        {filtering && (
          <button
            onClick={() => { setQ(''); setSrcF(''); setSecF(''); setBodyF(''); setDatedF(''); setPage(1); }}
            className="text-xs text-ink-400 hover:text-ink-200"
          >
            clear
          </button>
        )}
        <span className="ml-auto text-xs text-ink-500 tnum">
          {filtered.length} of {rows.length} queued
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 text-left text-[10px] uppercase tracking-wide text-ink-400">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Score</th>
              <th className="px-2 py-2">Article</th>
              <th className="px-2 py-2">Section</th>
              <th className="px-2 py-2">Published</th>
              <th className="px-2 py-2">Written from</th>
              <th className="px-2 py-2">Fetched</th>
              <th className="px-2 py-2">In the sheet</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id} className="border-b border-ink-800/60 align-top">
                {/* Position in the FILTERED queue, so "article 23" means the
                    same thing to two people looking at the same filters. */}
                <td className="px-2 py-2 tnum text-ink-500">{(page - 1) * PAGE + i + 1}</td>
                <td className="px-2 py-2 tnum text-ink-300">{r.score ?? '–'}</td>
                <td className="max-w-[28rem] px-2 py-2">
                  <a href={r.url} target="_blank" rel="noreferrer"
                     className="font-medium text-brief-a hover:underline">
                    {r.title}
                  </a>
                  <div className="text-xs text-ink-500">
                    {r.brief_n ? `#${r.brief_n} · ` : ''}{r.source_name}
                  </div>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-400">{r.category}</td>
                {/* The publisher's own word on when this is from — the column
                    that separates provably-new from checked-but-dateless. */}
                <td className="whitespace-nowrap px-2 py-2 text-xs">
                  {r.published_at ? (
                    <span className="text-green-300">{r.published_at}</span>
                  ) : (
                    <span className="text-amber-300">no date on page</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs">
                  {r.body_chars > 200 ? (
                    <span className="text-green-300">article · {r.body_chars.toLocaleString()} chars</span>
                  ) : (
                    <span className="text-amber-300">teaser only</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-400">{r.fetched_at}</td>
                <td className="px-2 py-2">
                  <EmailPreview target={r.url} compact />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 && (
            <button onClick={() => setPage(page - 1)}
                    className="rounded border border-ink-700 px-3 py-1 hover:border-brief-a">
              ← prev
            </button>
          )}
          <span className="text-ink-400">page {page} of {pages}</span>
          {page < pages && (
            <button onClick={() => setPage(page + 1)}
                    className="rounded border border-ink-700 px-3 py-1 hover:border-brief-a">
              next →
            </button>
          )}
        </div>
      )}
    </>
  );
}
