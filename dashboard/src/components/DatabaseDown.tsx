'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Shown when a page's data read came back empty because the database could not
 * be reached. Most of the time that is transient — a container restarting, a
 * connection pool settling after a deploy — so this recovers on its own: it
 * re-renders the page on a short interval and the notice disappears the moment
 * the read succeeds. The SSH-tunnel hint is for local development and is tucked
 * behind a details toggle rather than shown as if it were the fix in production.
 */
export function DatabaseDown() {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  useEffect(() => {
    // Back off gently: 3s, 3s, 6s, 12s, then hold at 20s, so a brief blip clears
    // fast while a longer outage does not hammer the server.
    const delay = [3000, 3000, 6000, 12000][tries] ?? 20000;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      router.refresh();
    }, delay);
    return () => clearTimeout(t);
  }, [tries, router]);

  return (
    <section className="rounded-xl border border-warn/30 bg-warn/5 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 animate-pulse text-warn">&#9888;</span>
        <div className="text-sm">
          <p className="font-medium text-ink-100">Reconnecting to the database…</p>
          <p className="mt-1 text-ink-400">
            The last read did not come through. This retries on its own and clears when the
            connection settles — you should not need to do anything.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
              Local development? Open the tunnel
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-950 p-3 text-xs text-ink-300">
              ssh -i ~/.ssh/pf-nfac-hostinger -L 5433:127.0.0.1:5432 root@187.127.213.243 -N
            </pre>
          </details>
        </div>
      </div>
    </section>
  );
}
