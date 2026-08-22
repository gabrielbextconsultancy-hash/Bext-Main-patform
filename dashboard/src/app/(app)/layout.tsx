import { SideNav } from '@/components/SideNav';
import { PageHeader } from '@/components/PageHeader';

/**
 * The application shell.
 *
 * A fixed sidebar and a sticky header, with only the content column scrolling.
 * The alternative — scrolling the whole page — loses the navigation as soon as
 * you read past the fold, and these pages are long: the source registry alone
 * runs to seventy rows.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh bg-ink-950">
      {/* Sidebar. Fixed on desktop so navigation never scrolls away; on small
          screens it collapses to the header's own menu. */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-ink-800
                   bg-ink-900/60 backdrop-blur md:flex"
      >
        <div className="border-b border-ink-800 px-5 py-5">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-brief-a">
            BEXT Consultancy
          </p>
          <h1 className="mt-1 text-[15px] font-semibold tracking-tight text-ink-100">
            Platform Management
          </h1>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <SideNav />
        </div>

        <div className="border-t border-ink-800 px-5 py-4">
          <form method="POST" action="/api/logout">
            <button
              type="submit"
              className="rounded text-xs text-ink-400 transition hover:text-ink-100
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-a"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Content column. The left offset matches the sidebar width exactly. */}
      <div className="flex min-w-0 flex-1 flex-col md:pl-[248px]">
        <PageHeader />
        <main className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
        <footer className="border-t border-ink-800 px-5 py-5 text-xs text-ink-400 sm:px-8">
          <div className="mx-auto max-w-[1180px]">
            Dashboard on the Hostinger VPS behind traefik · automation stack (n8n, Postgres,
            Qdrant, Scrapling) alongside it · mail through iFastNet.
          </div>
        </footer>
      </div>
    </div>
  );
}
