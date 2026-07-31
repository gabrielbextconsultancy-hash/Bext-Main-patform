/**
 * Standalone shell for the client-facing proposal.
 *
 * Deliberately outside the (app) group: that layout renders the Platform
 * Management sidebar and a Sign out link, and this page is public. A client
 * opening the link should see the proposal and nothing else — no admin
 * navigation, no hint that a dashboard exists behind it, and no UI implying
 * they are signed in.
 *
 * Reaching the dashboard is a separate journey: /login.
 */
export default function ProposalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto max-w-[1180px] px-6 py-8">
      <header className="mb-6 border-b border-ink-800 pb-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
          BEXT Consultancy
        </p>
        <p className="mt-1 text-lg font-semibold tracking-tight text-ink-100">
          Business Structure Efficiency
        </p>
      </header>

      {children}

      <footer className="mt-10 border-t border-ink-800 pt-5 text-[11px] text-ink-600">
        Prepared by BEXT Consultancy · Draft Plan, 11 August 2026 · responds to the project brief
        dated 28 July 2026.
      </footer>
    </div>
  );
}
