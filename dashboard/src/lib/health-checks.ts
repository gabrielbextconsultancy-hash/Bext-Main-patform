import 'server-only';

/**
 * Live connection probes for the operational stack. These run server-side on
 * the cPanel host and reflect real reachability, not hand-set status.
 *
 * Only services reachable from the dashboard host are probed. Postgres and
 * Qdrant live on the VPS loopback (no public port), so they cannot be pinged
 * from here — they fall back to their curated status in platform.ts, clearly
 * labelled as "not remotely checkable".
 */

export type Live = 'up' | 'down' | 'degraded' | 'unchecked';

export interface CheckResult {
  live: Live;
  detail: string;
  latencyMs: number | null;
  checkedAt: string;
}

/** The operational tools shown on Connection Health, in display order. */
export const OPERATIONAL_IDS = [
  'cpanel-subdomain',
  'dashboard-app',
  'hostinger-vps',
  'n8n',
  'postgresql',
  'qdrant',
  'gemini-api',
  'github',
  'm365-tenant',
  'azure-app-reg',
  'ms-graph',
];

async function timed(
  url: string,
  init: RequestInit = {},
  ms = 6000
): Promise<{ ok: boolean; status: number; latencyMs: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, redirect: 'manual' });
    return { ok: r.status < 400, status: r.status, latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

const up = (detail: string, latencyMs: number): CheckResult => ({
  live: 'up',
  detail,
  latencyMs,
  checkedAt: new Date().toISOString(),
});
const down = (detail: string): CheckResult => ({
  live: 'down',
  detail,
  latencyMs: null,
  checkedAt: new Date().toISOString(),
});

/** Probes keyed by tool id. A missing id => not network-probeable. */
const PROBES: Record<string, () => Promise<CheckResult>> = {
  // The dashboard itself — if this code runs, it is serving.
  'dashboard-app': async () => up('Serving requests', 0),
  'cpanel-subdomain': async () => up('Passenger app responding', 0),

  'n8n': async () => {
    const base = (process.env.N8N_URL || 'https://bext-n8n.srv1866850.hstgr.cloud').replace(
      /\/api\/v1\/?$/,
      ''
    );
    try {
      const r = await timed(`${base}/healthz`);
      return r.ok
        ? up(`healthz ${r.status}`, r.latencyMs)
        : down(`healthz returned ${r.status}`);
    } catch (e) {
      return down(`unreachable: ${(e as Error).name}`);
    }
  },

  'gemini-api': async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return down('GEMINI_API_KEY not set');
    try {
      const r = await timed(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      );
      if (r.status === 200) return up(`models ${r.status}`, r.latencyMs);
      if (r.status === 403 || r.status === 400) return down(`key rejected (${r.status})`);
      return down(`unexpected ${r.status}`);
    } catch (e) {
      return down(`unreachable: ${(e as Error).name}`);
    }
  },

  'github': async () => {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO || 'gabrielbextconsultancy-hash/Bext-Main-patform';
    try {
      const r = await timed(`https://api.github.com/repos/${repo}`, {
        headers: {
          'User-Agent': 'bext-dashboard',
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (r.status === 200) return up(`repo reachable (${r.latencyMs}ms)`, r.latencyMs);
      if (r.status === 401) return down('token invalid');
      if (r.status === 404) return down('repo not visible to token');
      return down(`status ${r.status}`);
    } catch (e) {
      return down(`unreachable: ${(e as Error).name}`);
    }
  },
};

const unchecked = (): CheckResult => ({
  live: 'unchecked',
  detail: 'Not remotely reachable from this host',
  latencyMs: null,
  checkedAt: new Date().toISOString(),
});

// Short in-memory cache so a page refresh doesn't hammer every endpoint.
let cache: { at: number; data: Record<string, CheckResult> } | null = null;
const TTL_MS = 30_000;

export async function runChecks(): Promise<Record<string, CheckResult>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const ids = Object.keys(PROBES);
  const settled = await Promise.allSettled(ids.map(id => PROBES[id]()));
  const data: Record<string, CheckResult> = {};
  ids.forEach((id, i) => {
    const r = settled[i];
    data[id] = r.status === 'fulfilled' ? r.value : down('probe threw');
  });
  for (const id of OPERATIONAL_IDS) if (!data[id]) data[id] = unchecked();

  cache = { at: Date.now(), data };
  return data;
}

export const liveCounts = (data: Record<string, CheckResult>) => {
  const vals = OPERATIONAL_IDS.map(id => data[id]?.live ?? 'unchecked');
  return {
    up: vals.filter(v => v === 'up').length,
    down: vals.filter(v => v === 'down').length,
    unchecked: vals.filter(v => v === 'unchecked').length,
    probed: vals.filter(v => v === 'up' || v === 'down').length,
  };
};
