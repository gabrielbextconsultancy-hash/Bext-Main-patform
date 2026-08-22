'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LEAD, NAV, type NavEntry } from './nav-items';

function Item({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <Link
      href={entry.href}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-a ${
        active
          ? 'bg-ink-850 text-ink-100'
          : 'text-ink-300 hover:bg-ink-850/60 hover:text-ink-100'
      }`}
    >
      {/* The active marker is a bar as well as a background, so the current page
          is identifiable without relying on a colour difference alone. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-1.5 left-0 w-[3px] rounded-full transition ${
          active ? 'bg-brief-a' : 'bg-transparent'
        }`}
      />
      <span className={`mt-px shrink-0 ${active ? 'text-brief-a' : 'text-ink-400 group-hover:text-ink-300'}`}>
        {entry.icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium leading-5">{entry.label}</span>
        <span className="block truncate text-[11px] leading-4 text-ink-400">{entry.hint}</span>
      </span>
    </Link>
  );
}

export function SideNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="space-y-1" aria-label="Primary">
      <p className="mb-1.5 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-400">
        Client deliverable
      </p>
      {LEAD.map(n => <Item key={n.href} entry={n} active={isActive(n.href)} />)}

      <div className="!mt-6 border-t border-ink-800 pt-4">
        <p className="mb-1.5 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-400">
          Platform management
        </p>
        <div className="space-y-1">
          {NAV.map(n => <Item key={n.href} entry={n} active={isActive(n.href)} />)}
        </div>
      </div>
    </nav>
  );
}
