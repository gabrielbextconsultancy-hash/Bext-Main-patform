'use client';

import { useEffect, useState } from 'react';

/**
 * Hides or shows the fixed sidebar on desktop, and remembers the choice.
 *
 * The layout is a server component, so the collapse state lives on the <html>
 * element's data-nav attribute (set here) and the actual hiding is done in CSS
 * (globals.css). That keeps the server shell static while the toggle stays a
 * small client island. The preference is stored in localStorage so the sidebar
 * stays the way it was left across page loads.
 */
export function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);

  // Apply the stored preference on mount. A layout-effect-style flash is avoided
  // by also reading the value in an inline script (see layout head) if needed;
  // for an admin tool a brief settle is acceptable.
  useEffect(() => {
    const saved = localStorage.getItem('nav-collapsed') === '1';
    setCollapsed(saved);
    document.documentElement.dataset.nav = saved ? 'collapsed' : 'expanded';
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.nav = next ? 'collapsed' : 'expanded';
    localStorage.setItem('nav-collapsed', next ? '1' : '0');
  }

  return (
    <button
      onClick={toggle}
      aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
      title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
      className="fixed left-2 top-2 z-40 hidden h-8 w-8 items-center justify-center rounded-md
                 border border-ink-800 bg-ink-900/80 text-ink-400 backdrop-blur transition
                 hover:border-ink-700 hover:text-ink-100 md:flex"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
           strokeLinecap="round" strokeLinejoin="round" className="size-4">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        {collapsed
          ? <path d="M14 9l3 3-3 3" />   /* › show */
          : <path d="M17 9l-3 3 3 3" />  /* ‹ hide */}
      </svg>
    </button>
  );
}
