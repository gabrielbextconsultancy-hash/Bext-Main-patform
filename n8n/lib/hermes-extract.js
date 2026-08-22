/**
 * Last-resort article extraction, using the Hermes model already on the VPS.
 *
 * Shared by the ingest workflow and the source-repair harness, so it is written
 * to be inlined into an n8n Code node: no require, no backticks, no dollar-brace.
 *
 * Why this exists. Thirty-one of the sixty-eight sources have no feed and are
 * parsed out of HTML, and the site-by-site guesswork in that parser quietly fails.
 * On 22 August the Clean Energy Council page carried 533 article links and the
 * parser returned two — both navigation. NABERS, Commercial Building Disclosure,
 * Victorian Energy Upgrades and DEECA have between zero and one article each,
 * having reported "ok" for months. Writing a bespoke reader per site is a
 * maintenance treadmill; the markup changes and the failure is silent.
 *
 * So when the ordinary parser comes back with nothing useful, the page is handed
 * to the model with the question a person would ask: which of these links are
 * news articles, and what are they called.
 *
 * What this CANNOT do, and must not be asked to: a page we are refused. DCCEEW
 * and the IEA return 403 to both plain HTTP and headless Chromium. No model reads
 * a page it cannot fetch — that needs a different route, not a cleverer parser.
 */

// Hermes 3 8B runs at roughly 7.5 tokens a second on this VPS, so the prompt has
// to be small. Candidates are pre-filtered and capped rather than sending markup.
const MAX_CANDIDATES = 60;
const MIN_TEXT = 18;

/** Anchors that could plausibly be articles, as {url, text}. */
const candidates = (html, baseUrl) => {
  const out = [];
  const seen = new Set();
  // The inner cap has to be generous. A modern card link wraps an image, a
  // category chip and a date in nested divs, and at 200 characters the lazy match
  // simply never reached the closing tag — Clean Energy Council yielded 8 links
  // out of 533, and premier.vic.gov.au yielded none at all from 125 KB.
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,4000}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (text.length < MIN_TEXT) continue;
    if (/^(#|mailto:|tel:|javascript:)/i.test(url)) continue;
    // Navigation, legal and social links are never the article.
    if (/\/(tag|category|author|search|login|privacy|terms|contact|about|subscribe)\b/i.test(url)) continue;
    if (/^(home|menu|search|login|sign in|subscribe|read more|learn more|view all|next|previous)$/i.test(text)) continue;
    try { url = new URL(url, baseUrl).toString(); } catch (e) { continue; }
    const key = url.split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, text: text.slice(0, 120) });
  }
  return out;
};

/**
 * Ask the model which candidates are real articles.
 *
 * http is the caller's request function — this.helpers.httpRequest inside n8n, or
 * a small wrapper elsewhere — so the module stays free of imports.
 */
const hermesExtract = async (opts) => {
  const html = opts.html || '';
  const baseUrl = opts.baseUrl || '';
  const http = opts.http;
  const model = opts.model || 'hermes3:8b';
  const url = opts.ollamaUrl || 'http://ollama:11434/api/generate';

  const all = candidates(html, baseUrl);
  if (!all.length) return { articles: [], considered: 0, reason: 'no candidate links in the page' };

  // Same-host links first: an index page is mostly its own articles, and the rest
  // is usually syndication and social.
  let host = '';
  try { host = new URL(baseUrl).host; } catch (e) { host = ''; }
  const ranked = all
    .filter(c => !host || c.url.indexOf(host) > -1)
    .slice(0, MAX_CANDIDATES);
  if (!ranked.length) return { articles: [], considered: all.length, reason: 'no same-host links' };

  const listing = ranked.map((c, i) => (i + 1) + '. ' + c.text + '  ->  ' + c.url).join('\n');

  const prompt = 'You are reading the news index of an Australian energy or building industry site.\n'
    + 'Below are the links on the page. Decide which are individual NEWS ARTICLES or MEDIA RELEASES.\n\n'
    + 'Include: news stories, media releases, announcements, articles with a headline.\n'
    + 'Exclude: navigation, section pages, report downloads, event listings, membership or\n'
    + 'contact pages, category indexes, and anything that is a heading rather than a story.\n\n'
    + 'Return ONLY a JSON array, no prose and no markdown fence, of the form\n'
    + '[{"n": <the number from the list>, "title": "<the headline, cleaned up>"}]\n'
    + 'If none of them are articles, return [].\n\n'
    + 'LINKS:\n' + listing + '\n';

  let text = '';
  try {
    const res = await http({
      method: 'POST', url: url, json: true, timeout: 180000,
      body: { model: model, stream: false, options: { temperature: 0.1, num_predict: 900 }, prompt: prompt },
    });
    text = String((res && res.response) || '');
  } catch (e) {
    return { articles: [], considered: ranked.length, reason: 'model unavailable: ' + String(e.message || e).slice(0, 80) };
  }

  // Small models wander outside the fence even when told not to.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return { articles: [], considered: ranked.length, reason: 'model returned no JSON array' };
  }
  let picked;
  try { picked = JSON.parse(text.slice(start, end + 1)); }
  catch (e) { return { articles: [], considered: ranked.length, reason: 'unparseable JSON from model' }; }
  if (!Array.isArray(picked)) return { articles: [], considered: ranked.length, reason: 'model did not return an array' };

  const articles = [];
  const used = new Set();
  for (const p of picked) {
    const n = Number(p && p.n);
    if (!n || n < 1 || n > ranked.length || used.has(n)) continue;
    used.add(n);
    const c = ranked[n - 1];
    const title = String((p && p.title) || c.text).replace(/\s+/g, ' ').trim();
    if (title.length < MIN_TEXT) continue;
    articles.push({ url: c.url, title: title.slice(0, 300) });
  }
  return { articles: articles, considered: ranked.length, reason: '' };
};

module.exports = { hermesExtract, candidates };
