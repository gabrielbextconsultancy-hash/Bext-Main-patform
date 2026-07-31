import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'BEXT Consultancy — Automation Platform',
  description: 'Engagement timeline, deliverable coverage and pipeline health.',
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/timeline', label: 'Timeline' },
  { href: '/deliverables', label: 'Deliverables' },
  { href: '/sources', label: 'Sources' },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body className="min-h-screen">
        <div className="mx-auto max-w-[1180px] px-6 py-8">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-ink-800 pb-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
                BEXT Consultancy
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">Automation Platform</h1>
            </div>
            <nav className="flex flex-wrap gap-1">
              {NAV.map(n => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-lg px-3 py-1.5 text-sm text-ink-300 transition hover:bg-ink-850 hover:text-ink-100"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </header>
          {children}
          <footer className="mt-12 border-t border-ink-800 pt-5 text-xs text-ink-400">
            Reads live from the BEXT Postgres database. Milestones and deliverables are
            transcribed from the two signed project briefs.
          </footer>
        </div>
      </body>
    </html>
  );
}
