#!/usr/bin/env node
/**
 * Generates comprehensive Excalidraw diagram files for:
 *   1. Overall Business Architecture & Multi-Tier Flowchart
 *   2. Daily Report Pipeline (Brief A)
 *   3. Meeting Intake & Filing Pipeline (Brief B)
 *   4. LinkedIn Content Generation Pipeline (Engagement C)
 *   5. Self-Healing & Observability Loop (Rings 0-3)
 *   6. 14 Per-Workflow Node-Level Execution Flowcharts
 */
const fs = require('fs');
const path = require('path');
const { ARCHITECTURE_GRAPH } = require('../dashboard/src/lib/architecture.generated.ts');

const ROOT = path.join(__dirname, '..');
const DIAGRAMS_DIR = path.join(ROOT, 'docs/diagrams');

if (!fs.existsSync(DIAGRAMS_DIR)) {
  fs.mkdirSync(DIAGRAMS_DIR, { recursive: true });
}

const PALETTE = {
  brief_a: { stroke: '#14b8a6', bg: '#042f2e', fill: '#14b8a622' },
  brief_b: { stroke: '#a78bfa', bg: '#2e1065', fill: '#a78bfa22' },
  content: { stroke: '#f59e0b', bg: '#451a03', fill: '#f59e0b22' },
  ops:     { stroke: '#38bdf8', bg: '#082f49', fill: '#38bdf822' },
  storage: { stroke: '#0d9488', bg: '#134e4a', fill: '#0d948822' },
  ai:      { stroke: '#f43f5e', bg: '#4c0519', fill: '#f43f5e22' },
  you:     { stroke: '#fb7185', bg: '#4c0519', fill: '#fb718522' },
  system:  { stroke: '#94a3b8', bg: '#0f172a', fill: '#1e293b' },
};

function createRect({ id, x, y, width, height, strokeColor, backgroundColor, label, sublabel, roundness = 3, opacity = 100 }) {
  const elements = [
    {
      id: `${id}-box`,
      type: 'rectangle',
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor,
      backgroundColor,
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      opacity,
      groupIds: [id],
      roundness: { type: roundness },
      seed: 1001,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: [{ type: 'text', id: `${id}-text` }],
    },
    {
      id: `${id}-text`,
      type: 'text',
      x: x + 8,
      y: y + (sublabel ? 10 : height / 2 - 10),
      width: width - 16,
      height: sublabel ? 24 : 20,
      angle: 0,
      strokeColor: '#f8fafc',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [id],
      roundness: null,
      seed: 1002,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      text: label,
      fontSize: 14,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: `${id}-box`,
    },
  ];

  if (sublabel) {
    elements.push({
      id: `${id}-subtext`,
      type: 'text',
      x: x + 8,
      y: y + height - 26,
      width: width - 16,
      height: 18,
      angle: 0,
      strokeColor: strokeColor === '#94a3b8' ? '#cbd5e1' : strokeColor,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [id],
      roundness: null,
      seed: 1003,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      text: sublabel,
      fontSize: 11,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
    });
  }

  return elements;
}

function createArrow({ id, fromX, fromY, toX, toY, label, strokeColor = '#94a3b8' }) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const elements = [
    {
      id: `${id}-arrow`,
      type: 'arrow',
      x: fromX,
      y: fromY,
      width: Math.abs(dx),
      height: Math.abs(dy),
      angle: 0,
      strokeColor,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      roundness: { type: 2 },
      seed: 2001,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      points: [[0, 0], [dx, dy]],
      endArrowhead: 'arrow',
    },
  ];

  if (label) {
    elements.push({
      id: `${id}-label`,
      type: 'text',
      x: fromX + dx / 2 - 50,
      y: fromY + dy / 2 - 12,
      width: 100,
      height: 20,
      angle: 0,
      strokeColor: '#38bdf8',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      roundness: null,
      seed: 2002,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      text: label,
      fontSize: 11,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
    });
  }

  return elements;
}

function wrapDiagram(elements, title = 'BEXT Diagram') {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: {
      viewBackgroundColor: '#020617',
      gridSize: 20,
    },
    files: {},
  };
}

// 1. Overall Business Architecture Flowchart
function generateOverallBusinessArchitecture() {
  const elements = [];

  elements.push({
    id: 'header-title',
    type: 'text',
    x: 40,
    y: 30,
    width: 800,
    height: 36,
    strokeColor: '#f8fafc',
    backgroundColor: 'transparent',
    text: 'BEXT Consultancy — End-to-End Business Systems Architecture',
    fontSize: 24,
    fontFamily: 1,
  });

  const columns = [
    { name: '1. Ingestion & Feeds', x: 40, color: '#38bdf8' },
    { name: '2. Orchestration (n8n)', x: 340, color: '#818cf8' },
    { name: '3. AI Transformation', x: 640, color: '#f59e0b' },
    { name: '4. Systems of Record', x: 940, color: '#14b8a6' },
    { name: '5. Client Outputs', x: 1240, color: '#34d399' },
  ];

  for (const col of columns) {
    elements.push({
      id: `col-hdr-${col.name}`,
      type: 'text',
      x: col.x,
      y: 90,
      width: 240,
      height: 24,
      strokeColor: col.color,
      backgroundColor: 'transparent',
      text: col.name,
      fontSize: 16,
      fontFamily: 1,
    });
  }

  const nodes = [
    // Column 1
    { col: 0, y: 130, label: '68 Industry News Feeds', sub: 'RSS / Scrape Indexes' },
    { col: 0, y: 240, label: 'Teams Video Calls', sub: 'Audio & Auto-Transcript' },
    { col: 0, y: 350, label: 'Inbound Newsletters', sub: 'Direct Mail / IMAP' },

    // Column 2
    { col: 1, y: 130, label: 'Source Ingest WF', sub: 'n8n Hourly' },
    { col: 1, y: 240, label: 'Meeting Intake WF', sub: 'n8n 15-Min Cadence' },
    { col: 1, y: 350, label: 'Article Analysis WF', sub: 'n8n 30-Min Scorer' },

    // Column 3
    { col: 2, y: 130, label: 'Ollama Hermes 3 8B', sub: 'Relevance Grading & Intro' },
    { col: 2, y: 240, label: 'Gemini 3.6 Flash', sub: 'Minutes & Actions Extractor' },
    { col: 2, y: 350, label: 'Document Generator', sub: 'Headless .docx Renderer' },

    // Column 4
    { col: 3, y: 130, label: 'PostgreSQL 16', sub: 'Articles & Minutes DB' },
    { col: 3, y: 240, label: 'SharePoint BEXTHQ', sub: 'M365 Cloud Library' },
    { col: 3, y: 350, label: 'HubSpot & PM', sub: 'CRM & Project Delivery' },

    // Column 5
    { col: 4, y: 130, label: 'Daily 05:00 AEST Email', sub: 'Executive Digest' },
    { col: 4, y: 240, label: 'Teams Channel Card', sub: 'Adaptive Card 1.4' },
    { col: 4, y: 350, label: 'LinkedIn Post Drafts', sub: 'Human-in-the-Loop Review' },
  ];

  nodes.forEach((n, i) => {
    const colDef = columns[n.col];
    const box = createRect({
      id: `node-box-${i}`,
      x: colDef.x,
      y: n.y,
      width: 240,
      height: 70,
      strokeColor: colDef.color,
      backgroundColor: '#0f172a',
      label: n.label,
      sublabel: n.sub,
    });
    elements.push(...box);
  });

  // Inter-column arrows
  const arrowConnections = [
    { from: [280, 165], to: [340, 165], label: 'hourly' },
    { from: [280, 275], to: [340, 275], label: 'vtt' },
    { from: [580, 165], to: [640, 165], label: 'eval' },
    { from: [580, 275], to: [640, 275], label: 'ai prompt' },
    { from: [880, 165], to: [940, 165], label: 'write articles' },
    { from: [880, 275], to: [940, 275], label: 'write .docx' },
    { from: [1180, 165], to: [1240, 165], label: 'sendMail' },
    { from: [1180, 275], to: [1240, 275], label: 'webhook' },
  ];

  arrowConnections.forEach((a, i) => {
    elements.push(...createArrow({
      id: `arrow-main-${i}`,
      fromX: a.from[0],
      fromY: a.from[1],
      toX: a.to[0],
      toY: a.to[1],
      label: a.label,
      strokeColor: '#64748b',
    }));
  });

  return wrapDiagram(elements, 'BEXT Overall Business Architecture');
}

// 2. Daily Report Pipeline Flowchart
function generateDailyReportPipeline() {
  const elements = [];
  elements.push({
    id: 'dr-title',
    type: 'text',
    x: 40,
    y: 30,
    width: 800,
    height: 36,
    strokeColor: '#14b8a6',
    backgroundColor: 'transparent',
    text: 'Brief A: Industry Daily Report & Ingest Pipeline',
    fontSize: 24,
    fontFamily: 1,
  });

  const steps = [
    { x: 40, y: 120, label: '68 Monitored Sources', sub: 'Hourly Schedule Trigger', stroke: '#38bdf8' },
    { x: 280, y: 120, label: 'Fetch & Parser Ladder', sub: 'Direct ➔ Browser ➔ Hermes', stroke: '#818cf8' },
    { x: 520, y: 120, label: 'DB: articles Table', sub: 'Upsert with content_hash', stroke: '#14b8a6' },
    { x: 760, y: 120, label: 'Article Analysis WF', sub: 'Scored 1-10 via Hermes', stroke: '#f59e0b' },
    { x: 1000, y: 120, label: 'DB: article_analysis', sub: 'Relevance & Summaries', stroke: '#14b8a6' },
    { x: 1000, y: 260, label: 'Daily Report (05:00)', sub: 'Partition Top Articles', stroke: '#818cf8' },
    { x: 760, y: 260, label: 'Hermes Editorial Intro', sub: '2-3 Executive Sentences', stroke: '#f59e0b' },
    { x: 520, y: 260, label: 'Deliverability Node', sub: 'DoH SPF / DMARC / DKIM', stroke: '#38bdf8' },
    { x: 280, y: 260, label: 'Microsoft Graph Mail', sub: 'Send via M365 Mailbox', stroke: '#34d399' },
    { x: 40, y: 260, label: 'Daily News Card (05:20)', sub: 'Post to Teams Channel', stroke: '#34d399' },
  ];

  steps.forEach((s, i) => {
    elements.push(...createRect({
      id: `dr-step-${i}`,
      x: s.x,
      y: s.y,
      width: 200,
      height: 75,
      strokeColor: s.stroke,
      backgroundColor: '#0f172a',
      label: s.label,
      sublabel: s.sub,
    }));
  });

  // Arrows linking steps
  const links = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]
  ];

  links.forEach(([fromIdx, toIdx], i) => {
    const f = steps[fromIdx];
    const t = steps[toIdx];
    let fromX = f.x + 200;
    let fromY = f.y + 37.5;
    let toX = t.x;
    let toY = t.y + 37.5;

    if (f.y < t.y) {
      fromX = f.x + 100;
      fromY = f.y + 75;
      toX = t.x + 100;
      toY = t.y;
    } else if (f.y === t.y && f.x > t.x) {
      fromX = f.x;
      toX = t.x + 200;
    }

    elements.push(...createArrow({
      id: `dr-arr-${i}`,
      fromX,
      fromY,
      toX,
      toY,
      strokeColor: '#64748b',
    }));
  });

  return wrapDiagram(elements, 'Daily Report Pipeline Flowchart');
}

// 3. Meeting Intake Pipeline Flowchart
function generateMeetingIntakePipeline() {
  const elements = [];
  elements.push({
    id: 'mi-title',
    type: 'text',
    x: 40,
    y: 30,
    width: 800,
    height: 36,
    strokeColor: '#a78bfa',
    backgroundColor: 'transparent',
    text: 'Brief B: Unattended Meeting Intake & Minutes Pipeline',
    fontSize: 24,
    fontFamily: 1,
  });

  const steps = [
    { x: 40, y: 120, label: 'Teams Meeting Ends', sub: '15-min poll / Inbound hook', stroke: '#38bdf8' },
    { x: 280, y: 120, label: 'Graph API Transcripts', sub: 'getAllTranscripts per Host', stroke: '#818cf8' },
    { x: 520, y: 120, label: 'Gemini 3.6 Flash', sub: 'Extract Actions & Summary', stroke: '#f59e0b' },
    { x: 760, y: 120, label: 'Render Minutes .docx', sub: 'Fetcher /render-docx tunnel', stroke: '#f59e0b' },
    { x: 1000, y: 120, label: 'SharePoint Upload', sub: 'Channel & BEXTHQ Archive', stroke: '#14b8a6' },
    { x: 1000, y: 260, label: 'DB: meeting_minutes', sub: 'Upsert on transcript_id', stroke: '#14b8a6' },
    { x: 760, y: 260, label: 'Draft Outlook Mail', sub: 'POST /users/{id}/messages', stroke: '#38bdf8' },
    { x: 520, y: 260, label: 'Adaptive Card 1.4', sub: 'Build via meeting-card.js', stroke: '#818cf8' },
    { x: 280, y: 260, label: 'Power Automate Flow', sub: 'Post to Teams Channel', stroke: '#34d399' },
    { x: 40, y: 260, label: 'Graph Health (06:00)', sub: 'Reconcile Transcripts vs DB', stroke: '#38bdf8' },
  ];

  steps.forEach((s, i) => {
    elements.push(...createRect({
      id: `mi-step-${i}`,
      x: s.x,
      y: s.y,
      width: 200,
      height: 75,
      strokeColor: s.stroke,
      backgroundColor: '#0f172a',
      label: s.label,
      sublabel: s.sub,
    }));
  });

  const links = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]
  ];

  links.forEach(([fromIdx, toIdx], i) => {
    const f = steps[fromIdx];
    const t = steps[toIdx];
    let fromX = f.x + 200;
    let fromY = f.y + 37.5;
    let toX = t.x;
    let toY = t.y + 37.5;

    if (f.y < t.y) {
      fromX = f.x + 100;
      fromY = f.y + 75;
      toX = t.x + 100;
      toY = t.y;
    } else if (f.y === t.y && f.x > t.x) {
      fromX = f.x;
      toX = t.x + 200;
    }

    elements.push(...createArrow({
      id: `mi-arr-${i}`,
      fromX,
      fromY,
      toX,
      toY,
      strokeColor: '#64748b',
    }));
  });

  return wrapDiagram(elements, 'Meeting Intake Pipeline Flowchart');
}

// 4. LinkedIn Content Generation Pipeline Flowchart
function generateLinkedInPipeline() {
  const elements = [];
  elements.push({
    id: 'li-title',
    type: 'text',
    x: 40,
    y: 30,
    width: 800,
    height: 36,
    strokeColor: '#f59e0b',
    backgroundColor: 'transparent',
    text: 'Engagement C: Fortnightly LinkedIn Thought Leadership Engine',
    fontSize: 24,
    fontFamily: 1,
  });

  const steps = [
    { x: 40, y: 120, label: 'Fortnightly Scan', sub: 'Top News & Regulatory Items', stroke: '#38bdf8' },
    { x: 280, y: 120, label: 'Content Topics WF', sub: 'Rank 3 Candidate Angles', stroke: '#818cf8' },
    { x: 520, y: 120, label: 'DB: content_topics', sub: 'Persist Proposed Topics', stroke: '#14b8a6' },
    { x: 760, y: 120, label: 'Content Drafts WF', sub: 'Generate 2 Tone Variants', stroke: '#f59e0b' },
    { x: 1000, y: 120, label: 'DB: content_drafts', sub: 'Persist Generated Drafts', stroke: '#14b8a6' },
    { x: 1000, y: 260, label: 'Human Review Gate', sub: 'Founder Tone & Edits Approval', stroke: '#fb7185' },
    { x: 760, y: 260, label: 'LinkedIn Publish WF', sub: 'Staged Publishing Engine', stroke: '#818cf8' },
    { x: 520, y: 260, label: 'LinkedIn API', sub: 'Live Feed Publication', stroke: '#34d399' },
    { x: 280, y: 260, label: 'Content Actions WF', sub: 'Engagement & Metrics Sync', stroke: '#818cf8' },
    { x: 40, y: 260, label: 'DB: content_actions', sub: 'Audit Log & Analytics', stroke: '#14b8a6' },
  ];

  steps.forEach((s, i) => {
    elements.push(...createRect({
      id: `li-step-${i}`,
      x: s.x,
      y: s.y,
      width: 200,
      height: 75,
      strokeColor: s.stroke,
      backgroundColor: '#0f172a',
      label: s.label,
      sublabel: s.sub,
    }));
  });

  const links = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]
  ];

  links.forEach(([fromIdx, toIdx], i) => {
    const f = steps[fromIdx];
    const t = steps[toIdx];
    let fromX = f.x + 200;
    let fromY = f.y + 37.5;
    let toX = t.x;
    let toY = t.y + 37.5;

    if (f.y < t.y) {
      fromX = f.x + 100;
      fromY = f.y + 75;
      toX = t.x + 100;
      toY = t.y;
    } else if (f.y === t.y && f.x > t.x) {
      fromX = f.x;
      toX = t.x + 200;
    }

    elements.push(...createArrow({
      id: `li-arr-${i}`,
      fromX,
      fromY,
      toX,
      toY,
      strokeColor: '#64748b',
    }));
  });

  return wrapDiagram(elements, 'LinkedIn Content Pipeline Flowchart');
}

// 5. Per-Workflow Detailed Flowcharts
function generateWorkflowDiagram(wf) {
  const elements = [];
  const pal = PALETTE[wf.domain] || PALETTE.ops;

  elements.push({
    id: `wf-${wf.slug}-title`,
    type: 'text',
    x: 40,
    y: 30,
    width: 600,
    height: 32,
    strokeColor: pal.stroke,
    backgroundColor: 'transparent',
    text: wf.name,
    fontSize: 22,
    fontFamily: 1,
  });

  elements.push({
    id: `wf-${wf.slug}-trigger`,
    type: 'text',
    x: 40,
    y: 68,
    width: 900,
    height: 20,
    strokeColor: '#94a3b8',
    backgroundColor: 'transparent',
    text: `Trigger: ${wf.trigger.label} | Domain: ${wf.domain.toUpperCase()} | Tables Read: [${wf.tablesRead.join(', ')}] | Tables Written: [${wf.tablesWritten.join(', ')}]`,
    fontSize: 13,
    fontFamily: 1,
  });

  let currX = 40;
  let currY = 120;
  const nodeW = 200;
  const nodeH = 75;
  const gap = 50;

  for (let i = 0; i < wf.nodes.length; i++) {
    const node = wf.nodes[i];
    const actorPal = PALETTE[node.actor] || PALETTE.system;
    const actorLabel = node.actor === 'ai' ? '🤖 AI Model' : (node.actor === 'you' ? '👤 Human Review' : '⚙️ System Node');

    elements.push(...createRect({
      id: `node-${wf.slug}-${i}`,
      x: currX,
      y: currY,
      width: nodeW,
      height: nodeH,
      strokeColor: actorPal.stroke,
      backgroundColor: '#0f172a',
      label: node.name,
      sublabel: actorLabel,
    }));

    if (i < wf.nodes.length - 1) {
      const nextX = currX + nodeW + gap;
      if (nextX + nodeW > 1400) {
        elements.push(...createArrow({
          id: `arrow-${wf.slug}-${i}`,
          fromX: currX + nodeW / 2,
          fromY: currY + nodeH,
          toX: 40 + nodeW / 2,
          toY: currY + nodeH + 50,
          strokeColor: '#64748b',
        }));
        currX = 40;
        currY += nodeH + 50;
      } else {
        elements.push(...createArrow({
          id: `arrow-${wf.slug}-${i}`,
          fromX: currX + nodeW,
          fromY: currY + nodeH / 2,
          toX: nextX,
          toY: currY + nodeH / 2,
          strokeColor: '#64748b',
        }));
        currX = nextX;
      }
    }
  }

  return wrapDiagram(elements, wf.name);
}

function main() {
  const overall = generateOverallBusinessArchitecture();
  fs.writeFileSync(path.join(DIAGRAMS_DIR, 'overall-business-architecture.excalidraw'), JSON.stringify(overall, null, 2), 'utf8');

  const dailyReport = generateDailyReportPipeline();
  fs.writeFileSync(path.join(DIAGRAMS_DIR, 'daily-report-pipeline.excalidraw'), JSON.stringify(dailyReport, null, 2), 'utf8');

  const meetingIntake = generateMeetingIntakePipeline();
  fs.writeFileSync(path.join(DIAGRAMS_DIR, 'meeting-intake-pipeline.excalidraw'), JSON.stringify(meetingIntake, null, 2), 'utf8');

  const linkedIn = generateLinkedInPipeline();
  fs.writeFileSync(path.join(DIAGRAMS_DIR, 'linkedin-content-pipeline.excalidraw'), JSON.stringify(linkedIn, null, 2), 'utf8');

  for (const wf of ARCHITECTURE_GRAPH.workflows) {
    const wfDiagram = generateWorkflowDiagram(wf);
    fs.writeFileSync(path.join(DIAGRAMS_DIR, `${wf.slug}.excalidraw`), JSON.stringify(wfDiagram, null, 2), 'utf8');
  }

  console.log(`Generated all 18 Excalidraw diagrams in docs/diagrams/`);
}

main();
