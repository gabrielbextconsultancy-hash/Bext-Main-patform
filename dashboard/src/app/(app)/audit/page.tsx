import { getDayAudits, getDayAuditHtml } from '@/lib/queries';
import { Card, DatabaseDown, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * The day audit, live.
 *
 * The client kept asking the same question by hand — "you fetched N, the email
 * carried M, where did the rest go?" — and the answer was a PDF built on
 * request. This page is that answer standing: every article of a publication
 * day nested under the brief link it answers to, sent items marked with the
 * report that carried them, every absentee with its reason. Written by the
 * quality passes; the 23:00 run closes the day.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day } = await searchParams;
  const audits = await getDayAudits();
  if (audits === null) return <DatabaseDown />;
  if (!audits.length) {
    return (
      <Card title="Day audit">
        <Empty>No audits yet — the first is written by the next quality pass (06:00, 12:00 or 23:00).</Empty>
      </Card>
    );
  }

  const chosen = audits.find((a) => a.day === day) ?? audits[0];
  const html = await getDayAuditHtml(chosen.day);

  return (
    <div className="space-y-5">
      <Card title="Day audit — the brief, link by link">
        <p className="text-sm text-ink-300">
          Every article of the day under the brief link it answers to: sent items name the report
          that carried them, and every absentee carries its reason. Rebuilt each quality pass; the
          23:00 run leaves the finished version behind for the 05:00 email and the Teams card.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {audits.map((a) => (
            <a
              key={a.day}
              href={`/audit?day=${a.day}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                a.day === chosen.day
                  ? 'border-brief-a bg-brief-a/10 text-brief-a'
                  : 'border-ink-700 text-ink-300 hover:border-ink-500'
              }`}
            >
              {a.day}
              <span className="ml-2 text-ink-400">
                {a.tally.fetched} fetched · {a.tally.sent} sent · {a.tally.queued} queued
              </span>
            </a>
          ))}
        </div>
      </Card>

      <Card title={`Audit for ${chosen.day}`}>
        {/* The stored markup is produced by our own builder (n8n/lib/day-audit.js)
            from database fields it escapes itself; nothing user-authored reaches
            it unescaped. The style block scopes the document's classes. */}
        <style>{`
          .audit { color: #d1d5db; font-size: 13px; line-height: 1.5; }
          .audit h3 { font-size: 15px; font-weight: 700; color: #f3f4f6; margin: 18px 0 8px;
                      border-bottom: 2px solid #0f766e; padding-bottom: 3px; }
          .audit .tiles { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
          .audit .tile { flex: 1; min-width: 130px; border: 1px solid #374151; border-radius: 8px; padding: 8px 10px; }
          .audit .tile b { font-size: 18px; display: block; color: #f9fafb; }
          .audit .grp { margin: 12px 0 16px; }
          .audit .lk { font-size: 11px; color: #9ca3af; }
          .audit .lk a { color: #9ca3af; text-decoration: none; }
          .audit .gname { font-size: 13px; font-weight: 700; color: #f3f4f6; margin: 2px 0; }
          .audit .ok { color: #4ade80; } .audit .quiet { color: #fbbf24; } .audit .held { color: #9ca3af; }
          .audit table { width: 100%; border-collapse: collapse; margin: 4px 0 6px; }
          .audit th { text-align: left; font-size: 10px; text-transform: uppercase; color: #9ca3af;
                      border-bottom: 1px solid #374151; padding: 3px 6px; }
          .audit td { border-bottom: 1px solid #1f2937; padding: 4px 6px; vertical-align: top; }
          .audit .t a { color: #2dd4bf; text-decoration: none; font-weight: 600; }
          .audit .u { color: #6b7280; font-size: 10px; }
          .audit .chip { display: inline-block; font: 700 10px/1 sans-serif; padding: 3px 7px; border-radius: 9px; }
          .audit .green { color: #166534; background: #dcfce7; }
          .audit .teal { color: #0f766e; background: #ccfbf1; }
          .audit .amber { color: #854d0e; background: #fef9c3; }
          .audit .grey { color: #4b5563; background: #e5e7eb; }
          .audit .disp { display: inline-block; font: 700 10px/1 sans-serif; padding: 2px 7px; border-radius: 9px; }
        `}</style>
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <Empty>The audit body for this day is missing.</Empty>
        )}
      </Card>
    </div>
  );
}
