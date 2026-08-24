import { getCycles, getReports, getReportArticles, type ReportArticleRow } from '@/lib/queries';
import { DatabaseDown } from '@/components/ui';
import { ContentHub } from '@/components/ContentHub';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Content generation hub. The daily news the pipeline produced, and the cycles
 * built from it. Reads only; every action the human takes here POSTs to n8n
 * through /api/content/action.
 */
export default async function ContentPage() {
  const [cycles, reports] = await Promise.all([getCycles(), getReports()]);

  if (cycles === null || reports === null) return <DatabaseDown />;

  // Preload the articles for the most recent reports, so the accordion opens
  // without a round trip. A fortnight of reports is a handful of rows each.
  const recent = reports.slice(0, 14).map((r) => r.id);
  const articles = recent.length ? await getReportArticles(recent) : [];
  const articlesByReport: Record<number, ReportArticleRow[]> = {};
  for (const a of articles ?? []) {
    (articlesByReport[a.report_id] ??= []).push(a);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">Content Generation</h1>
        <p className="mt-1 text-sm text-ink-400">
          A fortnight of industry news, turned into one LinkedIn post. You pick the topic, add the
          perspective, approve the draft. Nothing publishes on its own.
        </p>
      </header>

      <ContentHub cycles={cycles} reports={reports} articlesByReport={articlesByReport} />
    </div>
  );
}
