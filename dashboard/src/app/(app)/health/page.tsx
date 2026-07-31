import { TOOLS } from '@/lib/platform';
import { OPERATIONAL_IDS, runChecks, liveCounts } from '@/lib/health-checks';
import { Card, CostBadge, SetupPill, LivePill } from '@/components/ui';

export const metadata = { title: 'Connection Health — BEXT Platform' };
// Live probes run on every request (30s server-side cache inside runChecks).
export const dynamic = 'force-dynamic';

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

export default async function Health() {
  const checks = await runChecks();
  const live = liveCounts(checks);

  // Only the operational stack we actually run, in the defined order.
  const byId = new Map(TOOLS.map(t => [t.id, t]));
  const tools = OPERATIONAL_IDS.map(id => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  const checkedAt = Object.values(checks)[0]?.checkedAt;

  return (
    <div className="space-y-6">
      {/* Live summary strip */}
      <Card
        title="Connection health"
        subtitle="Live status of the operational BEXT stack — probed from the dashboard host."
      >
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <p className="text-2xl font-semibold tnum text-ok">{live.up}</p>
            <p className="text-xs text-ink-400">live</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tnum text-blocked">{live.down}</p>
            <p className="text-xs text-ink-400">down</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tnum text-ink-400">{live.unchecked}</p>
            <p className="text-xs text-ink-400">no probe</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-2xl font-semibold tnum">
              {live.up}
              <span className="text-ink-400">/{live.probed}</span>
            </p>
            <p className="text-xs text-ink-400">
              probed services up{checkedAt ? ` · checked ${ago(checkedAt)}` : ''}
            </p>
          </div>
        </div>
      </Card>

      {/* One card per operational tool: live status + config + setup state */}
      <Card
        title="Operational stack"
        subtitle="Each tool we run, its configuration, and both its live probe and setup status."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {tools.map(t => {
            const c = checks[t.id];
            return (
              <div key={t.id} className="rounded-lg border border-ink-800 bg-ink-950/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-ink-100">{t.name}</p>
                  {c && <LivePill live={c.live} />}
                </div>
                <p className="mt-1 text-xs text-ink-400">{t.purpose}</p>
                {t.endpoint && (
                  <p className="mt-2 truncate font-mono text-[11px] text-ink-300">{t.endpoint}</p>
                )}
                {c && (
                  <p className="mt-1.5 text-[11px] text-ink-400">
                    {c.detail}
                    {c.latencyMs != null && c.latencyMs > 0 ? ` · ${c.latencyMs}ms` : ''}
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <SetupPill status={t.status} />
                  <CostBadge cost={t.cost} paid={t.paid} />
                  <span className="text-[10px] text-ink-600">owner: {t.owner}</span>
                </div>
                {t.note && <p className="mt-2 text-[11px] text-ink-400">{t.note}</p>}
              </div>
            );
          })}
        </div>
      </Card>

      <p className="px-1 text-[11px] text-ink-600">
        Live probes: n8n, Gemini, GitHub and this app are pinged directly. Postgres and Qdrant
        run on the VPS loopback (no public port) so they show setup status only. Microsoft
        services are pending the tenant.
      </p>
    </div>
  );
}
