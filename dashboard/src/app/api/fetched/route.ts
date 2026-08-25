import { getFetchListHtml } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Serves the day's full fetch list as a viewable HTML page.
 *
 * This is where the Teams card's "View more" button points. It is gated by a
 * token in the query string rather than the dashboard session cookie, on the same
 * trust model as the Teams webhook: the URL carries its own access, and the URL
 * only ever appears inside the private Daily report channel.
 *
 * The reason it is not the session cookie: the button opens in the Teams in-app
 * browser, which holds neither a dashboard session nor a Microsoft one, so a
 * cookie-gated page would show the login wall — the exact failure the SharePoint
 * link had. A token in the URL is the one thing that survives that browser.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const date = url.searchParams.get('date');

  const expected = process.env.FETCH_VIEW_TOKEN;
  if (!expected || token !== expected) {
    return new Response('Not authorised.', { status: 401, headers: { 'Content-Type': 'text/plain' } });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response('date=YYYY-MM-DD required.', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  const html = await getFetchListHtml(date);
  if (html === null) {
    return new Response('No fetch list stored for that date yet.', {
      status: 404, headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The list can change through the day as later runs store a fuller version.
      'Cache-Control': 'no-store',
    },
  });
}
