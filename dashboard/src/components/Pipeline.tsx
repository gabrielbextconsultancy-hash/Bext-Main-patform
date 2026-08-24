'use client';

import { useEffect, useState } from 'react';
import type { CycleStatus } from '@/lib/queries';

/**
 * The pipeline a cycle runs through, drawn as the nodes it actually is in n8n.
 *
 * The three content workflows (BEXT — Content Topics / Content Drafts / LinkedIn
 * Publish) plus the two human gates between them, laid out as one left-to-right
 * flow. The node labels are the real n8n node names, so this reads as the same
 * pipeline that runs on the server.
 *
 * The cycle status only tells us the phase, not the individual node (a workflow
 * runs in seconds), so within an active machine phase the display steps through
 * that phase's nodes on a short timer to show progress. When the status advances,
 * the phase is marked done. It is a faithful map, animated where it cannot be
 * measured.
 */

type Actor = 'n8n' | 'you';

interface Phase {
  key: string;
  title: string;
  actor: Actor;
  workflow?: string;
  nodes: string[];
  /** Statuses for which this phase is the one currently running / waiting. */
  active: CycleStatus[];
}

const PHASES: Phase[] = [
  {
    key: 'scan',
    title: 'Scan & rank',
    actor: 'n8n',
    workflow: 'BEXT — Content Topics',
    nodes: ['Claim a cycle', 'Load the 14-day window', 'Rank three topics (Gemini)', 'Save topics'],
    active: ['queued_topics', 'scanning'],
  },
  {
    key: 'pick',
    title: 'Pick a topic',
    actor: 'you',
    nodes: ['Choose 1 of 3', 'Add the perspective'],
    active: ['topics_ready'],
  },
  {
    key: 'draft',
    title: 'Draft',
    actor: 'n8n',
    workflow: 'BEXT — Content Drafts',
    nodes: ['Load topic & sources', 'Write two variants (Gemini)', 'Scrub AI tells', 'Audit', 'Fact-check claims', 'Save drafts'],
    active: ['queued_drafts', 'drafting'],
  },
  {
    key: 'review',
    title: 'Review & approve',
    actor: 'you',
    nodes: ['Edit', 'Approve one', 'Pick a slot'],
    active: ['drafts_ready'],
  },
  {
    key: 'publish',
    title: 'Publish',
    actor: 'n8n',
    workflow: 'BEXT — LinkedIn Publish',
    nodes: ['Due post', 'Prepare / post', 'Record result'],
    active: ['approved'],
  },
  {
    key: 'done',
    title: 'Published',
    actor: 'you',
    nodes: ['Live on LinkedIn', 'Record performance'],
    active: ['published'],
  },
];

const ORDER: CycleStatus[] = [
  'queued_topics', 'scanning', 'topics_ready',
  'queued_drafts', 'drafting', 'drafts_ready',
  'approved', 'published',
];

const activePhaseIndex = (status: CycleStatus) => {
  const i = PHASES.findIndex((p) => p.active.includes(status));
  if (i >= 0) return i;
  if (status === 'failed' || status === 'abandoned') return -1;
  return 0;
};

const isMachineRunning = (status: CycleStatus) =>
  status === 'queued_topics' || status === 'scanning' || status === 'queued_drafts' || status === 'drafting';

export function Pipeline({ status }: { status: CycleStatus }) {
  const activeIdx = activePhaseIndex(status);
  const running = isMachineRunning(status);

  // Step through the active phase's nodes while the machine is working.
  const activeNodes = activeIdx >= 0 ? PHASES[activeIdx].nodes.length : 0;
  const [node, setNode] = useState(0);
  useEffect(() => {
    if (!running || activeNodes === 0) return;
    setNode(0);
    const t = setInterval(() => setNode((n) => (n + 1) % activeNodes), 900);
    return () => clearInterval(t);
  }, [running, activeNodes, status]);

  const failed = status === 'failed' || status === 'abandoned';

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">Pipeline</h3>
        <span className="text-[10px] text-ink-600">the nodes this runs as in n8n</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {PHASES.map((p, i) => {
          const state = failed ? 'dead' : i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
          return (
            <div key={p.key} className="flex items-stretch">
              <PhaseCard phase={p} state={state} activeNode={i === activeIdx && running ? node : -1} />
              {i < PHASES.length - 1 && (
                <div className="flex items-center px-1">
                  <span className={`text-lg ${i < activeIdx ? 'text-brief-b' : 'text-ink-700'}`}>›</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhaseCard({
  phase,
  state,
  activeNode,
}: {
  phase: Phase;
  state: 'done' | 'active' | 'todo' | 'dead';
  activeNode: number;
}) {
  const ring =
    state === 'active' ? 'border-brief-b/60 bg-brief-b/5'
    : state === 'done' ? 'border-emerald-500/30 bg-emerald-500/5'
    : state === 'dead' ? 'border-ink-800 bg-ink-900/40 opacity-60'
    : 'border-ink-800 bg-ink-900/40';

  const actorPill =
    phase.actor === 'n8n' ? 'bg-brief-b/15 text-brief-b' : 'bg-warn/15 text-warn';

  return (
    <div className={`min-w-[168px] rounded-lg border p-2.5 ${ring}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${actorPill}`}>
          {phase.actor === 'n8n' ? 'n8n' : 'you'}
        </span>
        <span className="text-[11px] font-semibold text-ink-100">{phase.title}</span>
        {state === 'done' && <span className="ml-auto text-[11px] text-emerald-400">✓</span>}
        {state === 'active' && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-brief-b" />}
      </div>
      {phase.workflow && <p className="mb-1 truncate text-[9px] text-ink-600">{phase.workflow}</p>}
      <ul className="space-y-0.5">
        {phase.nodes.map((n, idx) => {
          const on = idx === activeNode;
          const past = state === 'done' || (state === 'active' && activeNode >= 0 && idx < activeNode);
          return (
            <li
              key={n}
              className={`flex items-center gap-1 text-[10.5px] transition ${
                on ? 'text-brief-b' : past ? 'text-ink-400' : state === 'active' ? 'text-ink-300' : 'text-ink-500'
              }`}
            >
              <span
                className={`inline-block h-1 w-1 shrink-0 rounded-full ${
                  on ? 'bg-brief-b' : past ? 'bg-emerald-500' : 'bg-ink-700'
                }`}
              />
              <span className="truncate">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
