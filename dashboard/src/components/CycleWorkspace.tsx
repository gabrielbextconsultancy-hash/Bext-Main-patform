'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { CycleRow, TopicRow, DraftRow } from '@/lib/queries';
import { ContentStatus, isTransient } from './ContentStatus';

/**
 * One cycle, from three topics to an approved post. The screen it shows is the
 * screen the cycle's status calls for, so a human always lands on the one thing
 * that is theirs to do next:
 *
 *   topics_ready -> pick a topic, add the perspective            (TopicPicker)
 *   drafting     -> a spinner that polls until the drafts arrive
 *   drafts_ready -> review two variants, edit, approve one       (DraftReview)
 *   approved     -> the slot, and a place to confirm it went out
 *   published    -> the performance register
 *
 * Every action POSTs to /api/content/action; nothing is written here directly.
 */
async function act(action: string, fields: Record<string, unknown>) {
  const res = await fetch('/api/content/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'action failed');
  return data;
}

export function CycleWorkspace({
  cycle,
  topics,
  drafts,
}: {
  cycle: CycleRow;
  topics: TopicRow[];
  drafts: DraftRow[];
}) {
  const router = useRouter();

  // While the machine works, refresh on an interval so the next screen appears
  // without the human reloading. Cheap: the page is already force-dynamic.
  useEffect(() => {
    if (!isTransient(cycle.status)) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [cycle.status, router]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-100">
            Cycle · {cycle.window_start} → {cycle.window_end}
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            {cycle.trigger === 'schedule' ? 'Opened on the fortnightly schedule.' : 'Started by hand.'}
          </p>
        </div>
        <ContentStatus status={cycle.status} />
      </header>

      {cycle.error && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{cycle.error}</p>
      )}

      {isTransient(cycle.status) && <Working status={cycle.status} />}

      {cycle.status === 'topics_ready' && (
        <TopicPicker cycle={cycle} topics={topics} onDone={() => router.refresh()} />
      )}

      {(cycle.status === 'drafts_ready' || cycle.status === 'approved' || cycle.status === 'published') && (
        <DraftReview cycle={cycle} drafts={drafts} onDone={() => router.refresh()} />
      )}

      {cycle.status === 'failed' && (
        <p className="rounded-lg border border-ink-800 bg-ink-900/60 p-6 text-sm text-ink-400">
          This cycle produced nothing usable. Start a fresh one from the hub.
        </p>
      )}
    </div>
  );
}

function Working({ status }: { status: string }) {
  const what = status === 'scanning' || status === 'queued_topics' ? 'Ranking three topics from the fortnight'
    : 'Writing two drafts, scrubbing and fact-checking them';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-brief-b/30 bg-brief-b/5 p-5">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brief-b" />
      <p className="text-sm text-ink-200">{what}… this page updates itself.</p>
    </div>
  );
}

// ── Topic selection ──────────────────────────────────────────────────────────

function TopicPicker({ cycle, topics, onDone }: { cycle: CycleRow; topics: TopicRow[]; onDone: () => void }) {
  const [pick, setPick] = useState<number | null>(topics[0]?.id ?? null);
  const [perspective, setPerspective] = useState(cycle.human_perspective ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      await act('select_topic', { cycle_id: cycle.id, topic_id: pick, perspective });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not select the topic');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-400">
        Three ranked options. Pick one, and add what BEXT actually thinks — the one thing the machine cannot supply.
      </p>
      <div className="space-y-3">
        {topics.map((t) => (
          <label
            key={t.id}
            className={`block cursor-pointer rounded-xl border p-4 transition ${
              pick === t.id ? 'border-brief-b bg-brief-b/5' : 'border-ink-800 hover:border-ink-700'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="topic"
                checked={pick === t.id}
                onChange={() => setPick(t.id)}
                className="mt-1 accent-brief-b"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">#{t.rank}</span>
                  {t.rank === 1 && <span className="rounded bg-brief-b/15 px-1.5 py-0.5 text-[10px] text-brief-b">recommended</span>}
                  {t.score != null && <span className="text-[10px] text-ink-600">score {t.score}</span>}
                </div>
                <h3 className="mt-1 text-sm font-semibold text-ink-100">{t.title}</h3>
                <p className="mt-1 text-[13px] text-ink-400">{t.rationale}</p>
                {t.angle && <p className="mt-1 text-[13px] text-ink-300"><span className="text-ink-500">Angle: </span>{t.angle}</p>}
                {t.sources.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-ink-500 hover:text-ink-300">
                      {t.sources.length} supporting source{t.sources.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {t.sources.map((s) => (
                        <li key={s.id} className="text-[12px]">
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-ink-400 hover:text-ink-200 hover:underline">
                            {s.title}
                          </a>
                          <span className="ml-1 text-[10px] text-ink-600">{s.source}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink-300">Your perspective</label>
        <textarea
          value={perspective}
          onChange={(e) => setPerspective(e.target.value)}
          rows={3}
          placeholder="What does BEXT think about this? A sentence or two. The drafts are built around it."
          className="w-full rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-brief-b focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-warn">{error}</p>}
      <button
        onClick={submit}
        disabled={!pick || busy}
        className="rounded-lg bg-brief-b px-4 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Sending to the drafter…' : 'Generate the drafts'}
      </button>
    </div>
  );
}

// ── Draft review, approval, publishing ───────────────────────────────────────

function DraftReview({ cycle, drafts, onDone }: { cycle: CycleRow; drafts: DraftRow[]; onDone: () => void }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        {drafts.map((d) => (
          <DraftCard key={d.id} draft={d} locked={cycle.status !== 'drafts_ready'} onDone={onDone} />
        ))}
      </div>
      {(cycle.status === 'approved' || cycle.status === 'published') && (
        <PublishPanel drafts={drafts} onDone={onDone} />
      )}
    </div>
  );
}

function DraftCard({ draft, locked, onDone }: { draft: DraftRow; locked: boolean; onDone: () => void }) {
  const [copy, setCopy] = useState(draft.final_copy ?? draft.body);
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blockers = draft.audit?.blockers ?? [];
  const warnings = draft.audit?.warnings ?? [];
  const unresolved = draft.claims.filter((c) => c.verdict !== 'supported');

  async function approve() {
    setBusy('approve');
    setError(null);
    try {
      await act('approve_draft', { draft_id: draft.id, final_copy: copy, post_at: slot || null, approved_by: 'dashboard' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not approve');
      setBusy(null);
    }
  }
  async function reject() {
    setBusy('reject');
    try {
      await act('reject_draft', { draft_id: draft.id, reason: 'rejected in review' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not reject');
      setBusy(null);
    }
  }

  return (
    <div className={`flex flex-col rounded-xl border p-4 ${draft.recommended ? 'border-brief-b/50' : 'border-ink-800'} ${draft.status === 'rejected' ? 'opacity-50' : ''}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-ink-100">Variant {draft.variant}</span>
        {draft.recommended && <span className="rounded bg-brief-b/15 px-1.5 py-0.5 text-[10px] text-brief-b">recommended</span>}
        <span className="text-[10px] text-ink-600">{draft.formula} · aims for {draft.goal}</span>
        <span className="ml-auto text-[10px] text-ink-600">{draft.char_count} chars</span>
      </div>

      {/* Hook, rendered against the fold */}
      <p className="rounded-lg bg-ink-950 p-2 text-[13px] text-ink-200">
        {draft.hook}
        <span className="text-ink-600"> … see more</span>
      </p>

      {locked ? (
        <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink-950 p-3 text-[13px] text-ink-300">{copy}</pre>
      ) : (
        <textarea
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          rows={10}
          className="mt-2 w-full flex-1 rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-[13px] text-ink-100 focus:border-brief-b focus:outline-none"
        />
      )}

      {/* Visual concept, CTA, destination */}
      <dl className="mt-2 space-y-1 text-[12px]">
        {draft.visual_concept && <div><dt className="inline text-ink-500">Visual: </dt><dd className="inline text-ink-300">{draft.visual_concept}</dd></div>}
        {draft.cta && <div><dt className="inline text-ink-500">CTA: </dt><dd className="inline text-ink-300">{draft.cta}</dd></div>}
        {draft.destination_url && <div><dt className="inline text-ink-500">Link (first comment): </dt><dd className="inline"><a className="text-brief-b hover:underline" href={draft.destination_url} target="_blank" rel="noopener noreferrer">{draft.destination_url}</a></dd></div>}
      </dl>

      {/* Audit */}
      {(blockers.length > 0 || warnings.length > 0) && (
        <div className="mt-2 space-y-1">
          {blockers.map((b, i) => (
            <p key={`b${i}`} className="text-[11px] text-warn">● {b.rule}: {b.detail}</p>
          ))}
          {warnings.map((w, i) => (
            <p key={`w${i}`} className="text-[11px] text-ink-500">○ {w.rule}: {w.detail}</p>
          ))}
        </div>
      )}

      {/* Fact-check */}
      <details className="mt-2" open={unresolved.length > 0}>
        <summary className="cursor-pointer text-[11px] text-ink-400">
          Fact check · {draft.claims.length} claims{unresolved.length > 0 ? `, ${unresolved.length} to check` : ', all sourced'}
        </summary>
        <ul className="mt-1 space-y-1">
          {draft.claims.map((c) => (
            <li key={c.id} className="text-[12px]">
              <span className={c.verdict === 'supported' ? 'text-emerald-400' : c.verdict === 'unsupported' ? 'text-warn' : 'text-ink-500'}>
                {c.verdict === 'supported' ? '✓' : c.verdict === 'unsupported' ? '✗' : '?'}
              </span>{' '}
              <span className="text-ink-300">{c.claim}</span>
              {c.source_url && (
                <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="ml-1 text-[10px] text-brief-b hover:underline">source</a>
              )}
              {c.source_quote && <span className="block pl-4 text-[11px] italic text-ink-600">“{c.source_quote}”</span>}
            </li>
          ))}
        </ul>
      </details>

      {error && <p className="mt-2 text-[12px] text-warn">{error}</p>}

      {!locked && draft.status === 'draft' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-800 pt-3">
          <input
            type="datetime-local"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            className="rounded-md border border-ink-800 bg-ink-950 px-2 py-1 text-xs text-ink-200"
          />
          <button onClick={approve} disabled={busy !== null} className="rounded-md bg-brief-b px-3 py-1.5 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50">
            {busy === 'approve' ? 'Approving…' : 'Approve this one'}
          </button>
          <button onClick={reject} disabled={busy !== null} className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-400 transition hover:border-warn hover:text-warn disabled:opacity-50">
            Reject
          </button>
          <span className="text-[10px] text-ink-600">Leave the slot blank to post as soon as approved.</span>
        </div>
      )}
      {draft.status === 'approved' && <p className="mt-3 border-t border-ink-800 pt-2 text-[11px] text-warn">Approved{draft.post_at ? ` · scheduled ${draft.post_at}` : ''}.</p>}
      {draft.status === 'published' && <p className="mt-3 border-t border-ink-800 pt-2 text-[11px] text-emerald-400">Published{draft.published_at ? ` · ${draft.published_at}` : ''}.</p>}
    </div>
  );
}

function PublishPanel({ drafts, onDone }: { drafts: DraftRow[]; onDone: () => void }) {
  const approved = drafts.find((d) => d.status === 'approved' || d.status === 'published');
  const [url, setUrl] = useState(approved?.post_url ?? '');
  const [perf, setPerf] = useState({ impressions: '', reactions: '', comments: '', reposts: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!approved) return null;

  async function markPublished() {
    setBusy('publish');
    setError(null);
    try {
      await act('mark_published', { draft_id: approved!.id, post_url: url });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not mark published');
      setBusy(null);
    }
  }
  async function recordPerf() {
    setBusy('perf');
    setError(null);
    try {
      await act('record_performance', { draft_id: approved!.id, ...perf, recorded_by: 'dashboard' });
      setPerf({ impressions: '', reactions: '', comments: '', reposts: '' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not record');
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
      <h3 className="text-sm font-semibold text-ink-100">Publish and record</h3>
      <p className="mt-0.5 text-xs text-ink-400">
        {approved.status === 'published'
          ? 'Published. Add a performance reading whenever you check it.'
          : 'Post it manually on LinkedIn, then paste the post URL here to close the loop.'}
      </p>

      {approved.status !== 'published' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.linkedin.com/posts/…"
            className="min-w-[280px] flex-1 rounded-md border border-ink-800 bg-ink-950 px-2 py-1.5 text-xs text-ink-200"
          />
          <button onClick={markPublished} disabled={busy !== null} className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50">
            {busy === 'publish' ? 'Saving…' : 'Mark as published'}
          </button>
        </div>
      )}

      <div className="mt-4 border-t border-ink-800 pt-3">
        <p className="mb-2 text-xs font-medium text-ink-300">Performance reading</p>
        <div className="flex flex-wrap gap-2">
          {(['impressions', 'reactions', 'comments', 'reposts'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-[11px] text-ink-500">
              {k}
              <input
                type="number"
                value={perf[k]}
                onChange={(e) => setPerf({ ...perf, [k]: e.target.value })}
                className="w-20 rounded border border-ink-800 bg-ink-950 px-1.5 py-1 text-xs text-ink-200"
              />
            </label>
          ))}
          <button onClick={recordPerf} disabled={busy !== null} className="rounded-md border border-ink-700 px-3 py-1 text-xs text-ink-300 transition hover:border-brief-b hover:text-brief-b disabled:opacity-50">
            {busy === 'perf' ? 'Saving…' : 'Add reading'}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-[12px] text-warn">{error}</p>}
    </div>
  );
}
