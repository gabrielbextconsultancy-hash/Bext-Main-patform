import { getCycles, getReports } from '@/lib/queries';
import { DatabaseDown } from '@/components/ui';
import { ContentHub } from '@/components/ContentHub';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Content generation hub. The daily news the pipeline produced, and the cycles
 * built from it. Reads only; every action the human takes here POSTs to n8n
 * through /api/content/action. Report articles load on demand (see ContentHub),
 * so the list can be paged without pulling every report's items up front.
 */
export default async function ContentPage() {
  const [cycles, reports] = await Promise.all([getCycles(), getReports()]);

  if (cycles === null || reports === null) return <DatabaseDown />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">Content Generation</h1>
        <p className="mt-1 text-sm text-ink-400">
          A fortnight of industry news, turned into one LinkedIn post. You pick the topic, add the
          perspective, approve the draft. Nothing publishes on its own.
        </p>
      </header>

      <ContentHub cycles={cycles} reports={reports} />
    </div>
  );
}
