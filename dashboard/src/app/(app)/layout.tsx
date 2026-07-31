import { SideNav } from '@/components/SideNav';

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1280px]">
      {/* Sidebar */}
      <aside className="hidden w-[240px] shrink-0 border-r border-ink-800 px-4 py-8 md:block">
        <div className="mb-8 px-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
            BEXT Consultancy
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink-100">
            Platform Management
          </h1>
        </div>
        <SideNav />
        <form method="POST" action="/api/logout" className="mt-8 px-3">
          <button
            type="submit"
            className="text-xs text-ink-400 underline-offset-2 transition hover:text-ink-100 hover:underline"
          >
            Sign out
          </button>
        </form>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1 px-6 py-8">
        {/* Mobile nav fallback */}
        <div className="mb-6 md:hidden">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
            BEXT Consultancy — Platform Management
          </p>
          <div className="mt-3">
            <SideNav />
          </div>
        </div>
        {children}
        <footer className="mt-12 border-t border-ink-800 pt-5 text-xs text-ink-400">
          bext.dev-environment.site — dashboard host on iFastNet cPanel; automation stack (n8n)
          on the Hostinger VPS.
        </footer>
      </div>
    </div>
  );
}
