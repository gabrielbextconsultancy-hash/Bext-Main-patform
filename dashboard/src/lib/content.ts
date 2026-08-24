import 'server-only';

/**
 * The dashboard's write path.
 *
 * In production the dashboard reaches Postgres only through a SELECT-only proxy
 * (see db.ts), so every mutation a human makes is an authenticated POST to n8n,
 * which owns the write. Two endpoints:
 *
 *   callAction        the BEXT — Content Actions webhook: start a cycle, select a
 *                     topic, approve a draft, mark it published, and so on. Returns
 *                     the statement's RETURNING row.
 *   triggerGeneration the BEXT — Content Topics / Content Drafts webhook: a nudge
 *                     to process now rather than waiting out the 3-minute poll.
 *                     Fire-and-forget; a failed nudge only costs latency.
 *
 * Both carry the shared secret as the X-BEXT-Token header, matching the n8n
 * "BEXT Webhook Auth" credential. This module is server-only: the token never
 * reaches the browser.
 */

const BASE = (process.env.N8N_URL || 'https://bext-n8n.srv1866850.hstgr.cloud').replace(/\/+$/, '') + '/webhook';

// A header value must be Latin-1: a stray non-ASCII character (a leaked dotenv
// banner, a smart quote, a newline) makes fetch throw "Cannot convert argument
// to a ByteString" before the request is even sent. Trim, drop anything outside
// printable ASCII, and warn once rather than let one bad character take the whole
// write path down.
const rawToken = process.env.BEXT_WEBHOOK_TOKEN || '';
const TOKEN = rawToken.trim().replace(/[^\x21-\x7e]/g, '');
if (rawToken && TOKEN !== rawToken.trim()) {
  console.warn('BEXT_WEBHOOK_TOKEN contained non-ASCII characters; they were stripped for the header.');
}

export type ContentAction =
  | 'start_cycle'
  | 'set_perspective'
  | 'select_topic'
  | 'approve_draft'
  | 'reject_draft'
  | 'mark_published'
  | 'resolve_claim'
  | 'record_performance'
  | 'update_voice';

export interface ActionResult {
  ok: boolean;
  row?: { id?: number; status?: string } | null;
  error?: string;
}

async function post(path: string, body: unknown, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BEXT-Token': TOKEN },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/** Perform a whitelisted content action. The action name and its fields are the body. */
export async function callAction(
  action: ContentAction,
  fields: Record<string, unknown>
): Promise<ActionResult> {
  if (!TOKEN) return { ok: false, error: 'BEXT_WEBHOOK_TOKEN is not set; the write path is unconfigured.' };
  try {
    const res = await post('content-actions', { action, ...fields });
    if (!res.ok) return { ok: false, error: `content-actions ${res.status}` };
    // The webhook returns the Apply node output, which n8n wraps as an array of
    // items or a bare object depending on version; normalise to the first row.
    const data = (await res.json().catch(() => null)) as unknown;
    const row = Array.isArray(data) ? (data[0]?.json ?? data[0]) : (data as { json?: unknown } | null)?.json ?? data;
    return { ok: true, row: (row as { id?: number; status?: string }) ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'content-actions failed' };
  }
}

/**
 * Nudge a generation workflow to run now. 'topics' after starting a cycle,
 * 'drafts' after selecting a topic. Never throws: the 3-minute poll is the
 * backstop, so a failed nudge is a slower cycle, not a lost one.
 */
export async function triggerGeneration(kind: 'topics' | 'drafts', cycleId: number): Promise<void> {
  if (!TOKEN) return;
  const path = kind === 'topics' ? 'content-topics' : 'content-drafts';
  try {
    await post(path, { cycle_id: cycleId }, 8000);
  } catch {
    /* the poll will pick it up */
  }
}
