'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/health', label: 'Connection Health', hint: 'Tools & configuration' },
  { href: '/timeline', label: 'Timeline & Plan', hint: 'Checklist, deadlines, work plan' },
  { href: '/overview', label: 'Overview', hint: 'Engagement progress (live DB)' },
  { href: '/deliverables', label: 'Deliverables', hint: 'Brief coverage (live DB)' },
  { href: '/sources', label: 'Sources', hint: 'News source pipeline (live DB)' },
];

// Served straight from public/proposal/, so it needs a plain anchor rather than
// a Link — and it sits apart in the nav because it is the client-facing artefact,
// not part of the management dashboard.
const CLIENT_FACING = [
  { href: '/proposal', label: 'Proposal', hint: 'Brief B draft plan — shareable deck' },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {NAV.map(n => {
        const active = pathname === n.href || pathname.startsWith(n.href + '/');
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`block rounded-lg px-3 py-2 transition ${
              active ? 'bg-ink-850 text-ink-100 ring-1 ring-inset ring-ink-700' : 'text-ink-300 hover:bg-ink-850/60 hover:text-ink-100'
            }`}
          >
            <span className="block text-sm font-medium">{n.label}</span>
            <span className="block text-[11px] text-ink-400">{n.hint}</span>
          </Link>
        );
      })}

      <div className="!mt-5 border-t border-ink-800 pt-4">
        <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
          Client deliverables
        </p>
        {CLIENT_FACING.map(n => (
          <a
            key={n.href}
            href={n.href}
            className="block rounded-lg px-3 py-2 text-ink-300 transition hover:bg-ink-850/60 hover:text-ink-100"
          >
            <span className="block text-sm font-medium">{n.label}</span>
            <span className="block text-[11px] text-ink-400">{n.hint}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
