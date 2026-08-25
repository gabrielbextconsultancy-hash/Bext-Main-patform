import { ARCHITECTURE_GRAPH } from '@/lib/architecture.generated';
import { getHealth, getRecentIncidents } from '@/lib/queries';
import { ConceptMap } from '@/components/ConceptMap';
import { ArchitectureFlowchart } from '@/components/ArchitectureFlowchart';
import { ExcalidrawScene } from '@/components/ExcalidrawScene';
import { Card } from '@/components/ui';

export const metadata = {
  title: 'Business Architecture & Concept Maps — BEXT Automation',
  description: 'Concept maps, process flowcharts, business systems integration matrix, and 14 n8n workflows for BEXT Consultancy.',
};

export const dynamic = 'force-dynamic';

const PLATFORMS = [
  {
    name: 'HubSpot',
    color: 'text-teal-300',
    role: 'CRM, deals, company & contact lifecycle records',
    sourceOfTruth: 'Contacts, sales pipeline, client entities',
    integration: 'Private App Token · REST API v3',
    status: 'Connected (Portal 443333225)',
    statusTone: 'ok',
  },
  {
    name: 'ProjectManager',
    color: 'text-teal-300',
    role: 'Project delivery, task allocation, deliverable milestones',
    sourceOfTruth: 'Project tasks, hours, progress tracking',
    integration: 'API Key · REST API',
    status: 'Connected',
    statusTone: 'ok',
  },
  {
    name: 'SharePoint (M365)',
    color: 'text-teal-300',
    role: 'Central document storage, client records, meeting archives',
    sourceOfTruth: 'Meeting transcripts, .docx minutes, client deliverables',
    integration: 'Graph API App-Only (Sites.ReadWrite.All)',
    status: 'Connected (BEXTHQ)',
    statusTone: 'ok',
  },
  {
    name: 'Microsoft Teams',
    color: 'text-purple-300',
    role: 'Meeting audio/video, live transcripts, channel announcement cards',
    sourceOfTruth: 'Online meetings & generated transcript feeds',
    integration: 'Graph App-Only + Power Automate Webhook',
    status: 'Connected',
    statusTone: 'ok',
  },
  {
    name: 'n8n (Self-Hosted)',
    color: 'text-sky-300',
    role: 'Central integration layer, scheduled workflows, self-healing rules',
    sourceOfTruth: 'Workflow logic, cron schedules, heal state',
    integration: 'Docker Container on Hostinger VPS (Project bext)',
    status: 'v2.32.6 Live',
    statusTone: 'ok',
  },
  {
    name: 'PostgreSQL 16',
    color: 'text-sky-300',
    role: 'Relational data store for articles, scored news, minutes, incidents',
    sourceOfTruth: 'Article rankings, minutes metadata, system incidents',
    integration: 'Internal Docker loopback network (:5432)',
    status: '25 Migrations Applied',
    statusTone: 'ok',
  },
  {
    name: 'Xero',
    color: 'text-slate-400',
    role: 'Invoicing, expenses, client billing and reconciliation',
    sourceOfTruth: 'Invoices, payments, financial accounts',
    integration: 'OAuth 2.0 (Client setup pending)',
    status: 'Pending Client Credentials',
    statusTone: 'warn',
  },
];

export default async function ArchitecturePage() {
  const [health, incidents] = await Promise.all([
    getHealth(),
    getRecentIncidents(),
  ]);

  const openIncidents = (incidents || []).filter(
    i => !i.resolved_at && (i.outcome === 'attempted' || i.outcome === 'failed' || i.outcome === 'detected')
  );

  return (
    <div className="space-y-8">
      {/* 1. Header Overview Card */}
      <Card
        title="Business Architecture & Systems Integration"
        subtitle="End-to-end operational blueprint for BEXT Consultancy: platforms, data flows, AI invocation, and automated workflows."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-2">
          <div>
            <p className="text-3xl font-bold text-teal-400 font-mono">
              {ARCHITECTURE_GRAPH.workflowCount}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Automated Workflows</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-sky-400 font-mono">
              {ARCHITECTURE_GRAPH.edgeCount}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Table Data Interconnects</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-purple-400 font-mono">4</p>
            <p className="text-xs text-slate-400 mt-0.5">Core Domains</p>
          </div>
          <div>
            <p
              className={`text-3xl font-bold font-mono ${
                openIncidents.length === 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {openIncidents.length === 0 ? '0' : openIncidents.length}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {openIncidents.length === 0 ? 'Active Incidents (Healthy)' : 'Open Incidents'}
            </p>
          </div>
        </div>

        {/* Graphify Interactive Visualizer Shortcuts */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center gap-3">
          <a
            href="/graph.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-teal-500/20 text-teal-300 border border-teal-500/40 hover:bg-teal-500/30 transition-all shadow-sm"
          >
            <span>🌐</span>
            <span>Open Graphify 2D/3D Knowledge Graph</span>
            <span className="font-mono text-[10px] text-teal-400">↗</span>
          </a>

          <a
            href="/tree.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/40 hover:bg-sky-500/30 transition-all shadow-sm"
          >
            <span>🌳</span>
            <span>Open D3 Collapsible Code Tree</span>
            <span className="font-mono text-[10px] text-sky-400">↗</span>
          </a>

          <span className="text-xs text-slate-400 ml-auto font-mono text-[11px]">
            Generated with Graphify (2,527 nodes · 4,499 edges)
          </span>
        </div>
      </Card>

      {/* 2. Clustered Concept Maps (Overall, Daily Report, Meeting Intake, LinkedIn, Ops) */}
      <ConceptMap />

      {/* 3. Structured Process Flowchart */}
      <ArchitectureFlowchart />

      {/* 4. Business Systems Integration Matrix */}
      <Card
        title="Business Systems Integration Architecture"
        subtitle="Platform responsibilities, source-of-truth ownership, and automated data exchange."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left uppercase tracking-wider text-slate-400 text-[10px]">
                <th className="pb-2 font-semibold">Platform</th>
                <th className="pb-2 font-semibold">Role</th>
                <th className="pb-2 font-semibold">Source of Truth For</th>
                <th className="pb-2 font-semibold">Integration Path</th>
                <th className="pb-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {PLATFORMS.map((p, idx) => (
                <tr key={idx} className="hover:bg-slate-900/50 transition-colors">
                  <td className={`py-3 pr-4 font-semibold ${p.color}`}>
                    {p.name}
                  </td>
                  <td className="py-3 pr-4 text-slate-300">
                    {p.role}
                  </td>
                  <td className="py-3 pr-4 text-slate-300">
                    {p.sourceOfTruth}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[11px] text-slate-400">
                    {p.integration}
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                        p.statusTone === 'ok'
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                          : 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 5. Interactive 14-Workflow N8N Estate Diagram */}
      <Card
        title="Automated Workflow Operating Estate (14 n8n Workflows)"
        subtitle="Interactive visual map of all automated pipelines, node execution sequences, AI model calls, and PostgreSQL table dependencies."
      >
        <ExcalidrawScene
          graph={ARCHITECTURE_GRAPH}
          health={health}
          incidents={incidents}
        />
      </Card>
    </div>
  );
}
