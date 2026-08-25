'use client';

import React, { useState } from 'react';

type MapView = 'overall' | 'daily_report' | 'meeting_intake' | 'linkedin' | 'ops';

interface ConceptNode {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  bg: string;
  border: string;
  shape?: 'star' | 'pill' | 'rect';
  fontSize?: number;
}

interface ConceptLink {
  from: string;
  to: string;
  label?: string;
  color?: string;
  dashed?: boolean;
}

interface ConceptMapData {
  title: string;
  subtitle: string;
  nodes: ConceptNode[];
  links: ConceptLink[];
}

const CONCEPT_MAPS: Record<MapView, ConceptMapData> = {
  overall: {
    title: 'BEXT Automation — Master Business Concept Map',
    subtitle: 'High-density concept topology mapping core capabilities, workflows, data storage, AI workers, and output channels.',
    nodes: [
      // Central Hub
      { id: 'center', label: 'BEXT Automation', sublabel: 'Operating Platform', x: 500, y: 350, width: 170, height: 75, color: '#f8fafc', bg: '#0284c7', border: '#38bdf8', shape: 'pill', fontSize: 16 },

      // Major Primary Branches
      { id: 'br-capture', label: 'Ingest & Capture', sublabel: '68 Sources & Audio', x: 230, y: 170, width: 160, height: 58, color: '#bae6fd', bg: '#0369a1', border: '#38bdf8', shape: 'pill' },
      { id: 'br-orchestration', label: 'n8n Engine', sublabel: '14 Workflows (:5678)', x: 770, y: 170, width: 160, height: 58, color: '#e0e7ff', bg: '#4338ca', border: '#818cf8', shape: 'pill' },
      { id: 'br-ai', label: 'AI Intelligence', sublabel: 'Gemini & Hermes', x: 210, y: 490, width: 160, height: 58, color: '#fef3c7', bg: '#b45309', border: '#f59e0b', shape: 'pill' },
      { id: 'br-sor', label: 'Systems of Record', sublabel: 'SharePoint, Postgres, CRM', x: 770, y: 490, width: 160, height: 58, color: '#ccfbf1', bg: '#0f766e', border: '#14b8a6', shape: 'pill' },
      { id: 'br-outputs', label: 'Client Outputs', sublabel: 'Emails, Cards, Docs', x: 500, y: 100, width: 150, height: 54, color: '#dcfce7', bg: '#15803d', border: '#34d399', shape: 'pill' },
      { id: 'br-ops', label: 'Self-Healing (R0-3)', sublabel: 'Kuma, Healer, Grafana', x: 500, y: 600, width: 160, height: 54, color: '#e0f2fe', bg: '#0369a1', border: '#38bdf8', shape: 'pill' },

      // Sub-concepts: Ingest & Capture (Top-Left)
      { id: 'cap-rss', label: '37 RSS Feeds', sublabel: 'AEMO, AER, News', x: 60, y: 90, width: 120, height: 42, color: '#f0f9ff', bg: '#1e293b', border: '#38bdf8' },
      { id: 'cap-scrapes', label: '31 Web Scrapes', sublabel: 'Gov & Regulators', x: 70, y: 150, width: 130, height: 42, color: '#f0f9ff', bg: '#1e293b', border: '#38bdf8' },
      { id: 'cap-teams', label: 'Teams Audio/VTT', sublabel: 'RACV Weekly Calls', x: 80, y: 210, width: 130, height: 42, color: '#f0f9ff', bg: '#1e293b', border: '#38bdf8' },
      { id: 'cap-imap', label: 'Newsletter IMAP', sublabel: 'Account-Wall Mail', x: 90, y: 270, width: 130, height: 42, color: '#f0f9ff', bg: '#1e293b', border: '#38bdf8' },

      // Sub-concepts: n8n Engine (Top-Right)
      { id: 'n8n-brief-a', label: 'Brief A Workflows', sublabel: 'Ingest & Analysis', x: 980, y: 100, width: 140, height: 44, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },
      { id: 'n8n-brief-b', label: 'Brief B Workflows', sublabel: 'Meeting Intake & Card', x: 980, y: 160, width: 140, height: 44, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },
      { id: 'n8n-content', label: 'Engagement C', sublabel: 'LinkedIn Topics & Drafts', x: 980, y: 220, width: 140, height: 44, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },
      { id: 'n8n-contracts', label: 'Contract Tests', sublabel: 'Nightly 02:00 Sandbox', x: 980, y: 280, width: 140, height: 44, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },

      // Sub-concepts: AI Intelligence (Bottom-Left)
      { id: 'ai-gemini', label: 'Gemini 3.6 Flash', sublabel: 'Minutes & Actions', x: 70, y: 440, width: 135, height: 44, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },
      { id: 'ai-hermes', label: 'Hermes 3 8B', sublabel: 'Scoring & Editorial Intro', x: 60, y: 500, width: 145, height: 44, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },
      { id: 'ai-docx', label: 'Docx Template Fill', sublabel: 'Fetcher Render Engine', x: 70, y: 560, width: 140, height: 44, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },
      { id: 'ai-voice', label: 'Brand Voice Logic', sublabel: '2 Distinct Angles', x: 80, y: 620, width: 135, height: 44, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },

      // Sub-concepts: Systems of Record (Bottom-Right)
      { id: 'sor-pg', label: 'Postgres (bext)', sublabel: '25 Migrations Live', x: 980, y: 440, width: 135, height: 44, color: '#f0fdfa', bg: '#042f2e', border: '#14b8a6' },
      { id: 'sor-sp', label: 'SharePoint BEXTHQ', sublabel: 'Transcripts & .docx', x: 980, y: 500, width: 145, height: 44, color: '#f0fdfa', bg: '#042f2e', border: '#14b8a6' },
      { id: 'sor-hubspot', label: 'HubSpot CRM', sublabel: 'Pipeline & Contacts', x: 980, y: 560, width: 135, height: 44, color: '#f0fdfa', bg: '#042f2e', border: '#14b8a6' },
      { id: 'sor-pm', label: 'ProjectManager', sublabel: 'Delivery & Tasks', x: 980, y: 620, width: 135, height: 44, color: '#f0fdfa', bg: '#042f2e', border: '#14b8a6' },

      // Sub-concepts: Outputs (Top Center)
      { id: 'out-mail', label: '05:00 AEST Daily Digest', sublabel: 'M365 Graph Send', x: 300, y: 30, width: 155, height: 42, color: '#f0fdf4', bg: '#052e16', border: '#34d399' },
      { id: 'out-card', label: 'Teams Adaptive Card', sublabel: 'Channel Announcements', x: 500, y: 20, width: 160, height: 42, color: '#f0fdf4', bg: '#052e16', border: '#34d399' },
      { id: 'out-li', label: 'LinkedIn Post Drafts', sublabel: 'Human Approved Feed', x: 700, y: 30, width: 155, height: 42, color: '#f0fdf4', bg: '#052e16', border: '#34d399' },

      // Sub-concepts: Self-Healing & Ops (Bottom Center)
      { id: 'ops-kuma', label: 'Uptime Kuma Deadmen', sublabel: 'Push URL Heartbeats', x: 300, y: 680, width: 155, height: 42, color: '#f0f9ff', bg: '#082f49', border: '#38bdf8' },
      { id: 'ops-healer', label: 'Self-Heal Engine', sublabel: 'Ring 1-3 Rule Matcher', x: 500, y: 680, width: 155, height: 42, color: '#f0f9ff', bg: '#082f49', border: '#38bdf8' },
      { id: 'ops-grafana', label: 'Grafana & Prometheus', sublabel: 'Host Memory & Metrics', x: 700, y: 680, width: 155, height: 42, color: '#f0f9ff', bg: '#082f49', border: '#38bdf8' },
    ],
    links: [
      // Center to Primary
      { from: 'center', to: 'br-capture' },
      { from: 'center', to: 'br-orchestration' },
      { from: 'center', to: 'br-ai' },
      { from: 'center', to: 'br-sor' },
      { from: 'center', to: 'br-outputs' },
      { from: 'center', to: 'br-ops' },

      // Ingest Branches
      { from: 'br-capture', to: 'cap-rss' },
      { from: 'br-capture', to: 'cap-scrapes' },
      { from: 'br-capture', to: 'cap-teams' },
      { from: 'br-capture', to: 'cap-imap' },

      // n8n Branches
      { from: 'br-orchestration', to: 'n8n-brief-a' },
      { from: 'br-orchestration', to: 'n8n-brief-b' },
      { from: 'br-orchestration', to: 'n8n-content' },
      { from: 'br-orchestration', to: 'n8n-contracts' },

      // AI Branches
      { from: 'br-ai', to: 'ai-gemini' },
      { from: 'br-ai', to: 'ai-hermes' },
      { from: 'br-ai', to: 'ai-docx' },
      { from: 'br-ai', to: 'ai-voice' },

      // SoR Branches
      { from: 'br-sor', to: 'sor-pg' },
      { from: 'br-sor', to: 'sor-sp' },
      { from: 'br-sor', to: 'sor-hubspot' },
      { from: 'br-sor', to: 'sor-pm' },

      // Output Branches
      { from: 'br-outputs', to: 'out-mail' },
      { from: 'br-outputs', to: 'out-card' },
      { from: 'br-outputs', to: 'out-li' },

      // Ops Branches
      { from: 'br-ops', to: 'ops-kuma' },
      { from: 'br-ops', to: 'ops-healer' },
      { from: 'br-ops', to: 'ops-grafana' },

      // Cross-linking
      { from: 'br-capture', to: 'br-orchestration', label: 'raw feeds', dashed: true },
      { from: 'br-orchestration', to: 'br-ai', label: 'model prompt', dashed: true },
      { from: 'br-ai', to: 'br-sor', label: 'save data', dashed: true },
      { from: 'br-sor', to: 'br-outputs', label: 'published', dashed: true },
    ],
  },

  daily_report: {
    title: 'Brief A — Daily Report Pipeline Concept Map',
    subtitle: 'Concepts, scraping tiers, scoring mechanics, deliverability checks, and executive email generation.',
    nodes: [
      { id: 'dr-core', label: 'Daily Report Engine', sublabel: '05:00 AEST Brief A', x: 500, y: 350, width: 180, height: 75, color: '#f8fafc', bg: '#0f766e', border: '#14b8a6', shape: 'pill', fontSize: 16 },

      { id: 'dr-sources', label: 'Source Ingestion', sublabel: '68 Monitored Sources', x: 230, y: 200, width: 160, height: 55, color: '#bae6fd', bg: '#0369a1', border: '#38bdf8', shape: 'pill' },
      { id: 'dr-ladder', label: '4-Tier Ladder', sublabel: 'Retrieval Fallbacks', x: 100, y: 100, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },
      { id: 'dr-hash', label: 'Content Hash Dedupe', sublabel: 'SHA256 Title+Snippet', x: 100, y: 160, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },
      { id: 'dr-db-articles', label: 'articles Table', sublabel: 'Raw Ingested Stories', x: 100, y: 220, width: 140, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },

      { id: 'dr-analysis', label: 'Article Analysis', sublabel: '30-Min Batch Scorer', x: 770, y: 200, width: 160, height: 55, color: '#fef3c7', bg: '#b45309', border: '#f59e0b', shape: 'pill' },
      { id: 'dr-hermes', label: 'Hermes 3 (1-10)', sublabel: 'Relevance Grading', x: 960, y: 100, width: 140, height: 42, color: '#f8fafc', bg: '#451a03', border: '#f59e0b' },
      { id: 'dr-cats', label: 'Category Partition', sublabel: 'Aus / Intl / Industry', x: 960, y: 160, width: 140, height: 42, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },
      { id: 'dr-db-analysis', label: 'article_analysis DB', sublabel: 'Scored & Summarized', x: 960, y: 220, width: 140, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },

      { id: 'dr-assemble', label: 'Report Assembler', sublabel: 'Daily 05:00 AEST', x: 230, y: 500, width: 160, height: 55, color: '#e0e7ff', bg: '#4338ca', border: '#818cf8', shape: 'pill' },
      { id: 'dr-intro', label: 'Editorial Briefing', sublabel: '2-3 Sentences Intro', x: 100, y: 480, width: 140, height: 42, color: '#f8fafc', bg: '#451a03', border: '#f59e0b' },
      { id: 'dr-images', label: 'og:image Artwork', sublabel: 'Scrapling Extraction', x: 100, y: 540, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },
      { id: 'dr-deliverability', label: 'Deliverability Node', sublabel: 'DoH SPF/DMARC/DKIM', x: 100, y: 600, width: 140, height: 42, color: '#f8fafc', bg: '#0369a1', border: '#38bdf8' },

      { id: 'dr-delivery', label: 'Executive Delivery', sublabel: 'M365 Email & Teams', x: 770, y: 500, width: 160, height: 55, color: '#dcfce7', bg: '#15803d', border: '#34d399', shape: 'pill' },
      { id: 'dr-sendmail', label: 'Graph App-Only Mail', sublabel: 'Admin.bext-automation@', x: 960, y: 480, width: 150, height: 42, color: '#f8fafc', bg: '#052e16', border: '#34d399' },
      { id: 'dr-card', label: 'Teams News Card', sublabel: 'Daily 05:20 Channel Post', x: 960, y: 540, width: 150, height: 42, color: '#f8fafc', bg: '#052e16', border: '#34d399' },
      { id: 'dr-reconcile', label: 'Zero Noise Filter', sublabel: 'relevance >= 1 only', x: 960, y: 600, width: 150, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },
    ],
    links: [
      { from: 'dr-core', to: 'dr-sources' },
      { from: 'dr-sources', to: 'dr-ladder' },
      { from: 'dr-sources', to: 'dr-hash' },
      { from: 'dr-sources', to: 'dr-db-articles' },

      { from: 'dr-core', to: 'dr-analysis' },
      { from: 'dr-analysis', to: 'dr-hermes' },
      { from: 'dr-analysis', to: 'dr-cats' },
      { from: 'dr-analysis', to: 'dr-db-analysis' },

      { from: 'dr-core', to: 'dr-assemble' },
      { from: 'dr-assemble', to: 'dr-intro' },
      { from: 'dr-assemble', to: 'dr-images' },
      { from: 'dr-assemble', to: 'dr-deliverability' },

      { from: 'dr-core', to: 'dr-delivery' },
      { from: 'dr-delivery', to: 'dr-sendmail' },
      { from: 'dr-delivery', to: 'dr-card' },
      { from: 'dr-delivery', to: 'dr-reconcile' },

      { from: 'dr-sources', to: 'dr-analysis', label: 'articles', dashed: true },
      { from: 'dr-analysis', to: 'dr-assemble', label: 'scores', dashed: true },
      { from: 'dr-assemble', to: 'dr-delivery', label: 'HTML digest', dashed: true },
    ],
  },

  meeting_intake: {
    title: 'Brief B — Meeting Intake & Filing Pipeline Concept Map',
    subtitle: 'Transcript capture, Gemini extraction, .docx generation, dual-destination SharePoint filing, and Teams card post.',
    nodes: [
      { id: 'mi-core', label: 'Meeting Pipeline', sublabel: 'Brief B Automation', x: 500, y: 350, width: 180, height: 75, color: '#f8fafc', bg: '#6d28d9', border: '#a78bfa', shape: 'pill', fontSize: 16 },

      { id: 'mi-trigger', label: 'Transcript Capture', sublabel: '15-Min Poll & Webhook', x: 230, y: 200, width: 160, height: 55, color: '#bae6fd', bg: '#0369a1', border: '#38bdf8', shape: 'pill' },
      { id: 'mi-hosts', label: 'MEETING_HOSTS', sublabel: 'Multi-Organiser Scan', x: 100, y: 120, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },
      { id: 'mi-dedupe', label: 'transcript_id Dedupe', sublabel: 'Per-Occurrence Key', x: 100, y: 180, width: 140, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },
      { id: 'mi-vtt', label: 'VTT Subtitles Format', sublabel: 'Text Stream Ingestion', x: 100, y: 240, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },

      { id: 'mi-gemini', label: 'Gemini 3.6 Flash', sublabel: 'AI Minutes & Actions', x: 770, y: 200, width: 160, height: 55, color: '#fef3c7', bg: '#b45309', border: '#f59e0b', shape: 'pill' },
      { id: 'mi-summary', label: 'Executive Summary', sublabel: 'Decisions & Context', x: 960, y: 120, width: 140, height: 42, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },
      { id: 'mi-actions', label: 'Action Items Array', sublabel: 'Owner, Due, Status', x: 960, y: 180, width: 140, height: 42, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },
      { id: 'mi-prompt', label: 'Structured JSON', sublabel: 'Strict Output Schema', x: 960, y: 240, width: 140, height: 42, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },

      { id: 'mi-render', label: 'Document Engine', sublabel: 'Fetcher .docx Service', x: 230, y: 500, width: 160, height: 55, color: '#e0e7ff', bg: '#4338ca', border: '#818cf8', shape: 'pill' },
      { id: 'mi-template', label: 'Minutes Template.docx', sublabel: 'BEXT Branding & Format', x: 100, y: 460, width: 140, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },
      { id: 'mi-zip', label: 'Zip Magic 504b0304', sublabel: 'Binary Intactness Guard', x: 100, y: 520, width: 140, height: 42, color: '#f8fafc', bg: '#0369a1', border: '#38bdf8' },
      { id: 'mi-files', label: 'Transcript & Summary', sublabel: 'Companion Artifacts', x: 100, y: 580, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },

      { id: 'mi-filing', label: 'Filing & Broadcast', sublabel: 'SharePoint & Teams', x: 770, y: 500, width: 160, height: 55, color: '#dcfce7', bg: '#15803d', border: '#34d399', shape: 'pill' },
      { id: 'mi-sp-records', label: 'Channel Records Site', sublabel: '/sites/bext_transcripts', x: 960, y: 460, width: 150, height: 42, color: '#f0fdfa', bg: '#042f2e', border: '#14b8a6' },
      { id: 'mi-sp-hq', label: 'BEXTHQ Archive Site', sublabel: 'API Automation Folder', x: 960, y: 520, width: 150, height: 42, color: '#f0fdfa', bg: '#042f2e', border: '#14b8a6' },
      { id: 'mi-card', label: 'Teams Adaptive Card', sublabel: 'Power Automate Webhook', x: 960, y: 580, width: 150, height: 42, color: '#f0fdf4', bg: '#052e16', border: '#34d399' },
    ],
    links: [
      { from: 'mi-core', to: 'mi-trigger' },
      { from: 'mi-trigger', to: 'mi-hosts' },
      { from: 'mi-trigger', to: 'mi-dedupe' },
      { from: 'mi-trigger', to: 'mi-vtt' },

      { from: 'mi-core', to: 'mi-gemini' },
      { from: 'mi-gemini', to: 'mi-summary' },
      { from: 'mi-gemini', to: 'mi-actions' },
      { from: 'mi-gemini', to: 'mi-prompt' },

      { from: 'mi-core', to: 'mi-render' },
      { from: 'mi-render', to: 'mi-template' },
      { from: 'mi-render', to: 'mi-zip' },
      { from: 'mi-render', to: 'mi-files' },

      { from: 'mi-core', to: 'mi-filing' },
      { from: 'mi-filing', to: 'mi-sp-records' },
      { from: 'mi-filing', to: 'mi-sp-hq' },
      { from: 'mi-filing', to: 'mi-card' },

      { from: 'mi-trigger', to: 'mi-gemini', label: 'VTT text', dashed: true },
      { from: 'mi-gemini', to: 'mi-render', label: 'structured json', dashed: true },
      { from: 'mi-render', to: 'mi-filing', label: '.docx bytes', dashed: true },
    ],
  },

  linkedin: {
    title: 'Engagement C — LinkedIn Thought Leadership Concept Map',
    subtitle: 'Fortnightly news scan, AI multi-variant drafting, founder review gate, and LinkedIn API publishing.',
    nodes: [
      { id: 'li-core', label: 'LinkedIn Engine', sublabel: 'Engagement C Brand', x: 500, y: 350, width: 180, height: 75, color: '#f8fafc', bg: '#b45309', border: '#f59e0b', shape: 'pill', fontSize: 16 },

      { id: 'li-scan', label: 'Topic Discovery', sublabel: 'Fortnightly News Scan', x: 230, y: 200, width: 160, height: 55, color: '#bae6fd', bg: '#0369a1', border: '#38bdf8', shape: 'pill' },
      { id: 'li-news-db', label: 'High Score Articles', sublabel: 'Relevance >= 8 Focus', x: 100, y: 140, width: 140, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },
      { id: 'li-rank-3', label: 'Rank 3 Topics', sublabel: 'Distinct Angles', x: 100, y: 220, width: 140, height: 42, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },

      { id: 'li-draft', label: 'Drafting Engine', sublabel: '2 Brand Variants', x: 770, y: 200, width: 160, height: 55, color: '#fef3c7', bg: '#b45309', border: '#f59e0b', shape: 'pill' },
      { id: 'li-var1', label: 'Direct & Concise', sublabel: 'Technical Executive Tone', x: 960, y: 140, width: 145, height: 42, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },
      { id: 'li-var2', label: 'Strategic & Advisory', sublabel: 'Industry Perspective', x: 960, y: 220, width: 145, height: 42, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },

      { id: 'li-gate', label: 'Human Review Gate', sublabel: 'Founder Approval UI', x: 500, y: 120, width: 170, height: 55, color: '#ffe4e6', bg: '#be123c', border: '#fb7185', shape: 'pill' },
      { id: 'li-edit', label: 'Founder Tone Edits', sublabel: 'In-place Polish', x: 350, y: 40, width: 135, height: 40, color: '#f8fafc', bg: '#4c0519', border: '#fb7185' },
      { id: 'li-approve', label: 'Approve & Release', sublabel: 'One-Click Trigger', x: 515, y: 40, width: 135, height: 40, color: '#f8fafc', bg: '#052e16', border: '#34d399' },
      { id: 'li-reject', label: 'Request Rewrite', sublabel: 'Prompt Iteration', x: 680, y: 40, width: 135, height: 40, color: '#f8fafc', bg: '#451a03', border: '#f59e0b' },

      { id: 'li-pub', label: 'Publishing & Sync', sublabel: 'LinkedIn API & Metrics', x: 500, y: 550, width: 170, height: 55, color: '#dcfce7', bg: '#15803d', border: '#34d399', shape: 'pill' },
      { id: 'li-post', label: 'Live LinkedIn Post', sublabel: 'External URN Saved', x: 330, y: 640, width: 140, height: 42, color: '#f8fafc', bg: '#052e16', border: '#34d399' },
      { id: 'li-actions-db', label: 'content_actions DB', sublabel: 'Impressions & Likes', x: 500, y: 640, width: 140, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },
      { id: 'li-feedback', label: 'Learning Feedback', sublabel: 'Tune Future Topics', x: 670, y: 640, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },
    ],
    links: [
      { from: 'li-core', to: 'li-scan' },
      { from: 'li-scan', to: 'li-news-db' },
      { from: 'li-scan', to: 'li-rank-3' },

      { from: 'li-core', to: 'li-draft' },
      { from: 'li-draft', to: 'li-var1' },
      { from: 'li-draft', to: 'li-var2' },

      { from: 'li-core', to: 'li-gate' },
      { from: 'li-gate', to: 'li-edit' },
      { from: 'li-gate', to: 'li-approve' },
      { from: 'li-gate', to: 'li-reject' },

      { from: 'li-core', to: 'li-pub' },
      { from: 'li-pub', to: 'li-post' },
      { from: 'li-pub', to: 'li-actions-db' },
      { from: 'li-pub', to: 'li-feedback' },

      { from: 'li-scan', to: 'li-draft', label: 'topic choices', dashed: true },
      { from: 'li-draft', to: 'li-gate', label: '2 variants', dashed: true },
      { from: 'li-gate', to: 'li-pub', label: 'approved copy', dashed: true },
    ],
  },

  ops: {
    title: 'Platform Operations & Self-Healing Loop Concept Map',
    subtitle: 'Rings 0–3: Continuous deadman monitoring, automated incident classification, bounded remediation, and regression assertions.',
    nodes: [
      { id: 'ops-core', label: 'Self-Healing Engine', sublabel: 'Platform Reliability', x: 500, y: 350, width: 180, height: 75, color: '#f8fafc', bg: '#0369a1', border: '#38bdf8', shape: 'pill', fontSize: 16 },

      { id: 'r0', label: 'Ring 0: Detect', sublabel: 'Uptime Kuma Deadmen', x: 230, y: 200, width: 160, height: 55, color: '#bae6fd', bg: '#0369a1', border: '#38bdf8', shape: 'pill' },
      { id: 'r0-push', label: 'Push Monitors', sublabel: 'Scheduled Crons', x: 100, y: 140, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },
      { id: 'r0-heartbeat', label: 'Heartbeat Nodes', sublabel: 'Unconditional Ping', x: 100, y: 220, width: 140, height: 42, color: '#f8fafc', bg: '#1e293b', border: '#38bdf8' },

      { id: 'r1', label: 'Ring 1: Diagnose', sublabel: 'Heal Rules Classification', x: 770, y: 200, width: 160, height: 55, color: '#fef3c7', bg: '#b45309', border: '#f59e0b', shape: 'pill' },
      { id: 'r1-regex', label: 'heal-rules.js', sublabel: 'Known Regex Patterns', x: 960, y: 140, width: 140, height: 42, color: '#fffbeb', bg: '#451a03', border: '#f59e0b' },
      { id: 'r1-db', label: 'incidents Table', sublabel: 'Status = detected', x: 960, y: 220, width: 140, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },

      { id: 'r2', label: 'Ring 2: Remediate', sublabel: '6 Safe Auto-Actions', x: 230, y: 500, width: 160, height: 55, color: '#e0e7ff', bg: '#4338ca', border: '#818cf8', shape: 'pill' },
      { id: 'r2-reactivate', label: 'Reactivate Workflow', sublabel: 'Flapping Trigger Fix', x: 100, y: 460, width: 140, height: 42, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },
      { id: 'r2-restart', label: 'Restart Container', sublabel: 'Allowlisted bext-* only', x: 100, y: 520, width: 140, height: 42, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },
      { id: 'r2-token', label: 'Refresh Graph Token', sublabel: 'App-Only Reauth', x: 100, y: 580, width: 140, height: 42, color: '#f8fafc', bg: '#1e1b4b', border: '#818cf8' },

      { id: 'r3', label: 'Ring 3: Learn & Audit', sublabel: 'Regression Guards', x: 770, y: 500, width: 160, height: 55, color: '#dcfce7', bg: '#15803d', border: '#34d399', shape: 'pill' },
      { id: 'r3-teams', label: 'Teams Escalation', sublabel: 'Unknown Faults Alert', x: 960, y: 460, width: 150, height: 42, color: '#f8fafc', bg: '#052e16', border: '#34d399' },
      { id: 'r3-preflight', label: 'preflight.js (30)', sublabel: 'Hard Assertions Suite', x: 960, y: 520, width: 150, height: 42, color: '#f8fafc', bg: '#052e16', border: '#34d399' },
      { id: 'r3-doc', label: 'REGRESSIONS.md', sublabel: 'Documented Root Causes', x: 960, y: 580, width: 150, height: 42, color: '#f8fafc', bg: '#042f2e', border: '#14b8a6' },
    ],
    links: [
      { from: 'ops-core', to: 'r0' },
      { from: 'r0', to: 'r0-push' },
      { from: 'r0', to: 'r0-heartbeat' },

      { from: 'ops-core', to: 'r1' },
      { from: 'r1', to: 'r1-regex' },
      { from: 'r1', to: 'r1-db' },

      { from: 'ops-core', to: 'r2' },
      { from: 'r2', to: 'r2-reactivate' },
      { from: 'r2', to: 'r2-restart' },
      { from: 'r2', to: 'r2-token' },

      { from: 'ops-core', to: 'r3' },
      { from: 'r3', to: 'r3-teams' },
      { from: 'r3', to: 'r3-preflight' },
      { from: 'r3', to: 'r3-doc' },

      { from: 'r0', to: 'r1', label: 'failed tick', dashed: true },
      { from: 'r1', to: 'r2', label: 'auto action', dashed: true },
      { from: 'r2', to: 'r3', label: 'if unhealed', dashed: true },
    ],
  },
};

export function ConceptMap() {
  const [activeTab, setActiveTab] = useState<MapView>('overall');
  const [zoom, setZoom] = useState(1);
  const currentMap = CONCEPT_MAPS[activeTab];

  const nodeMap = new Map(currentMap.nodes.map(n => [n.id, n]));

  return (
    <div className="space-y-6">
      {/* Tab Selector Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/90 border border-slate-800 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('overall')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'overall'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            🏢 Overall Architecture Map
          </button>
          <button
            onClick={() => setActiveTab('daily_report')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'daily_report'
                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            📰 Daily Report Map
          </button>
          <button
            onClick={() => setActiveTab('meeting_intake')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'meeting_intake'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            🎙️ Meeting Intake Map
          </button>
          <button
            onClick={() => setActiveTab('linkedin')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'linkedin'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            💼 LinkedIn Engine Map
          </button>
          <button
            onClick={() => setActiveTab('ops')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'ops'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            🛡️ Self-Healing Loop Map
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
          <button
            onClick={() => setZoom(z => Math.max(0.6, z - 0.1))}
            className="px-1.5 py-0.5 text-xs text-slate-400 hover:text-white rounded hover:bg-slate-800"
            title="Zoom out"
          >
            −
          </button>
          <span className="text-[11px] font-mono text-slate-300 px-1">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(1.4, z + 0.1))}
            className="px-1.5 py-0.5 text-xs text-slate-400 hover:text-white rounded hover:bg-slate-800"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => setZoom(1)}
            className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-slate-300 rounded hover:bg-slate-800"
            title="Reset zoom"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
        <h3 className="text-sm font-bold text-white tracking-tight">
          {currentMap.title}
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          {currentMap.subtitle}
        </p>
      </div>

      {/* Concept Map SVG Canvas */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/95 overflow-hidden shadow-2xl p-4 relative min-h-[640px] flex items-center justify-center">
        {/* Ambient Grid */}
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#475569 1px, transparent 1px)`,
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          }}
        />

        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          className="transition-transform duration-150 overflow-visible"
        >
          <svg
            width="1180"
            height="760"
            viewBox="0 0 1180 760"
            className="overflow-visible select-none"
          >
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000000" floodOpacity="0.6" />
              </filter>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#64748b" />
              </marker>
              <marker
                id="arrowhead-active"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#38bdf8" />
              </marker>
            </defs>

            {/* Connecting Lines / Links */}
            {currentMap.links.map((link, idx) => {
              const src = nodeMap.get(link.from);
              const dst = nodeMap.get(link.to);
              if (!src || !dst) return null;

              const srcCx = src.x + src.width / 2;
              const srcCy = src.y + src.height / 2;
              const dstCx = dst.x + dst.width / 2;
              const dstCy = dst.y + dst.height / 2;

              const midX = (srcCx + dstCx) / 2;
              const midY = (srcCy + dstCy) / 2;

              return (
                <g key={`link-${idx}`}>
                  <path
                    d={`M ${srcCx} ${srcCy} Q ${midX} ${midY} ${dstCx} ${dstCy}`}
                    fill="none"
                    stroke={link.color || (link.dashed ? '#38bdf8' : '#475569')}
                    strokeWidth={link.dashed ? 1.8 : 1.4}
                    strokeDasharray={link.dashed ? '4 4' : undefined}
                    opacity={link.dashed ? 0.9 : 0.6}
                    markerEnd={link.dashed ? 'url(#arrowhead-active)' : undefined}
                  />
                  {link.label && (
                    <g transform={`translate(${midX}, ${midY - 8})`}>
                      <rect
                        x="-40"
                        y="-10"
                        width="80"
                        height="18"
                        rx="9"
                        fill="#0f172a"
                        stroke="#334155"
                        strokeWidth="1"
                      />
                      <text
                        x="0"
                        y="2"
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="9"
                        fontWeight="600"
                        fill="#38bdf8"
                        fontFamily="monospace"
                      >
                        {link.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Render Nodes */}
            {currentMap.nodes.map(n => {
              const rx = n.shape === 'pill' ? n.height / 2 : 12;
              const isCenter = n.id === 'center' || n.id.endsWith('-core');

              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x}, ${n.y})`}
                  className="cursor-pointer group"
                  filter="url(#glow)"
                >
                  <rect
                    width={n.width}
                    height={n.height}
                    rx={rx}
                    fill={n.bg}
                    stroke={n.border}
                    strokeWidth={isCenter ? 2.5 : 1.6}
                    className="transition-all group-hover:brightness-125"
                  />
                  <text
                    x={n.width / 2}
                    y={n.sublabel ? n.height / 2 - 7 : n.height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={n.fontSize || 12}
                    fontWeight="700"
                    fill={n.color}
                    fontFamily="inherit"
                  >
                    {n.label}
                  </text>
                  {n.sublabel && (
                    <text
                      x={n.width / 2}
                      y={n.height / 2 + 10}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="9.5"
                      fontWeight="500"
                      fill="#94a3b8"
                      fontFamily="inherit"
                    >
                      {n.sublabel}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
