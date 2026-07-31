export const metadata = { title: 'Sign in — BEXT Platform' };

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
            BEXT Consultancy
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-100">
            Platform Management
          </h1>
        </div>

        <form
          method="POST"
          action="/api/login"
          className="space-y-4 rounded-xl border border-ink-800 bg-ink-900/60 p-6"
        >
          {error && (
            <p className="rounded-lg border border-blocked/30 bg-blocked/10 px-3 py-2 text-xs text-blocked">
              Invalid username or password.
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Username</span>
            <input
              name="username"
              autoComplete="username"
              required
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 outline-none focus:border-progress"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 outline-none focus:border-progress"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-progress/90 px-3 py-2 text-sm font-medium text-ink-950 transition hover:bg-progress"
          >
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-ink-600">
          bext.dev-environment.site
        </p>
      </div>
    </div>
  );
}
