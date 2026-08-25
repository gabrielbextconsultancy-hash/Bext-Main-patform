'use client';

import { useState } from 'react';
import type { ArchitectureGraph, ArchitectureWorkflow, ArchitectureDomain } from '@/lib/architecture.generated';
import type { HealthRow, IncidentSummaryRow } from '@/lib/queries';

interface Props {
  graph: ArchitectureGraph;
  health: HealthRow[] | null;
  incidents: IncidentSummaryRow[] | null;
}

const DOMAIN_LABELS: Record<ArchitectureDomain | 'all', { label: string; color: string; bg: string; border: string }> = {
  all: { label: 'All Domains', color: '#f8fafc', bg: '#1e293b', border: '#475569' },
  brief_a: { label: 'Brief A (Daily Report)', color: '#14b8a6', bg: '#042f2e', border: '#0d9488' },
  content: { label: 'Content (LinkedIn)', color: '#f59e0b', bg: '#451a03', border: '#d97706' },
  brief_b: { label: 'Brief B (Meetings)', color: '#a78bfa', bg: '#2e1065', border: '#7c3aed' },
  ops: { label: 'Ops & Self-Healing', color: '#38bdf8', bg: '#082f49', border: '#0284c7' },
  cross_domain: { label: 'Cross-Domain', color: '#94a3b8', bg: '#1e293b', border: '#475569' },
};

export function ExcalidrawScene({ graph, health, incidents }: Props) {
  const [activeDomain, setActiveDomain] = useState<ArchitectureDomain | 'all'>('all');
  const [selectedWorkflow, setSelectedWorkflow] = useState<ArchitectureWorkflow | null>(null);
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState('');

  // Map open incidents by workflow name
  const openIncidentsByWf = new Map<string, IncidentSummaryRow[]>();
  if (incidents) {
    for (const inc of incidents) {
      if (!inc.resolved_at && (inc.outcome === 'attempted' || inc.outcome === 'failed' || inc.outcome === 'detected')) {
        const list = openIncidentsByWf.get(inc.workflow) || [];
        list.push(inc);
        openIncidentsByWf.set(inc.workflow, list);
      }
    }
  }

  // Filter workflows
  const filteredWorkflows = graph.workflows.filter(wf => {
    if (activeDomain !== 'all' && wf.domain !== activeDomain) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        wf.name.toLowerCase().includes(q) ||
        wf.slug.toLowerCase().includes(q) ||
        wf.tablesRead.some(t => t.toLowerCase().includes(q)) ||
        wf.tablesWritten.some(t => t.toLowerCase().includes(q)) ||
        wf.nodes.some(n => n.name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Controls & Filter Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'brief_a', 'content', 'brief_b', 'ops'] as const).map(dom => {
            const conf = DOMAIN_LABELS[dom];
            const isSelected = activeDomain === dom;
            return (
              <button
                key={dom}
                onClick={() => {
                  setActiveDomain(dom);
                  setSelectedWorkflow(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
                style={{
                  backgroundColor: isSelected ? conf.bg : 'transparent',
                  color: isSelected ? conf.color : '#94a3b8',
                  borderColor: isSelected ? conf.border : '#334155',
                  borderWidth: 1,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: conf.color }}
                />
                {conf.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search workflows, tables, nodes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-teal-500 w-64"
          />

          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => setZoom(z => Math.max(0.7, z - 0.1))}
              className="px-2 py-0.5 text-xs text-slate-400 hover:text-white rounded hover:bg-slate-800"
              title="Zoom out"
            >
              −
            </button>
            <span className="text-[11px] font-mono text-slate-400 px-1">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(1.4, z + 0.1))}
              className="px-2 py-0.5 text-xs text-slate-400 hover:text-white rounded hover:bg-slate-800"
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => setZoom(1)}
              className="px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-300 rounded hover:bg-slate-800"
              title="Reset Zoom"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Diagram Board */}
      <div className="relative rounded-2xl border border-slate-800 bg-slate-950/90 overflow-hidden shadow-2xl p-6 min-h-[620px]">
        {/* Ambient Grid Background */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#334155 1px, transparent 1px)`,
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          }}
        />

        {/* Estate Overview Grid */}
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          className="transition-transform duration-150"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {(['brief_a', 'content', 'brief_b', 'ops'] as const)
              .filter(dom => activeDomain === 'all' || activeDomain === dom)
              .map(dom => {
                const conf = DOMAIN_LABELS[dom];
                const wfs = filteredWorkflows.filter(w => w.domain === dom);
                if (wfs.length === 0) return null;

                return (
                  <div
                    key={dom}
                    className="rounded-xl border p-4 flex flex-col gap-4 backdrop-blur-sm"
                    style={{
                      borderColor: `${conf.border}44`,
                      backgroundColor: `${conf.bg}33`,
                    }}
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shadow-sm"
                          style={{ backgroundColor: conf.color }}
                        />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                          {conf.label}
                        </h3>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                        {wfs.length} workflows
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {wfs.map(wf => {
                        const openInc = openIncidentsByWf.get(wf.name) || [];
                        const isFailing = openInc.length > 0;
                        const isSelected = selectedWorkflow?.slug === wf.slug;

                        return (
                          <div
                            key={wf.slug}
                            onClick={() => setSelectedWorkflow(wf)}
                            className={`p-3.5 rounded-lg border transition-all cursor-pointer text-left relative group ${
                              isSelected
                                ? 'ring-2 ring-teal-400 bg-slate-900 border-teal-500/80'
                                : isFailing
                                ? 'bg-red-950/40 border-red-500/80 hover:border-red-400'
                                : 'bg-slate-900/90 border-slate-800 hover:border-slate-600 hover:bg-slate-900'
                            }`}
                          >
                            {/* Live Failure Ribbon */}
                            {isFailing && (
                              <div className="absolute top-2 right-2 flex items-center gap-1 bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                {openInc.length} incident{openInc.length > 1 ? 's' : ''}
                              </div>
                            )}

                            <div className="text-xs font-semibold text-slate-100 group-hover:text-teal-300 transition-colors">
                              {wf.name.replace('BEXT — ', '')}
                            </div>

                            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                              <span className="font-mono text-[10px] text-slate-500">
                                {wf.trigger.label}
                              </span>
                              <span>•</span>
                              <span>{wf.nodes.length} nodes</span>
                            </div>

                            {/* Database dependencies tags */}
                            {(wf.tablesRead.length > 0 || wf.tablesWritten.length > 0) && (
                              <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex flex-wrap gap-1">
                                {wf.tablesWritten.map(t => (
                                  <span
                                    key={`w-${t}`}
                                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 text-emerald-300"
                                    title={`Writes to ${t}`}
                                  >
                                    +{t}
                                  </span>
                                ))}
                                {wf.tablesRead.map(t => (
                                  <span
                                    key={`r-${t}`}
                                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/50 text-slate-400"
                                    title={`Reads from ${t}`}
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Selected Workflow Inspection Modal / Drawer */}
      {selectedWorkflow && (
        <div className="rounded-xl border border-teal-500/40 bg-slate-900 p-6 shadow-2xl space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: DOMAIN_LABELS[selectedWorkflow.domain].color }}
                />
                <h2 className="text-lg font-bold text-white tracking-tight">
                  {selectedWorkflow.name}
                </h2>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  {selectedWorkflow.slug}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Domain: <strong className="text-slate-300">{DOMAIN_LABELS[selectedWorkflow.domain].label}</strong> |
                Trigger: <span className="font-mono text-slate-300">{selectedWorkflow.trigger.label}</span>
              </p>
            </div>

            <button
              onClick={() => setSelectedWorkflow(null)}
              className="px-3 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            >
              ✕ Close detail
            </button>
          </div>

          {/* Node Execution Pipeline Map */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Execution Flow ({selectedWorkflow.nodes.length} Nodes in Walk Order)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {selectedWorkflow.nodes.map((node, i) => {
                const isAi = node.actor === 'ai';
                const isHuman = node.actor === 'you';

                return (
                  <div
                    key={node.id}
                    className="p-3 rounded-lg border bg-slate-950 border-slate-800 relative space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-500">
                        #{i + 1}
                      </span>
                      <span
                        className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border ${
                          isAi
                            ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700'
                            : isHuman
                            ? 'bg-rose-950/80 text-rose-300 border-rose-700'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {isAi ? '🤖 AI Model' : isHuman ? '👤 Human Review' : '⚙️ System'}
                      </span>
                    </div>

                    <div className="text-xs font-medium text-slate-200">
                      {node.name}
                    </div>

                    <div className="text-[10px] font-mono text-slate-500 truncate">
                      {node.type.replace('n8n-nodes-base.', '')}
                    </div>

                    {(node.reads.length > 0 || node.writes.length > 0) && (
                      <div className="text-[9px] font-mono text-slate-400 pt-1 border-t border-slate-800/80 flex flex-wrap gap-1">
                        {node.writes.map(t => (
                          <span key={t} className="text-emerald-400">write:{t}</span>
                        ))}
                        {node.reads.map(t => (
                          <span key={t} className="text-sky-400">read:{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Upstream / Downstream Data Connections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
              <h5 className="text-xs font-semibold text-slate-300 mb-2">
                Upstream Workflows (Feeds into this workflow)
              </h5>
              {(() => {
                const up = graph.edges.filter(e => e.to === selectedWorkflow.slug);
                if (up.length === 0) return <p className="text-xs text-slate-500">None (Root ingest or standalone trigger)</p>;
                return (
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {up.map((e, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="text-teal-400">←</span>
                        <strong className="text-slate-200">{e.from}</strong>
                        <span className="text-[10px] font-mono text-slate-500">via table: {e.table}</span>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>

            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
              <h5 className="text-xs font-semibold text-slate-300 mb-2">
                Downstream Workflows (Consumes output from this workflow)
              </h5>
              {(() => {
                const down = graph.edges.filter(e => e.from === selectedWorkflow.slug);
                if (down.length === 0) return <p className="text-xs text-slate-500">None (Terminal output workflow)</p>;
                return (
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {down.map((e, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="text-teal-400">→</span>
                        <strong className="text-slate-200">{e.to}</strong>
                        <span className="text-[10px] font-mono text-slate-500">via table: {e.table}</span>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
