import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { callAction, triggerGeneration, type ContentAction } from '@/lib/content';

export const dynamic = 'force-dynamic';

// Only these actions may be invoked from the dashboard. The n8n router whitelists
// them again; this is the near-side half of the same gate, so an unknown action
// never leaves the browser's origin.
const ALLOWED: ContentAction[] = [
  'start_cycle', 'set_perspective', 'select_topic', 'approve_draft',
  'reject_draft', 'mark_published', 'resolve_claim', 'record_performance', 'update_voice',
];

/**
 * The dashboard's single write endpoint. Verifies the session, forwards a
 * whitelisted action to the n8n Content Actions webhook, and, for the two actions
 * that unblock a generation step, nudges that workflow to run now instead of
 * waiting out the poll.
 */
export async function POST(req: Request) {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { action?: string; [k: string]: unknown } | null;
  const action = body?.action as ContentAction | undefined;
  if (!action || !ALLOWED.includes(action)) {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  const result = await callAction(action, body!);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'action failed' }, { status: 502 });
  }

  // Unblock the next machine step immediately where there is one.
  const cycleId = Number(result.row?.id ?? body!.cycle_id);
  if (Number.isFinite(cycleId)) {
    if (action === 'start_cycle') await triggerGeneration('topics', cycleId);
    else if (action === 'select_topic') await triggerGeneration('drafts', Number(body!.cycle_id));
  }

  return NextResponse.json({ ok: true, row: result.row ?? null });
}
