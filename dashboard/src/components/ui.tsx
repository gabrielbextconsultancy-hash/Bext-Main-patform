import type { ReactNode } from 'react';
import type { WorkStatus } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/types';
import type { SetupStatus } from '@/lib/platform';
import { SETUP_LABEL } from '@/lib/platform';

const STATUS_STYLE: Record<WorkStatus, string> = {
  done: 'bg-ok/12 text-ok ring-ok/25',
  in_progress: 'bg-progress/12 text-progress ring-progress/25',
  blocked: 'bg-blocked/12 text-blocked ring-blocked/25',
  not_started: 'bg-ink-800 text-ink-400 ring-ink-700',
};

export function StatusPill({ status }: { status: WorkStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const SETUP_STYLE: Record<SetupStatus, string> = {
  configured: 'bg-ok/12 text-ok ring-ok/25',
  in_progress: 'bg-progress/12 text-progress ring-progress/25',
  pending: 'bg-warn/12 text-warn ring-warn/25',
  optional: 'bg-ink-800 text-ink-400 ring-ink-700',
};

const SETUP_DOT: Record<SetupStatus, string> = {
  configured: 'bg-ok',
  in_progress: 'bg-progress',
  pending: 'bg-warn',
  optional: 'bg-ink-600',
};

export function SetupPill({ status }: { status: SetupStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${SETUP_STYLE[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${SETUP_DOT[status]}`} />
      {SETUP_LABEL[status]}
    </span>
  );
}

const LIVE_STYLE: Record<string, { ring: string; dot: string; label: string }> = {
  up: { ring: 'bg-ok/12 text-ok ring-ok/25', dot: 'bg-ok', label: 'Live' },
  down: { ring: 'bg-blocked/12 text-blocked ring-blocked/25', dot: 'bg-blocked', label: 'Down' },
  degraded: { ring: 'bg-warn/12 text-warn ring-warn/25', dot: 'bg-warn', label: 'Degraded' },
  unchecked: { ring: 'bg-ink-800 text-ink-400 ring-ink-700', dot: 'bg-ink-600', label: 'No probe' },
};

export function LivePill({ live }: { live: string }) {
  const s = LIVE_STYLE[live] ?? LIVE_STYLE.unchecked;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.ring}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${live === 'up' ? 'animate-pulse' : ''}`} />
      {s.label}
    </span>
  );
}

export function CostBadge({ cost, paid }: { cost: string; paid: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
        paid ? 'bg-brief-b/10 text-brief-b ring-brief-b/25' : 'bg-ink-800 text-ink-300 ring-ink-700'
      }`}
    >
      {cost}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-ink-800 bg-ink-900/60 p-5 ${className}`}
    >
      {title && (
        <header className="mb-4">
          <h2 className="text-sm font-semibold tracking-tight text-ink-100">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Progress ring. Size is fixed at 72px — it only ever appears in engagement cards. */
export function Ring({ value, accent }: { value: number; accent: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] -rotate-90">
      <circle cx="36" cy="36" r={r} fill="none" strokeWidth="7" className="stroke-ink-800" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        stroke={accent}
        strokeDasharray={c}
        strokeDashoffset={c - (c * value) / 100}
      />
      <text
        x="36"
        y="36"
        transform="rotate(90 36 36)"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-ink-100 tnum text-[17px] font-semibold"
      >
        {value}%
      </text>
    </svg>
  );
}

export function DatabaseDown() {
  return (
    <Card className="border-warn/30 bg-warn/5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-warn">&#9888;</span>
        <div className="text-sm">
          <p className="font-medium text-ink-100">Database unreachable</p>
          <p className="mt-1 text-ink-400">
            The dashboard reads Postgres on the VPS through an SSH tunnel. Open it with:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-950 p-3 text-xs text-ink-300">
            ssh -i ~/.ssh/pf-nfac-hostinger -L 5433:127.0.0.1:5432 root@187.127.213.243 -N
          </pre>
        </div>
      </div>
    </Card>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-400">{children}</p>;
}
