'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Slide {
  /** Small uppercase label above the title. */
  kicker: string;
  title: string;
  /** Optional standfirst under the title. */
  lede?: string;
  /** Groups slides under a heading in the header nav, so a reader can jump
   *  straight to a part of the plan instead of stepping through it. */
  section: string;
  body: React.ReactNode;
}

/**
 * Presents slides one at a time, like a deck rather than a scrolling page:
 * ← / → to move, F for fullscreen, dots to jump. Kept as a client component
 * because everything here is keyboard and view state.
 */
export function Deck({ slides, footer }: { slides: Slide[]; footer?: string }) {
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const shell = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (n: number) => setI(prev => Math.max(0, Math.min(slides.length - 1, typeof n === 'number' ? n : prev))),
    [slides.length]
  );

  const toggleFull = useCallback(() => {
    if (!document.fullscreenElement) shell.current?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(i + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(i - 1); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(slides.length - 1);
      else if (e.key.toLowerCase() === 'f') toggleFull();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, go, slides.length, toggleFull]);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const s = slides[i];

  // First slide index for each section, in slide order — the header jumps here.
  const sections: { name: string; at: number }[] = [];
  slides.forEach((sl, n) => {
    if (!sections.some(x => x.name === sl.section)) sections.push({ name: sl.section, at: n });
  });

  return (
    <div ref={shell} className={full ? 'flex h-screen flex-col bg-ink-950 p-8' : ''}>
      {/* Section header — jump straight to a part of the plan */}
      <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-ink-800 pb-3">
        {sections.map(sec => {
          const active = s.section === sec.name;
          return (
            <button
              key={sec.name}
              onClick={() => go(sec.at)}
              className={`rounded-lg px-2.5 py-1 text-xs transition ${
                active
                  ? 'bg-brief-b/15 text-brief-b ring-1 ring-inset ring-brief-b/30'
                  : 'text-ink-400 hover:bg-ink-850 hover:text-ink-100'
              }`}
            >
              {sec.name}
            </button>
          );
        })}
      </div>

      {/* Slide */}
      <article
        key={i}
        className={`relative flex flex-col rounded-2xl border border-ink-800 bg-gradient-to-br from-ink-900 to-ink-950 px-9 py-8 ${
          full ? 'flex-1' : 'min-h-[560px]'
        }`}
      >
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-400">{s.kicker}</p>
        <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink-100">{s.title}</h2>
        {s.lede && <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-ink-400">{s.lede}</p>}
        <div className="mt-6 flex-1 text-sm">{s.body}</div>
        <span className="absolute bottom-4 right-6 text-[11px] tabular-nums text-ink-600">
          {String(i + 1).padStart(2, '0')}
        </span>
      </article>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-ink-100 transition hover:border-ink-600 disabled:opacity-35"
        >
          ← Prev
        </button>
        <button
          onClick={() => go(i + 1)}
          disabled={i === slides.length - 1}
          className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-ink-100 transition hover:border-ink-600 disabled:opacity-35"
        >
          Next →
        </button>
        <span className="text-xs tabular-nums text-ink-400">
          {i + 1} / {slides.length}
        </span>

        <div className="flex min-w-0 flex-1 gap-1">
          {slides.map((sl, n) => (
            <button
              key={n}
              onClick={() => go(n)}
              title={`${n + 1}. ${sl.title}`}
              aria-label={`Slide ${n + 1}: ${sl.title}`}
              className={`h-1 min-w-0 flex-1 rounded-full transition ${
                n === i ? 'bg-brief-b' : 'bg-ink-800 hover:bg-ink-700'
              }`}
            />
          ))}
        </div>

        <button
          onClick={toggleFull}
          className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
        >
          {full ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>

      {footer && !full && <p className="mt-3 text-[11px] text-ink-600">{footer}</p>}
    </div>
  );
}

/* ── Small presentational helpers, shared by the slides ─────────────────── */

export function Cols({ n = 2, children }: { n?: 2 | 3 | 4; children: React.ReactNode }) {
  const cls = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[n];
  return <div className={`grid gap-3 ${cls}`}>{children}</div>;
}

export function Box({
  title,
  accent,
  children,
}: {
  title?: string;
  accent?: 'a' | 'b' | 'c';
  children: React.ReactNode;
}) {
  const edge =
    accent === 'a' ? 'border-l-2 border-l-brief-a'
    : accent === 'b' ? 'border-l-2 border-l-brief-b'
    : accent === 'c' ? 'border-l-2 border-l-warn'
    : '';
  return (
    <div className={`rounded-xl border border-ink-800 bg-ink-850/60 p-4 ${edge}`}>
      {title && <h3 className="mb-1.5 text-[13px] font-semibold text-ink-100">{title}</h3>}
      <div className="text-[13px] leading-relaxed text-ink-400">{children}</div>
    </div>
  );
}

export function Tag({ tone = 'n', children }: { tone?: 'a' | 'b' | 'c' | 'n'; children: React.ReactNode }) {
  const cls = {
    a: 'text-brief-a border-brief-a/40 bg-brief-a/10',
    b: 'text-brief-b border-brief-b/40 bg-brief-b/10',
    c: 'text-warn border-warn/40 bg-warn/10',
    n: 'text-ink-400 border-ink-700 bg-ink-800',
  }[tone];
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] ${cls}`}>
      {children}
    </span>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-ink-800 text-left">
            {head.map(h => (
              <th key={h} className="pb-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr key={n} className="border-b border-ink-800/50 last:border-0">
              {r.map((c, m) => (
                <td key={m} className="py-2 pr-3 align-top text-ink-300">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A step in a left-to-right process flow. */
export function Step({
  label,
  text,
  who,
}: {
  label: string;
  text: string;
  who?: 'ai' | 'you' | 'sys';
}) {
  const badge = {
    ai: 'bg-brief-b/15 text-brief-b',
    you: 'bg-warn/15 text-warn',
    sys: 'bg-brief-a/15 text-brief-a',
  };
  const word = { ai: 'AI', you: 'you', sys: 'system' };
  return (
    <div className="min-w-[124px] flex-1 rounded-lg border border-ink-800 bg-ink-850/60 p-3">
      <p className="text-[9.5px] uppercase tracking-[0.1em] text-ink-600">{label}</p>
      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-200">{text}</p>
      {who && (
        <span className={`mt-2 inline-block rounded px-1.5 py-0.5 text-[10px] ${badge[who]}`}>{word[who]}</span>
      )}
    </div>
  );
}

export function Flow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-stretch gap-2">{children}</div>;
}
