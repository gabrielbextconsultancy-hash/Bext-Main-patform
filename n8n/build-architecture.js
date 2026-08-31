#!/usr/bin/env node
/**
 * Generates the architecture graph representation from exported n8n workflows.
 *
 * Reads n8n/workflows/*.json and emits dashboard/src/lib/architecture.generated.ts
 *
 * Sibling to n8n/build-workflows.js. Ensures that the architectural diagram
 * and table dependencies are derived directly from runnable workflow code
 * rather than maintaining hand-authored models that can drift.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT, 'n8n/workflows');
const OUT_FILE = path.join(ROOT, 'dashboard/src/lib/architecture.generated.ts');

const DOMAINS = {
  'BEXT Daily News — 1 Source Ingest': 'brief_a',
  'BEXT Daily News — 2 Newsletter Intake': 'brief_a',
  'BEXT Daily News — 3 Article Analysis': 'brief_a',
  'BEXT Daily News — 4 News Quality': 'brief_a',
  'BEXT Daily News — 5 Daily Report': 'brief_a',
  'BEXT Daily News — 6 Teams Card': 'brief_a',
  'BEXT — Content Topics': 'content',
  'BEXT — Content Drafts': 'content',
  'BEXT — LinkedIn Publish': 'content',
  'BEXT — Content Actions': 'content',
  'BEXT — Teams Inbound': 'brief_b',
  'BEXT — Meeting Intake': 'brief_b',
  'BEXT — Self Heal': 'ops',
  'BEXT — Graph Health': 'ops',
  'BEXT — Contract Test': 'ops',
};

const KNOWN_TABLES = new Set([
  'articles',
  'article_analysis',
  'reports',
  'report_items',
  'sources',
  'newsletter_messages',
  'content_topics',
  'content_drafts',
  'content_actions',
  'meeting_minutes',
  'integration_health',
  'incidents',
  'milestones',
  'deliverables',
]);

function extractTablesFromSql(sql) {
  if (!sql || typeof sql !== 'string') return { reads: [], writes: [] };
  const clean = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const reads = new Set();
  const writes = new Set();

  // Extract writes
  const insertMatches = [...clean.matchAll(/\bINSERT\s+INTO\s+([a-zA-Z0-9_]+)/gi)];
  for (const m of insertMatches) {
    const tbl = m[1].toLowerCase();
    if (KNOWN_TABLES.has(tbl)) writes.add(tbl);
  }
  const updateMatches = [...clean.matchAll(/\bUPDATE\s+([a-zA-Z0-9_]+)/gi)];
  for (const m of updateMatches) {
    const tbl = m[1].toLowerCase();
    if (KNOWN_TABLES.has(tbl)) writes.add(tbl);
  }
  const deleteMatches = [...clean.matchAll(/\bDELETE\s+FROM\s+([a-zA-Z0-9_]+)/gi)];
  for (const m of deleteMatches) {
    const tbl = m[1].toLowerCase();
    if (KNOWN_TABLES.has(tbl)) writes.add(tbl);
  }

  // Extract reads
  const fromMatches = [...clean.matchAll(/\bFROM\s+([a-zA-Z0-9_]+)/gi)];
  for (const m of fromMatches) {
    const tbl = m[1].toLowerCase();
    if (KNOWN_TABLES.has(tbl)) reads.add(tbl);
  }
  const joinMatches = [...clean.matchAll(/\bJOIN\s+([a-zA-Z0-9_]+)/gi)];
  for (const m of joinMatches) {
    const tbl = m[1].toLowerCase();
    if (KNOWN_TABLES.has(tbl)) reads.add(tbl);
  }

  return {
    reads: Array.from(reads).sort(),
    writes: Array.from(writes).sort(),
  };
}

function determineActor(node) {
  const name = (node.name || '').toLowerCase();
  const type = (node.type || '').toLowerCase();
  const code = (node.parameters && node.parameters.jsCode) || '';

  if (
    /gemini|claude|hermes|ollama|ai|llm|generate|extract|score|summar|brief/i.test(name) ||
    /hermes3|gemini-|anthropic|openai|ollama:11434/i.test(code)
  ) {
    return 'ai';
  }
  if (/approval|human|review|gate|wait for user/i.test(name)) {
    return 'you';
  }
  return 'system';
}

function extractTrigger(nodes) {
  const triggerNode = nodes.find(n =>
    /trigger|webhook|imap|schedule/i.test(n.type) ||
    n.type === 'n8n-nodes-base.scheduleTrigger' ||
    n.type === 'n8n-nodes-base.webhook' ||
    n.type === 'n8n-nodes-base.emailReadImap'
  );

  if (!triggerNode) return { type: 'manual', label: 'Manual' };

  if (triggerNode.type === 'n8n-nodes-base.scheduleTrigger') {
    const rule = triggerNode.parameters?.rule || {};
    const interval = rule.interval?.[0];
    if (interval?.field === 'cronExpression') {
      return { type: 'schedule', label: `Schedule (${interval.expression})` };
    }
    if (interval?.field === 'hours') {
      return { type: 'schedule', label: `Hourly (${interval.hoursInterval}h)` };
    }
    if (interval?.field === 'minutes') {
      return { type: 'schedule', label: `Interval (${interval.minutesInterval}m)` };
    }
    return { type: 'schedule', label: 'Scheduled' };
  }

  if (triggerNode.type === 'n8n-nodes-base.webhook') {
    const path = triggerNode.parameters?.path || 'webhook';
    return { type: 'webhook', label: `Webhook (/webhook/${path})` };
  }

  if (triggerNode.type === 'n8n-nodes-base.emailReadImap') {
    return { type: 'imap', label: 'IMAP (Email Intake)' };
  }

  return { type: 'event', label: triggerNode.name || 'Event Trigger' };
}

function walkExecutionOrder(nodes, connections) {
  const nodeMap = new Map(nodes.map(n => [n.name, n]));
  const triggerNode = nodes.find(n =>
    /trigger|webhook|imap|schedule/i.test(n.type) ||
    n.type === 'n8n-nodes-base.scheduleTrigger' ||
    n.type === 'n8n-nodes-base.webhook' ||
    n.type === 'n8n-nodes-base.emailReadImap'
  );

  const startName = triggerNode ? triggerNode.name : (nodes[0]?.name);
  if (!startName) return [];

  const visited = new Set();
  const order = [];
  const queue = [startName];

  while (queue.length > 0) {
    const curr = queue.shift();
    if (visited.has(curr)) continue;
    visited.add(curr);

    const nodeObj = nodeMap.get(curr);
    if (nodeObj) {
      order.push(nodeObj);
    }

    const nextConn = connections[curr]?.main || [];
    for (const group of nextConn) {
      for (const dest of group) {
        if (dest && dest.node && !visited.has(dest.node)) {
          queue.push(dest.node);
        }
      }
    }
  }

  // Add any unvisited nodes (e.g. disconnected or error branches)
  for (const n of nodes) {
    if (!visited.has(n.name)) {
      order.push(n);
    }
  }

  return order;
}

function buildArchitectureGraph() {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json')).sort();
  const workflows = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
    const wf = JSON.parse(content);
    const slug = file.replace(/\.json$/, '');
    const name = wf.name || slug;
    const domain = DOMAINS[name] || 'ops';
    const rawNodes = wf.nodes || [];
    const connections = wf.connections || {};

    const orderedNodes = walkExecutionOrder(rawNodes, connections);
    const trigger = extractTrigger(rawNodes);

    const allReads = new Set();
    const allWrites = new Set();

    const parsedNodes = orderedNodes.map((n, idx) => {
      const actor = determineActor(n);
      let sqlReads = [];
      let sqlWrites = [];

      if (n.type === 'n8n-nodes-base.postgres') {
        const query = n.parameters?.query || '';
        const { reads, writes } = extractTablesFromSql(query);
        sqlReads = reads;
        sqlWrites = writes;
        reads.forEach(t => allReads.add(t));
        writes.forEach(t => allWrites.add(t));
      }

      return {
        id: n.id || `node-${idx}`,
        name: n.name,
        type: n.type,
        actor,
        reads: sqlReads,
        writes: sqlWrites,
        alwaysOutputData: Boolean(n.alwaysOutputData),
      };
    });

    workflows.push({
      slug,
      name,
      domain,
      trigger,
      tablesRead: Array.from(allReads).sort(),
      tablesWritten: Array.from(allWrites).sort(),
      nodes: parsedNodes,
    });
  }

  // Derive edges between workflows: A -> B where A writes table X and B reads table X
  const edges = [];
  for (const source of workflows) {
    for (const target of workflows) {
      if (source.slug === target.slug) continue;
      const sharedTables = source.tablesWritten.filter(t => target.tablesRead.includes(t));
      for (const table of sharedTables) {
        edges.push({
          from: source.slug,
          to: target.slug,
          table,
          domain: source.domain === target.domain ? source.domain : 'cross_domain',
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    workflowCount: workflows.length,
    edgeCount: edges.length,
    workflows,
    edges,
  };
}

function generateTypeScript(graph) {
  return `/**
 * AUTO-GENERATED by n8n/build-architecture.js
 * DO NOT EDIT DIRECTLY. Run \`node n8n/build-architecture.js\` to regenerate.
 * Preflight check R033 verifies this file matches the exported workflows.
 */

export type ArchitectureDomain = 'brief_a' | 'brief_b' | 'content' | 'ops' | 'cross_domain';
export type ActorType = 'ai' | 'you' | 'system';

export interface ArchitectureNode {
  id: string;
  name: string;
  type: string;
  actor: ActorType;
  reads: string[];
  writes: string[];
  alwaysOutputData?: boolean;
}

export interface ArchitectureWorkflow {
  slug: string;
  name: string;
  domain: ArchitectureDomain;
  trigger: {
    type: string;
    label: string;
  };
  tablesRead: string[];
  tablesWritten: string[];
  nodes: ArchitectureNode[];
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  table: string;
  domain: ArchitectureDomain;
}

export interface ArchitectureGraph {
  generatedAt: string;
  workflowCount: number;
  edgeCount: number;
  workflows: ArchitectureWorkflow[];
  edges: ArchitectureEdge[];
}

export const ARCHITECTURE_GRAPH: ArchitectureGraph = ${JSON.stringify(graph, null, 2)};
`;
}

function main() {
  const graph = buildArchitectureGraph();
  const tsContent = generateTypeScript(graph);
  fs.writeFileSync(OUT_FILE, tsContent, 'utf8');
  console.log(`Generated ${OUT_FILE}`);
  console.log(`  Workflows: ${graph.workflowCount}`);
  console.log(`  Edges: ${graph.edgeCount}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildArchitectureGraph,
  generateTypeScript,
};
