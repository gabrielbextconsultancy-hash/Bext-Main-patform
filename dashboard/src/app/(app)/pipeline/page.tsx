import { ReportsView, type ReportParams } from '../reports/page';
import { AuditView, type AuditParams } from '../audit/page';
import { SourcesView } from '../sources/page';
import { SourceReportButton } from '@/components/SourceReportButton';

/**
 * The news pipeline, on one page.
 *
 * Sources, the day audit and the daily report were three separate pages, and
 * answering an ordinary question meant visiting all three: a source stopped
 * producing (Sources), so an article never appeared (Day Audit), so the sheet
 * was short (Daily Report). One question, three navigations, and no way to hold
 * the three answers beside each other.
 *
 * They are tabs now, in the order the pipeline actually runs: what we watch,
 * what we gathered and what happened to it, what goes out. Each tab renders the
 * view exported by its original page rather than a copy, so the standalone
 * routes and this one cannot drift apart — the failure mode that produced R038,
 * where two implementations of the same decision quietly stopped agreeing.
 *
 * Server rendered with the tab in the URL, so a particular view stays linkable
 * and the browser's back button behaves. Each tab keeps its own query params
 * (the audit's day and filters, the report's before/after), which coexist here
 * because their names do not collide.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The management table leads, because it is the one view that answers the whole
// question: what was fetched, what it scored, which section it belongs to,
// whether it was read in full or only as a teaser, when it arrived, which route
// brought it, and what became of it. The other two are the same data widened
// (the report) or narrowed (sources).
const TABS = [
  { id: 'audit', label: 'Management table', hint: 'Every article, scored, sourced, and its fate' },
  { id: 'report', label: 'Daily report', hint: 'What goes out tomorrow, and what went' },
  { id: 'sources', label: 'Sources', hint: 'What we watch, and how' },
] as const;

type Params = ReportParams & AuditParams & { tab?: string };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const sp = await searchParams;
  const tab = TABS.some(t => t.id === sp.tab) ? sp.tab : 'audit';

  // Carry the current tab's own params across when switching tabs would
  // otherwise drop them — the audit's chosen day survives a trip to Sources.
  const link = (id: string) => {
    const p = new URLSearchParams();
    p.set('tab', id);
    if (id === 'audit') {
      for (const k of ['day', 'status', 'src', 'q', 'page', 'section', 'body', 'dated'] as const) {
        const v = sp[k];
        if (v) p.set(k, v);
      }
    }
    if (id === 'report' && sp.sheet) p.set('sheet', sp.sheet);
    return `/pipeline?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-100">News pipeline</h1>
          <p className="mt-1 text-sm text-ink-400">
            Sources feed the day audit; the day audit becomes the 05:00 report. Everything gathered
            today goes out tomorrow morning.
          </p>
        </div>
        {/* The stored daily fetch-audit PDFs — top right, as asked, on every tab. */}
        <SourceReportButton />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-ink-800 pb-3">
        {TABS.map(t => (
          <a
            key={t.id}
            href={link(t.id)}
            className={`rounded-lg border px-4 py-2 ${
              tab === t.id
                ? 'border-brief-a bg-brief-a/10'
                : 'border-ink-700 hover:border-ink-500'
            }`}
          >
            <span
              className={`block text-sm font-semibold ${
                tab === t.id ? 'text-brief-a' : 'text-ink-200'
              }`}
            >
              {t.label}
            </span>
            <span className="text-[11px] text-ink-500">{t.hint}</span>
          </a>
        ))}
      </div>

      {/* basePath stays a path; the tab travels as an extra param, so every link
          these views build lands back on the tab the reader is looking at. */}
      {tab === 'report' && <ReportsView sp={sp} basePath="/pipeline" extra={{ tab: 'report' }} />}
      {tab === 'audit' && <AuditView sp={sp} basePath="/pipeline" extra={{ tab: 'audit' }} />}
      {tab === 'sources' && (
        <SourcesView articlesHref={(id) => `/pipeline?tab=audit&src=${id}`} />
      )}
    </div>
  );
}
