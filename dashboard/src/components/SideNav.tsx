'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The proposal leads: it is the current client deliverable and the landing page.
// The management pages sit beneath it.
const LEAD = [
  { href: '/proposal', label: 'Proposal', hint: 'Business Structure Efficiency — draft plan' },
];

const NAV = [
  { href: '/health', label: 'Connection Health', hint: 'Tools & configuration' },
  { href: '/timeline', label: 'Timeline & Plan', hint: 'Checklist, deadlines, work plan' },
  { href: '/overview', label: 'Overview', hint: 'Engagement progress (live DB)' },
  { href: '/deliverables', label: 'Deliverables', hint: 'Brief coverage (live DB)' },
  { href: '/sources', label: 'Sources', hint: 'News source pipeline (live DB)' },
  { href: '/reports', label: 'Daily Report', hint: 'Send results & readiness (live DB)' },
];

function Item({
  href,
  label,
  hint,
  active,
}: {
  href: string;
  label: string;
  hint: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-2 transition ${
        active
          ? 'bg-ink-850 text-ink-100 ring-1 ring-inset ring-ink-700'
          : 'text-ink-300 hover:bg-ink-850/60 hover:text-ink-100'
      }`}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-[11px] text-ink-400">{hint}</span>
    </Link>
  );
}

export function SideNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="space-y-1">
      <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
        Client deliverable
      </p>
      {LEAD.map(n => (
        <Item key={n.href} {...n} active={isActive(n.href)} />
      ))}

      <div className="!mt-5 border-t border-ink-800 pt-4">
        <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
          Platform management
        </p>
        <div className="space-y-1">
          {NAV.map(n => (
            <Item key={n.href} {...n} active={isActive(n.href)} />
          ))}
        </div>
      </div>
    </nav>
  );
}
