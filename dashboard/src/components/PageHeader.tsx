'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { SideNav } from './SideNav';
import { NAV_INDEX } from './nav-items';

/**
 * Sticky header: says where you are, and on small screens carries the navigation
 * that the sidebar cannot.
 *
 * The title comes from the same table the sidebar reads, so a page cannot end up
 * named one thing in the menu and another at the top of the screen.
 */
export function PageHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const entry = NAV_INDEX.find(
    n => pathname === n.href || pathname.startsWith(n.href + '/')
  );

  return (
    <header
      className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/85 px-5 py-4
                 backdrop-blur sm:px-8"
    >
      <div className="mx-auto flex max-w-[1180px] items-center gap-4">
        {/* Menu toggle, small screens only. 44px target. */}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          className="-ml-2 grid size-11 shrink-0 place-items-center rounded-lg text-ink-300
                     transition hover:bg-ink-850 hover:text-ink-100 focus-visible:outline-2
                     focus-visible:outline-offset-2 focus-visible:outline-brief-a md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-5">
            {open
              ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              : <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />}
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink-100">
            {entry?.label ?? 'Platform Management'}
          </h2>
          {entry?.hint && (
            <p className="truncate text-[11px] text-ink-400">{entry.hint}</p>
          )}
        </div>

        {/* Live-data pages read Postgres on every request; saying so once here is
            more honest than repeating "(live DB)" in the menu label. */}
        {entry?.live && (
          <span
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-ink-700
                       px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-300 sm:inline-flex"
            title="Read from Postgres on every request — no cache"
          >
            <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />
            Live
          </span>
        )}

        <Link
          href="/proposal"
          className="hidden shrink-0 rounded-lg border border-ink-700 px-3 py-2 text-xs
                     text-ink-300 transition hover:border-ink-600 hover:text-ink-100
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-a sm:block"
        >
          Client proposal
        </Link>
      </div>

      {open && (
        <div className="mx-auto mt-4 max-w-[1180px] border-t border-ink-800 pt-4 md:hidden">
          <div onClick={() => setOpen(false)}>
            <SideNav />
          </div>
        </div>
      )}
    </header>
  );
}
