'use client';

import React, { useState } from 'react';

type FlowView = 'overall' | 'daily_report' | 'meeting_intake' | 'linkedin';

interface StepCard {
  step: string;
  title: string;
  subtitle: string;
  badge: string;
  tagColor: string;
  details: string[];
}

const FLOWS: Record<FlowView, { title: string; subtitle: string; steps: StepCard[] }> = {
  overall: {
    title: 'Overall Business Architecture & Data Flow',
    subtitle: 'End-to-end integration: Raw Capture ➔ n8n Orchestration ➔ AI Transformation ➔ Storage SoR ➔ Client Outputs',
    steps: [
      {
        step: '01',
        title: '68 Industry Feeds & Teams',
        subtitle: 'Ingestion Layer',
        badge: 'Raw Capture',
        tagColor: '#38bdf8',
        details: ['37 RSS/Atom feeds + 31 Scrapes', 'Scheduled Teams audio calls', 'Inbound newsletter mailbox (IMAP)'],
      },
      {
        step: '02',
        title: 'n8n Workflow Engine',
        subtitle: 'Self-Hosted on VPS (:5678)',
        badge: 'Orchestration',
        tagColor: '#818cf8',
        details: ['14 automated scheduled & webhook flows', '4-Tier fallback retrieval ladder', 'Heartbeat deadman monitoring'],
      },
      {
        step: '03',
        title: 'AI Intelligence Models',
        subtitle: 'Gemini 3.6 Flash & Hermes 3 8B',
        badge: '🤖 AI Transformation',
        tagColor: '#f59e0b',
        details: ['Gemini extracts minutes & actions', 'Hermes 3 grades news relevance (1-10)', 'Headless .docx template renderer'],
      },
      {
        step: '04',
        title: 'Systems of Record',
        subtitle: 'PostgreSQL 16 & SharePoint',
        badge: 'Permanent Storage',
        tagColor: '#14b8a6',
        details: ['articles & meeting_minutes tables', 'BEXTHQ document archive folder', 'HubSpot deals & PM milestones'],
      },
      {
        step: '05',
        title: 'Client Deliverables',
        subtitle: 'Teams, Outlook, & LinkedIn',
        badge: 'Action & Delivery',
        tagColor: '#34d399',
        details: ['05:00 AEST Executive Email Digest', 'Adaptive Card 1.4 in Teams Channel', 'LinkedIn Thought Leadership drafts'],
      },
    ],
  },
  daily_report: {
    title: 'Brief A — Daily News & Industry Intelligence Pipeline',
    subtitle: 'Autonomous news scraping, model grading, and daily 05:00 AEST executive email dispatch',
    steps: [
      {
        step: '01',
        title: 'BEXT — Source Ingest',
        subtitle: 'Hourly Cron Schedule',
        badge: 'Scrape Engine',
        tagColor: '#38bdf8',
        details: ['Direct HTTP ➔ Scrapling Chromium ➔ Hermes reader', 'Content hash deduplication', 'Writes to `articles` table'],
      },
      {
        step: '02',
        title: 'BEXT — Article Analysis',
        subtitle: '30-Minute Schedule',
        badge: '🤖 LLM Scorer',
        tagColor: '#f59e0b',
        details: ['Ollama Hermes 3 8B grades relevance 1-10', 'Categorizes Aus / International / Industry', 'Writes to `article_analysis` table'],
      },
      {
        step: '03',
        title: 'BEXT — Daily Report',
        subtitle: 'Daily 05:00 AEST Cron',
        badge: 'Digest Assembler',
        tagColor: '#818cf8',
        details: ['Hermes writes 2-3 sentence editorial intro', 'Fetches lead images via og:image', 'DoH deliverability probe (SPF/DKIM/DMARC)'],
      },
      {
        step: '04',
        title: 'Microsoft Graph Mail',
        subtitle: 'M365 App-Only Delivery',
        badge: '📧 Email Dispatch',
        tagColor: '#34d399',
        details: ['Sent from Admin.bext-automation@', 'Zero noise filter (relevance >= 1)', 'Writes to `reports` & `report_items`'],
      },
      {
        step: '05',
        title: 'BEXT — Daily News Card',
        subtitle: 'Daily 05:20 AEST Cron',
        badge: '📢 Teams Channel',
        tagColor: '#34d399',
        details: ['Top 5 lead energy stories', 'Direct link to interactive web viewer', 'Posts via Power Automate Webhook'],
      },
    ],
  },
  meeting_intake: {
    title: 'Brief B — Unattended Meeting Intake & Minutes Filing Pipeline',
    subtitle: 'Automated transcript download, Gemini minutes extraction, .docx generation, SharePoint filing, and Teams card',
    steps: [
      {
        step: '01',
        title: 'BEXT — Meeting Intake',
        subtitle: '15-Min Cadence / Inbound Hook',
        badge: 'Transcript Ingest',
        tagColor: '#38bdf8',
        details: ['Graph getAllTranscripts per MEETING_HOSTS', 'Deduplicates by occurrence transcript_id', 'VTT subtitle format download'],
      },
      {
        step: '02',
        title: 'Gemini 3.6 Flash',
        subtitle: 'M365 Cloud AI Model',
        badge: '🤖 AI Extraction',
        tagColor: '#f59e0b',
        details: ['Extracts executive summary & decisions', 'Status mapping (On Track, At Risk, Complete)', 'Assigns owners without hallucinating'],
      },
      {
        step: '03',
        title: 'Document Generator',
        subtitle: 'VPS Fetcher /render-docx',
        badge: '⚙️ Word Renderer',
        tagColor: '#f59e0b',
        details: ['Fills BEXT Minutes Template.docx', 'Zip-magic verification (504b0304)', 'Builds Summary.docx & Transcript.vtt'],
      },
      {
        step: '04',
        title: 'SharePoint Filing',
        subtitle: 'Graph App-Only Upload',
        badge: 'Cloud Storage',
        tagColor: '#14b8a6',
        details: ['Files to /sites/bext_transcriptsrecords', 'Files to BEXTHQ archive folder', 'Upserts row into `meeting_minutes`'],
      },
      {
        step: '05',
        title: 'Channel Card & Health Check',
        subtitle: 'Teams Post & Daily Reconcile',
        badge: '📢 Channel Output',
        tagColor: '#34d399',
        details: ['Adaptive Card 1.4 with actions summary', 'Unsent Outlook email draft created', 'Graph Health reconciles all transcripts'],
      },
    ],
  },
  linkedin: {
    title: 'Engagement C — Fortnightly LinkedIn Thought Leadership Engine',
    subtitle: 'News topic ranking, multi-variant drafting, human-in-the-loop tone approval, and published analytics',
    steps: [
      {
        step: '01',
        title: 'BEXT — Content Topics',
        subtitle: 'Fortnightly Schedule',
        badge: 'Topic Scanner',
        tagColor: '#38bdf8',
        details: ['Scans top scored energy & policy articles', 'Ranks 3 candidate angles for BEXT perspective', 'Writes to `content_topics` table'],
      },
      {
        step: '02',
        title: 'BEXT — Content Drafts',
        subtitle: 'AI Drafting Engine',
        badge: '🤖 Multi-Draft AI',
        tagColor: '#f59e0b',
        details: ['Generates 2 tone variants (Direct & Strategic)', 'Enforces BEXT brand voice & structure', 'Writes to `content_drafts` table'],
      },
      {
        step: '03',
        title: 'Human Review Gate',
        subtitle: 'Dashboard /content UI',
        badge: '👤 Founder Review',
        tagColor: '#fb7185',
        details: ['Founder chooses best variant or edits copy', 'One-click Approve / Request Rewrite', 'Sets status to approved'],
      },
      {
        step: '04',
        title: 'BEXT — LinkedIn Publish',
        subtitle: 'Publishing Engine',
        badge: '🚀 Social Dispatch',
        tagColor: '#818cf8',
        details: ['Staged publish via LinkedIn REST API', 'Image asset attachment', 'Records external post urn and timestamp'],
      },
      {
        step: '05',
        title: 'BEXT — Content Actions',
        subtitle: 'Engagement Sync',
        badge: '📊 Analytics Log',
        tagColor: '#34d399',
        details: ['Tracks impressions, likes, and comments', 'Appends metrics to `content_actions`', 'Feeds content performance feedback loop'],
      },
    ],
  },
};

export function ArchitectureFlowchart() {
  const [activeTab, setActiveTab] = useState<FlowView>('overall');
  const currentFlow = FLOWS[activeTab];

  return (
    <div className="space-y-6">
      {/* Tab Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/90 border border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('overall')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'overall'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            🏢 Overall Architecture
          </button>
          <button
            onClick={() => setActiveTab('daily_report')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'daily_report'
                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            📰 Daily Report Flow (Brief A)
          </button>
          <button
            onClick={() => setActiveTab('meeting_intake')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'meeting_intake'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            🎙️ Meeting Intake Flow (Brief B)
          </button>
          <button
            onClick={() => setActiveTab('linkedin')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'linkedin'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            💼 LinkedIn Engine (Engagement C)
          </button>
        </div>

        <span className="text-[11px] font-mono text-slate-400">
          Click tabs to switch pipeline diagrams
        </span>
      </div>

      {/* Current Flow Description */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
        <h3 className="text-sm font-bold text-white tracking-tight">
          {currentFlow.title}
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          {currentFlow.subtitle}
        </p>
      </div>

      {/* 5-Step Process Cards Flowchart */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {currentFlow.steps.map((s, idx) => (
          <div
            key={s.step}
            className="flex flex-col rounded-xl border p-4 bg-slate-900/90 hover:border-slate-600 transition-all shadow-xl space-y-3 relative group"
            style={{
              borderColor: `${s.tagColor}44`,
            }}
          >
            {/* Step Header */}
            <div className="flex items-center justify-between">
              <span
                className="font-mono text-xs font-bold px-2 py-0.5 rounded"
                style={{
                  backgroundColor: `${s.tagColor}18`,
                  color: s.tagColor,
                  border: `1px solid ${s.tagColor}44`,
                }}
              >
                Step {s.step}
              </span>
              <span
                className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded font-mono"
                style={{
                  backgroundColor: `${s.tagColor}22`,
                  color: s.tagColor,
                }}
              >
                {s.badge}
              </span>
            </div>

            {/* Title & Subtitle */}
            <div>
              <h4 className="text-xs font-bold text-slate-100 group-hover:text-teal-300 transition-colors">
                {s.title}
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {s.subtitle}
              </p>
            </div>

            {/* Step Details Bullet List */}
            <ul className="pt-2 border-t border-slate-800/80 space-y-1.5 text-[11px] text-slate-300 flex-1">
              {s.details.map((d, dIdx) => (
                <li key={dIdx} className="flex items-start gap-1.5">
                  <span className="text-teal-400 select-none">→</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>

            {/* Right Arrow indicator between steps on desktop */}
            {idx < currentFlow.steps.length - 1 && (
              <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 bg-slate-950 border border-slate-800 rounded-full w-6 h-6 flex items-center justify-center text-[10px] text-slate-400 shadow-md">
                ➔
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Excalidraw Download & Raw Files Notice */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 text-xs flex flex-wrap items-center justify-between gap-3 text-slate-400">
        <div className="flex items-center gap-2">
          <span className="text-teal-400 font-bold">📄 Editable Excalidraw Files Available:</span>
          <span>`docs/diagrams/*.excalidraw` (Open in Excalidraw or VS Code)</span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">
          overall-business-architecture · daily-report-pipeline · meeting-intake-pipeline · linkedin-content-pipeline
        </span>
      </div>
    </div>
  );
}
