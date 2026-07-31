/**
 * Static platform inventory — the single source of truth for the Connection
 * Health page and the Timeline setup checklist. No database dependency: this
 * describes the tooling itself, and is updated by commit when the stack changes.
 *
 * Sources: PLAN 1 (dev stack), the two 2026-07-28 project briefs, and the
 * actual state of the environment as configured.
 */

export type SetupStatus = 'configured' | 'in_progress' | 'pending' | 'optional';

export type ToolCategory =
  | 'Hosting'
  | 'Infrastructure'
  | 'Automation'
  | 'Data'
  | 'AI'
  | 'Microsoft'
  | 'Development';

export interface PlatformTool {
  id: string;
  name: string;
  category: ToolCategory;
  purpose: string;
  cost: string;            // human label, e.g. "Free (self-hosted)"
  paid: boolean;           // true when it costs money today
  owner: 'You' | 'Client';
  status: SetupStatus;
  endpoint?: string;       // where it lives, shown on the health card
  note?: string;           // config detail / what remains
  thisWeek?: boolean;      // highlighted in the current sprint
}

export const TOOLS: PlatformTool[] = [
  // ── Hosting ────────────────────────────────────────────────────────────
  {
    id: 'cpanel-subdomain',
    name: 'iFastNet cPanel — bext.dev-environment.site',
    category: 'Hosting',
    purpose: 'Hosts this dashboard (backend site server) on the bext subdomain',
    cost: 'Existing plan',
    paid: true,
    owner: 'You',
    status: 'configured',
    endpoint: 'bext.dev-environment.site',
    note: 'Subdomain + Node.js 22 selector ready; app deploy and SSL reissue in progress.',
    thisWeek: true,
  },
  {
    id: 'hostinger-vps',
    name: 'Hostinger VPS',
    category: 'Hosting',
    purpose: 'Runs the n8n automation stack (Docker: n8n, PostgreSQL, Qdrant)',
    cost: 'Paid',
    paid: true,
    owner: 'You',
    status: 'configured',
    endpoint: 'srv1866850 · 187.127.213.243',
    note: 'n8n-only host per current plan.',
    thisWeek: true,
  },

  // ── Infrastructure ─────────────────────────────────────────────────────
  {
    id: 'docker',
    name: 'Docker & Docker Compose',
    category: 'Infrastructure',
    purpose: 'Container management for the VPS stack',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'configured',
    endpoint: 'VPS · infra/docker-compose.yml',
    thisWeek: true,
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    category: 'Infrastructure',
    purpose: 'Monitoring & uptime alerts',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'optional',
  },
  {
    id: 'cloudflare-tunnel',
    name: 'Cloudflare Tunnel',
    category: 'Infrastructure',
    purpose: 'Secure webhook testing',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'optional',
  },

  // ── Automation ─────────────────────────────────────────────────────────
  {
    id: 'n8n',
    name: 'n8n Community Edition',
    category: 'Automation',
    purpose: 'Automation platform — source ingest & report workflows',
    cost: 'Free (self-hosted)',
    paid: false,
    owner: 'You',
    status: 'configured',
    endpoint: 'bext-n8n.srv1866850.hstgr.cloud',
    note: 'Source ingest + article analysis workflows deployed.',
    thisWeek: true,
  },

  // ── Data ───────────────────────────────────────────────────────────────
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    category: 'Data',
    purpose: 'Primary relational database (sources, reports, milestones)',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'configured',
    endpoint: 'VPS loopback :5432 (tunnel :5433)',
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'Data',
    purpose: 'Vector database for the AI knowledge base (RAG)',
    cost: 'Free (self-hosted)',
    paid: false,
    owner: 'You',
    status: 'configured',
    endpoint: 'VPS loopback :6333',
  },

  // ── AI ─────────────────────────────────────────────────────────────────
  {
    id: 'claude-code',
    name: 'Claude Code',
    category: 'AI',
    purpose: 'AI-assisted software development',
    cost: 'Subscription',
    paid: true,
    owner: 'You',
    status: 'configured',
  },
  {
    id: 'gemini-api',
    name: 'Gemini API',
    category: 'AI',
    purpose: 'AI model for article analysis & report generation',
    cost: 'Free tier',
    paid: false,
    owner: 'You',
    status: 'configured',
    note: 'Powers the article analysis workflow (Gemini Flash).',
  },

  // ── Microsoft ──────────────────────────────────────────────────────────
  {
    id: 'm365-tenant',
    name: 'Microsoft 365 tenant',
    category: 'Microsoft',
    purpose: 'Real tenant for Outlook, Teams, SharePoint & OneDrive development',
    cost: 'Trial → ~A$17/mo',
    paid: true,
    owner: 'You',
    status: 'pending',
    note:
      'The free Developer Sandbox is gone — Microsoft now requires a Visual Studio ' +
      'Professional or Enterprise annual subscription (~US$1,199/yr) to qualify. ' +
      'But this is no longer this week’s blocker: the app registration and Graph ' +
      'are free on a no-cost Entra tenant, and Brief A sends over SMTP. A licence ' +
      'is only needed for Brief B build — Teams transcripts and SharePoint — so it ' +
      'can wait until late August rather than burning a 30-day trial now.',
  },
  {
    id: 'azure-app-reg',
    name: 'Azure App Registration',
    category: 'Microsoft',
    purpose: 'OAuth authentication for Microsoft Graph',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'pending',
    note:
      'FREE and doable today — it does not need a paid tenant, only an Entra ' +
      'directory (creatable at no cost). Click-path and the nine required ' +
      'application permissions are in graph/app-registration.md; graph/verify.js ' +
      'runs the moment tenant/client/secret land. Doing this now proves the whole ' +
      'auth chain before any licence is bought.',
    thisWeek: true,
  },
  {
    id: 'ms-graph',
    name: 'Microsoft Graph API',
    category: 'Microsoft',
    purpose: 'Access Outlook, Teams, SharePoint & OneDrive (5am report delivery)',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'pending',
    note:
      'The API itself is free. What needs a licence is the data behind it: ' +
      'Mail.Send needs an Exchange mailbox, Sites.* needs SharePoint, ' +
      'OnlineMeetings.* needs Teams. Directory calls work on a free tenant. ' +
      'Brief A no longer depends on this at all — the 5am report sends over SMTP.',
  },
  {
    id: 'power-bi',
    name: 'Power BI Desktop',
    category: 'Microsoft',
    purpose: 'Dashboard and reporting development for Brief B',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'configured',
    note: 'Installed locally (2026-07 build). Pro is only needed if dashboards are shared through the cloud.',
  },
  {
    id: 'power-automate',
    name: 'Power Automate',
    category: 'Microsoft',
    purpose: 'Test Microsoft Power Automate flows for Brief B',
    cost: 'Included in M365',
    paid: false,
    owner: 'You',
    status: 'pending',
    note: 'Comes with the M365 tenant; the separate free developer environment is tied to the same retired program.',
  },

  // ── Development ────────────────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    category: 'Development',
    purpose: 'Source control & CI/CD (Bext-Main-patform)',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'configured',
    endpoint: 'github.com/gabrielbextconsultancy-hash/Bext-Main-patform',
    note: 'Repo created; push + GitHub Actions → cPanel deploy pipeline being wired.',
    thisWeek: true,
  },
  {
    id: 'vscode',
    name: 'VS Code',
    category: 'Development',
    purpose: 'Development IDE',
    cost: 'Free',
    paid: false,
    owner: 'You',
    status: 'configured',
  },
  {
    id: 'dashboard-app',
    name: 'BEXT Dashboard (this app)',
    category: 'Development',
    purpose: 'Management dashboard — connection health, timeline, plan',
    cost: 'Free (own build)',
    paid: false,
    owner: 'You',
    status: 'configured',
    endpoint: 'bext.dev-environment.site',
    note: 'Login + health + timeline pages; Next.js 16 on cPanel Node 22.',
    thisWeek: true,
  },
];

// ── Engagement plan (contracted dates from the briefs) ───────────────────

export interface PlanMilestone {
  engagement: 'daily_report' | 'business_structure';
  title: string;
  due: string; // ISO date
}

export const PLAN: PlanMilestone[] = [
  { engagement: 'daily_report', title: 'Draft / solution mapping', due: '2026-08-11' },
  { engagement: 'daily_report', title: 'Final — daily 5am AEST report live', due: '2026-08-18' },
  { engagement: 'business_structure', title: 'Draft plan', due: '2026-08-11' },
  { engagement: 'business_structure', title: 'Schematic architecture plan', due: '2026-08-25' },
  { engagement: 'business_structure', title: 'Final', due: '2026-09-08' },
];

/** What we are doing to accomplish each engagement — straight from the briefs. */
export interface EngagementPlan {
  engagement: 'daily_report' | 'business_structure' | 'infrastructure';
  title: string;
  goal: string;
  activities: string[];
}

export const ENGAGEMENT_WORK: EngagementPlan[] = [
  {
    engagement: 'infrastructure',
    title: 'Infrastructure — platform foundation',
    goal: 'Stand up the development environment everything else runs on.',
    activities: [
      'Hostinger VPS provisioned with Docker: n8n, PostgreSQL, Qdrant',
      'iFastNet cPanel subdomain bext.dev-environment.site as the dashboard host',
      'GitHub repo (Bext-Main-patform) with CI/CD pipeline to cPanel',
      'Management dashboard with login, connection health and timeline',
      'Headless-browser fetch service for the 15 sources that refuse plain HTTP',
      'Power BI Desktop installed for Brief B reporting',
      'Microsoft 365 tenant + Azure App Registration (blocked — free sandbox retired)',
    ],
  },
  {
    engagement: 'daily_report',
    title: 'A — Automated Daily Industry & Marketing Insight Summary',
    goal: 'One automated news sheet emailed every day at 5:00am AEST.',
    activities: [
      'Monitor 68 briefed sources (26 RSS, 29 scraped, 15 via headless browser) across Australian News, International Industry, Industry Updates, Grants / Funding, LinkedIn',
      'n8n source-ingest workflow pulling articles into PostgreSQL — running, 1,455 articles from 46 sources',
      'AI article analysis with Gemini 3.6 Flash — summarise, score relevance, tag',
      'Compose the daily consolidated summary sheet per the brief categories',
      'Deliver at 5am AEST daily — SMTP now, switching to Microsoft Graph once the tenant exists',
    ],
  },
  {
    engagement: 'business_structure',
    title: 'B — Business Process Optimisation & Automation',
    goal: 'AI-enabled operating model: capture once, automate admin, review-only workload.',
    activities: [
      'Comprehensive review of the current stack (ProjectManager, HubSpot, Xero, Microsoft Suite, Claude, Canva, WordPress, LinkedIn)',
      'Design the optimal digital operating model — single source of truth, minimal duplicated entry',
      'AI workflow design: meeting transcription & minutes (Teams), action items, email & report drafting',
      'Automated document creation, filing and project administration',
      'Schematic architecture plan, then final recommendation',
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

export const SETUP_LABEL: Record<SetupStatus, string> = {
  configured: 'Configured',
  in_progress: 'In progress',
  pending: 'Pending',
  optional: 'Optional',
};

export const CATEGORY_ORDER: ToolCategory[] = [
  'Hosting',
  'Infrastructure',
  'Automation',
  'Data',
  'AI',
  'Microsoft',
  'Development',
];

export const byCategory = () => {
  const map = new Map<ToolCategory, PlatformTool[]>();
  for (const c of CATEGORY_ORDER) map.set(c, []);
  for (const t of TOOLS) map.get(t.category)!.push(t);
  return map;
};

export const setupCounts = () => ({
  configured: TOOLS.filter(t => t.status === 'configured').length,
  in_progress: TOOLS.filter(t => t.status === 'in_progress').length,
  pending: TOOLS.filter(t => t.status === 'pending').length,
  optional: TOOLS.filter(t => t.status === 'optional').length,
  total: TOOLS.length,
});
