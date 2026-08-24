import type { CycleStatus } from '@/lib/queries';

/**
 * One pill for a cycle's place in the eight-step flow. Colour tracks whose turn
 * it is: blue while the machine works, amber when it is waiting on a person,
 * green once published, muted when failed or abandoned. The label is what the
 * human does next, not the internal status name.
 */
const MAP: Record<CycleStatus, { label: string; tone: 'ai' | 'you' | 'done' | 'dead' }> = {
  queued_topics: { label: 'Scanning', tone: 'ai' },
  scanning: { label: 'Scanning', tone: 'ai' },
  topics_ready: { label: 'Pick a topic', tone: 'you' },
  queued_drafts: { label: 'Drafting', tone: 'ai' },
  drafting: { label: 'Drafting', tone: 'ai' },
  drafts_ready: { label: 'Review drafts', tone: 'you' },
  approved: { label: 'Approved', tone: 'you' },
  published: { label: 'Published', tone: 'done' },
  failed: { label: 'Failed', tone: 'dead' },
  abandoned: { label: 'Closed', tone: 'dead' },
};

const TONE = {
  ai: 'bg-brief-b/15 text-brief-b border-brief-b/30',
  you: 'bg-warn/15 text-warn border-warn/30',
  done: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  dead: 'bg-ink-800 text-ink-400 border-ink-700',
} as const;

export function ContentStatus({ status }: { status: CycleStatus }) {
  const m = MAP[status] ?? MAP.failed;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[m.tone]}`}>
      {m.label}
    </span>
  );
}

/** True while the machine is working — the workspace polls itself in this state. */
export const isTransient = (s: CycleStatus) =>
  s === 'queued_topics' || s === 'scanning' || s === 'queued_drafts' || s === 'drafting';
