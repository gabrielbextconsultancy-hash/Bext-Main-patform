import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Tomorrow's email, rendered before it exists.
 *
 * The Before card lists what is queued, but a list is not the deliverable — the
 * client receives a rendered sheet, and "what will they actually see" deserves
 * a real answer. This runs the deployed workflow's own SELECT and its own
 * Render HTML node code against live data, with the window moved forward one
 * day so it covers TODAY — the day the next 05:00 send will cover.
 *
 * Both pieces are read out of the built workflow JSON rather than copied here,
 * the same discipline as graph/preview-report.js and the R036 replay: a preview
 * that drifts from the sender is worse than none, because it is believed.
 */
export async function GET() {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const wfPath = path.join(process.cwd(), '..', 'n8n', 'workflows', 'BEXT-Daily-News-5-Daily-Report.json');
    const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
    const selectSql: string = wf.nodes.find((n: { name: string }) => n.name === 'Top articles, prior day').parameters.query;
    const renderCode: string = wf.nodes.find((n: { name: string }) => n.name === 'Render HTML').parameters.jsCode;

    // The deployed window covers yesterday (day_start = today - 1). The preview
    // covers today, which is what tomorrow's send will carry.
    const sql = selectSql.replace(
      /date_trunc\('day', now\(\) AT TIME ZONE 'Australia\/Melbourne'\)\s*-\s*interval '1 day' AS day_start/,
      "date_trunc('day', now() AT TIME ZONE 'Australia/Melbourne') AS day_start"
    );
    if (sql === selectSql) {
      return NextResponse.json({ error: 'window pattern not found in the deployed query — preview refused rather than rendered wrong' }, { status: 500 });
    }

    const rows = await query<Record<string, unknown>>(sql);
    if (!rows || rows.length === 0) {
      return NextResponse.json({ html: null, count: 0 });
    }

    const ORDER = ['Australian News', 'Industry Updates', 'International Industry Updates'];
    const byCat = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const c = String(r.category);
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(r);
    }
    const sections = ORDER.filter(n => byCat.has(n)).map(n => ({ name: n, items: byCat.get(n) }));

    const d = {
      sections, empty: false, item_count: rows.length,
      sources_monitored: rows[0].sources_monitored,
      audit_tally: rows[0].audit_tally ?? null,
      unscored_in_window: rows[0].unscored_in_window ?? 0,
      sources_contributing: new Set(rows.map(r => r.source_name)).size,
      intro: 'PREVIEW — this is how tomorrow’s 05:00 sheet looks right now. Articles still being scored tonight may join it; the intro will be written by Hermes at send time.',
      recipient: 'preview@dashboard',
      generated_by: 'preview',
    };

    // Execute the node's code with the shims n8n provides it.
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const $input = { first: () => ({ json: d }), all: () => [{ json: d }] };
    const $ = () => ({ first: () => ({ json: { deliverability: 'preview', deliverability_ok: true } }) });
    const fn = new AsyncFn('$input', '$', '$env', 'require', renderCode);
    const out = await fn($input, $, process.env, require);
    const html: string = (Array.isArray(out) ? out[0].json : out.json).html;

    return NextResponse.json({ html, count: rows.length });
  } catch (e) {
    return NextResponse.json(
      { error: 'preview failed: ' + String(e instanceof Error ? e.message : e).slice(0, 200) },
      { status: 500 }
    );
  }
}
