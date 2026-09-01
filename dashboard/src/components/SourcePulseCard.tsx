'use client';

import { useState } from 'react';
import type { SourcePulse } from '@/lib/queries';

/**
 * The brief's links, alive or not — shared by the Sources tab and the Daily
 * report so both read from the same pulse and cannot disagree.
 *
 * The three counts are the filter. Clicking one shows exactly those sources
 * and clicking it again closes them: a number the reader cannot open is a
 * number they have to take on trust, and "59 producing" was previously just
 * that — a figure with nothing behind it.
 *
 * Counted by ARTICLES ARRIVING, never by fetch status: a fetch can return 200
 * and hand back navigation instead of stories, which is exactly how VicGrid
 * looked healthy while producing nothing.
 */

type Group = 'producing' | 'quiet' | 'inactive';

export function SourcePulseCard({ pulse }: { pulse: SourcePulse }) {
  const [open, setOpen] = useState<Group | null>(null);
  const toggle = (g: Group) => setOpen(open === g ? null : g);

  const chip = (g: Group, n: number, label: string, tone: string) => (
    <button
      onClick={() => toggle(g)}
      className={`rounded-md border px-2.5 py-1 text-sm transition ${
        open === g ? 'border-brief-a bg-brief-a/10' : 'border-transparent hover:border-ink-700'
      }`}
    >
      <b className={`tnum ${tone}`}>{n}</b>{' '}
      <span className="text-ink-300">{label}</span>
      <span className="ml-1 text-[10px] text-ink-500">{open === g ? '▾' : '▸'}</span>
    </button>
  );

  const row = (key: string, brief: number | null, name: string, meta: string) => (
    <li key={key} className="border-b border-ink-800/50 py-1 last:border-0">
      <span className="text-ink-200">
        {brief != null ? `#${brief} · ` : ''}{name}
      </span>
      <span className="text-ink-500"> {meta}</span>
    </li>
  );

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-ink-400">Brief links, live</span>
        {chip('producing', pulse.producing, 'producing', 'text-green-300')}
        {chip('quiet', pulse.quiet, 'quiet 3 days', 'text-amber-300')}
        {chip('inactive', pulse.inactive, 'inactive', 'text-ink-400')}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
        Producing = at least one article held from the last 3 days. Quiet = checked and answering,
        but no articles held — a publisher that posts occasionally, a listing that hands back
        navigation instead of stories, or history cleared by a prune. Inactive = switched off in the
        registry on purpose; the reason is recorded beside it. Click any number to see which.
      </p>

      {open && (
        <ul className="mt-2 max-h-72 overflow-y-auto text-xs">
          {open === 'producing' && pulse.producing_list.map(s =>
            row('p' + s.name, s.brief_n, s.name,
              `[${s.method}] · ${s.recent} article${s.recent === 1 ? '' : 's'} in 3 days`))}

          {open === 'quiet' && pulse.quiet_list.map(s =>
            row('q' + s.name, s.brief_n, s.name,
              `[${s.method}] · ${s.last_article ? `last article held ${s.last_article}` : 'no articles held'}`
              + ` · checked ${s.last_checked ?? 'never'}`))}

          {open === 'inactive' && pulse.inactive_list.map(s =>
            row('i' + s.name, s.brief_n, s.name,
              s.note ? `— ${s.note.slice(0, 150)}` : '— no reason recorded'))}
        </ul>
      )}
    </div>
  );
}
