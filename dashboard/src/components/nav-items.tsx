import type { ReactNode } from 'react';

/**
 * One table for the navigation, read by both the sidebar and the header.
 *
 * Kept in its own module so a page cannot be labelled one way in the menu and
 * another at the top of the screen — they were separate strings before, and
 * drifting labels are the kind of small wrongness nobody files a bug about.
 */
export interface NavEntry {
  href: string;
  label: string;
  hint: string;
  /** Reads Postgres on every request. Shown as a badge rather than in the label. */
  live?: boolean;
  icon: ReactNode;
}

// Stroke icons at a single weight — mixing filled and outline at one level reads
// as carelessness, and emoji are font-dependent and cannot be themed.
const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden="true">
    {d}
  </svg>
);

export const LEAD: NavEntry[] = [
  {
    href: '/proposal',
    label: 'Proposal',
    hint: 'Business Structure Efficiency — draft plan',
    icon: icon(<><path d="M14 3v5h5" /><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7z" /><path d="M9 13h6M9 17h4" /></>),
  },
];

export const NAV: NavEntry[] = [
  {
    href: '/architecture',
    label: 'Architecture Map',
    hint: 'Workflow estate & data flow',
    live: true,
    icon: icon(<><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /><path d="M6 9v3a3 3 0 0 0 3 3h3m6-6v3a3 3 0 0 1-3 3h-3" /></>),
  },
  {
    href: '/health',
    label: 'Connection Health',
    hint: 'Tools & configuration',
    icon: icon(<><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>),
  },
  {
    href: '/timeline',
    label: 'Timeline & Plan',
    hint: 'Checklist, deadlines, work plan',
    icon: icon(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  },
  {
    href: '/overview',
    label: 'Overview',
    hint: 'Engagement progress',
    live: true,
    icon: icon(<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>),
  },
  {
    href: '/deliverables',
    label: 'Deliverables',
    hint: 'Brief coverage',
    live: true,
    icon: icon(<><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></>),
  },
  {
    href: '/sources',
    label: 'Sources',
    hint: 'News pipeline & retrieval routes',
    live: true,
    icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></>),
  },
  {
    href: '/audit',
    label: 'Day Audit',
    hint: 'Brief links → every article, sent or why not',
    live: true,
    icon: icon(<><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12l2 2 4-4" /></>),
  },
  {
    href: '/reports',
    label: 'Daily Report',
    hint: 'Send results, readiness & references',
    live: true,
    icon: icon(<><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h8M8 17h5" /></>),
  },
  {
    href: '/meetings',
    label: 'Meeting Report',
    hint: 'Pipeline & minutes',
    live: true,
    icon: icon(<><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>),
  },
  {
    href: '/content',
    label: 'Content Generation',
    hint: 'News → LinkedIn drafts → approval',
    live: true,
    icon: icon(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
  },
];

export const NAV_INDEX: NavEntry[] = [...LEAD, ...NAV];
