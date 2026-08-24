import Link from 'next/link';
import { getCycle, getCycleTopics, getCycleDrafts } from '@/lib/queries';
import { DatabaseDown, Empty } from '@/components/ui';
import { CycleWorkspace } from '@/components/CycleWorkspace';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * One cycle's workspace. The workspace component decides which screen to show
 * from the cycle's status, so a human always lands on the step that is theirs.
 */
export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cycleId = Number(id);
  if (!Number.isFinite(cycleId)) return <Empty>Not a valid cycle.</Empty>;

  const [cycle, topics, drafts] = await Promise.all([
    getCycle(cycleId),
    getCycleTopics(cycleId),
    getCycleDrafts(cycleId),
  ]);

  // topics/drafts are null only when the database is unreachable; an unknown
  // cycle comes back as an empty list. getCycle collapses both to null, so the
  // list queries are what tell the two cases apart.
  if (topics === null || drafts === null) return <DatabaseDown />;

  return (
    <div className="space-y-4">
      <Link href="/content" className="text-xs text-ink-500 transition hover:text-ink-300">← Content Generation</Link>
      {!cycle ? (
        <Empty>That cycle does not exist.</Empty>
      ) : (
        <CycleWorkspace cycle={cycle} topics={topics} drafts={drafts} />
      )}
    </div>
  );
}
