/**
 * Article extraction shared by the n8n Source Ingest workflow and the dry-run
 * script. Pure functions with no n8n dependency so they can be tested directly
 * and pasted into a Code node.
 *
 * Two paths:
 *   parseFeed(xml)      — RSS 2.0, Atom and RDF, which is what the 37 feed
 *                         sources between them emit
 *   parseIndex(html,..) — heuristic article discovery for the sources with no
 *                         feed, scored rather than driven by per-site selectors
 *                         because 31 hand-written selector sets would rot faster
 *                         than they could be maintained
 */
const crypto = require('crypto');

// ─── Feeds ───────────────────────────────────────────────────────────────────

const strip = s =>
  (s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, ent => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
      const key = ent.slice(1, -1);
      if (named[key]) return named[key];
      if (key[0] === '#') {
        const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : null;
};

/** Atom puts the URL in an attribute, RSS in element text. */
function entryLink(block) {
  const alt = block.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return alt[1];
  const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (href) return href[1];
  const text = tag(block, 'link');
  if (text) return text;
  // Some feeds only carry a permalink guid.
  const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
  if (guid && /^https?:\/\//.test(strip(guid[1]))) return strip(guid[1]);
  return null;
}

function parseDate(raw) {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * The publication date carried in the URL itself.
 *
 * Seven sources in ten publish no machine-readable date, so the pipeline fell
 * back to fetch time. Ingest runs hourly, so a story published late in the
 * evening was first seen after midnight and got stamped the following day —
 * which put it in the wrong morning's report and made it look as though it had
 * never been fetched at all. That was the single largest cause of the "you are
 * missing yesterday's articles" complaints.
 *
 * Most publishers put the date in the path even when they omit it from the
 * markup. Reading it there is exact, free, and needs no extra request.
 *
 *   /news/2026-08-24/slug        ABC
 *   /2026/08/24/slug             WordPress and most trade press
 *   /082426-slug                 S&P Global (MMDDYY)
 *
 * Returns null when the path carries no date, and never guesses: a wrong date is
 * worse than no date, because no date still falls back to fetch time.
 */
function dateFromUrl(url) {
  let path;
  try { path = new URL(url).pathname; } catch { return null; }

  const iso = path.match(/\/(20\d{2})[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])(?=[\/-]|$)/);
  if (iso) return isoDate(+iso[1], +iso[2], +iso[3]);

  // MMDDYY immediately before a slug, as S&P Global writes it. Anchored to a
  // path segment so an arbitrary six-digit article id cannot masquerade as one.
  const mdy = path.match(/\/(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(\d{2})-[a-z]/i);
  if (mdy) return isoDate(2000 + +mdy[3], +mdy[1], +mdy[2]);

  return null;
}

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // Reject a date the calendar rolled over (31 February) and anything in the
  // future, which means the pattern matched something that was not a date.
  if (dt.getUTCMonth() !== m - 1 || dt.getTime() > Date.now() + 864e5) return null;
  return dt.toISOString();
}

function parseFeed(xml, baseUrl) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  const out = [];
  for (const [, , block] of blocks) {
    const link = entryLink(block);
    const title = tag(block, 'title');
    if (!link || !title) continue;
    out.push({
      url: absolute(link, baseUrl),
      title,
      author: tag(block, 'dc:creator') ?? tag(block, 'author') ?? null,
      published_at:
        parseDate(tag(block, 'pubDate')) ??
        parseDate(tag(block, 'published')) ??
        parseDate(tag(block, 'updated')) ??
        parseDate(tag(block, 'dc:date')),
      summary_raw:
        tag(block, 'description') ?? tag(block, 'summary') ?? tag(block, 'content') ?? null,
    });
  }
  return out;
}

// ─── HTML indexes ────────────────────────────────────────────────────────────

function absolute(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

// Paths that are navigation, not articles.
/**
 * Site furniture comes in two shapes, and treating them alike rejected real
 * articles.
 *
 * A listing PREFIX — /tag/…, /category/… — makes everything beneath it a listing.
 * A standalone PAGE — /about, /contact — is furniture only when it is the page
 * itself. The old single pattern matched either anywhere in the path, so
 * dcceew.gov.au/about/news/grants-support-first-nations-clean-energy-projects was
 * discarded because "about" appeared in it. Every DCCEEW article lives under
 * /about/news/, so the entire source had been silently dropping every story since
 * it was added, while reporting a healthy fetch.
 */
const CHROME_PREFIX = /^(tag|tags|category|categories|author|page|search|feed|rss|wp-|cdn-cgi|amp)$/i;
const CHROME_PAGE = /^(login|signin|subscribe|contact|about|privacy|terms|sitemap|disclaimer|copyright|accessibility)([-_].*)?$/i;

/** True when the path is navigation rather than a story. */
function isChrome(path) {
  const segs = path.split('/').filter(Boolean);
  if (!segs.length) return true;
  // A listing prefix governs everything under it.
  if (CHROME_PREFIX.test(segs[0])) return true;
  // A standalone page is furniture only when nothing follows it — /about is the
  // About page, /about/news/some-story is a story filed beneath it.
  if (CHROME_PAGE.test(segs[segs.length - 1])) return true;
  return false;
}
const ASSET = /\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)/i;

/**
 * Article links on a news index share a URL shape — most sites put a date or a
 * long slug in the path. Scoring on those signals finds articles across sites
 * that share no markup, which is the whole point: 31 sources, no two the same.
 */
function scoreLink(url, text, origin) {
  let score = 0;
  let path;
  try {
    const u = new URL(url);
    if (u.origin !== origin) return -1; // off-site
    path = u.pathname;
  } catch {
    return -1;
  }
  if (isChrome(path) || ASSET.test(path)) return -1;
  if (path === '/' || path.length < 12) return -1;

  if (/\/\d{4}\/\d{1,2}\//.test(path)) score += 4; // /2026/07/
  if (/\/\d{4}-\d{2}-\d{2}/.test(path)) score += 4;
  if (/-.*-.*-/.test(path)) score += 3; // multi-word slug
  score += Math.min(path.split('/').filter(Boolean).length, 4);

  const words = text.trim().split(/\s+/).length;
  if (words >= 4) score += 3;
  if (words >= 7) score += 2;
  if (words > 40) score -= 4; // whole paragraph scraped as link text
  if (text.trim().length < 15) score -= 3;

  return score;
}

/**
 * Anchor text that describes the act of clicking rather than the story behind it.
 * Common on card layouts, where the headline is a heading element and the link
 * is a button beneath it.
 */
const GENERIC = /^(find out more|read (more|on|the (full )?(story|article|report))|learn more|more( info(rmation)?| details)?|view( (more|all|article|details))?|see more|click here|continue reading|full (story|article|report)|download( the)?( report| pdf)?|open|details)\.?$/i;

/**
 * Some sites render the bare URL as the anchor text (AIDC does this for every
 * media release). Rebuilding a headline from the slug beats discarding the link.
 */
function titleFromSlug(url) {
  try {
    const last = new URL(url).pathname.replace(/\/+$/, '').split('/').pop() ?? '';
    const words = decodeURIComponent(last)
      .replace(/\.\w{2,5}$/, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    if (words.split(/\s+/).length < 3) return null;
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return null;
  }
}

/**
 * A sitemap, read as a news feed.
 *
 * Some publishers render their article lists entirely client-side, so the
 * listing page arrives as an empty shell and the headless browser is refused
 * outright. S&P Global is both: Scrapling gets 200 with no article links,
 * Chromium gets a 403 from the edge. Neither tier can work, and four articles
 * the client asked about on 25 Aug 2026 were missed that way.
 *
 * Their sitemaps are plain XML, served without the block, and carry <lastmod>
 * — which is a real publication date, better than anything the listing offered.
 *
 * Only recent entries are kept. A sitemap lists the whole archive (19,281 URLs
 * for one S&P section), and importing that wholesale is precisely the bulk
 * unlock that put 2022 articles into a 2026 report once already.
 */
/**
 * The publication date, read from the article page itself.
 *
 * The listing parser never opened an article, so seven sources in ten produced
 * no date at all and the pipeline dated them by when it happened to look. One
 * article in three then landed in the wrong day. The date is almost always in
 * the page's own metadata; this reads it.
 *
 * Ordered by how much the publisher meant it. article:published_time is a
 * declaration; a bare <time datetime> may be any date on the page, so it is
 * tried late, and the path date later still.
 *
 * Returns null rather than guessing. A wrong date is worse than no date: no
 * date is visible as pending and gets retried, a wrong one silently files the
 * story under the wrong day, which is the fault being fixed.
 */
function publishedFromHtml(html, url) {
  if (!html) return dateFromUrl(url || '');
  const patterns = [
    /property=["']article:published_time["'][^>]*content=["']([^"']+)/i,
    /content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
    /name=["'](?:pubdate|publish-date|date|DC\.date\.issued|dcterms\.date)["'][^>]*content=["']([^"']+)/i,
    /content=["']([^"']+)["'][^>]*name=["'](?:pubdate|publish-date|date|DC\.date\.issued)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /itemprop=["']datePublished["'][^>]*(?:content|datetime)=["']([^"']+)/i,
    /<time[^>]*datetime=["']([^"']+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const t = Date.parse(m[1]);
    // Reject the epoch-ish and the future. Templates render placeholder dates,
    // and a 1970 or a next-year stamp is a parse artefact, not a publication.
    if (Number.isFinite(t) && t > Date.parse('2000-01-01') && t < Date.now() + 864e5) {
      return new Date(t).toISOString();
    }
  }
  return dateFromUrl(url || '');
}

/**
 * Does this page look like an article rather than a section index?
 *
 * The link scraper captures whatever the listing links to, which includes
 * landing pages: industry.gov.au/future-made-in-australia arrived as an
 * "article" and would never date, because it is not one. og:type is the
 * publisher's own answer where they give it.
 *
 * Deliberately conservative — it only reports what the page says about itself,
 * and the caller decides. Guessing "not an article" wrongly loses real news.
 */
function looksLikeArticle(html) {
  if (!html) return null;
  const og = (html.match(/property=["']og:type["'][^>]*content=["']([^"']+)/i) || [])[1];
  if (og) return /article|news/i.test(og);
  if (/"@type"\s*:\s*"(?:News|Blog)?Article"/i.test(html)) return true;
  return null;
}

/**
 * The article's own text, pulled from its page.
 *
 * The feed excerpt averages three hundred characters and often ends in "The
 * post ... appeared first on", so the scorer was judging relevance from a
 * headline and two sentences. This reads the body: the paragraphs inside the
 * article element where the publisher marks one, otherwise the densest block
 * of paragraphs on the page, which is what an article page is.
 *
 * Deliberately simple and defensive. It runs inside a Code node against pages
 * whose markup we do not control, so it must never throw and never return
 * navigation furniture: a result under 200 characters is treated as no result
 * rather than shipped as content.
 */
function extractBody(html) {
  if (!html) return null;
  var doc = String(html);

  // Scripts, styles and templates carry text that is not prose.
  doc = doc.replace(/<script[\s\S]*?<\/script>/gi, ' ')
           .replace(/<style[\s\S]*?<\/style>/gi, ' ')
           .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
           .replace(/<!--[\s\S]*?-->/g, ' ');

  // Prefer the region the publisher marked as the article.
  var region = null;
  var m = doc.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (m && m[1] && m[1].length > 400) region = m[1];
  if (!region) {
    m = doc.match(/<div[^>]+class=["'][^"']*(?:entry-content|article-body|post-content|story-body|articleBody)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer|<aside)/i);
    if (m && m[1] && m[1].length > 400) region = m[1];
  }
  if (!region) region = doc;

  // Paragraphs are where prose lives. Headings are kept as sentence breaks so
  // a subheading does not weld two paragraphs into one run-on line.
  var parts = [];
  var re = /<(p|h2|h3|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  var hit;
  while ((hit = re.exec(region)) !== null) {
    var text = strip(hit[2]);
    if (!text) continue;
    // Boilerplate that appears inside paragraph tags on nearly every site.
    if (/^(share|tweet|advertisement|related|read more|sign up|subscribe|follow us)\b/i.test(text)) continue;
    if (text.length < 40) continue;
    parts.push(text);
    if (parts.join(' ').length > 12000) break;
  }

  var body = parts.join('\n\n').replace(/\s+\n/g, '\n').trim();
  // WordPress appends this to syndicated copy; it is the feed talking, not the
  // article, and leaving it in taught the scorer to read boilerplate.
  body = body.replace(/The post .{0,120}appeared first on .{0,80}?\.?\s*$/i, '').trim();
  if (body.length < 200) return null;
  return body.slice(0, 12000);
}

/**
 * Markdown [headline](url) pairs, as plain anchors parseIndex can read.
 *
 * Firecrawl's html capture can be the pre-hydration shell even when the render
 * succeeded — observed on vic-premier: three anchors in the html, nine media
 * releases in the markdown. The markdown is built from the finished DOM, so its
 * link pairs are the ground truth for client-rendered listings.
 *
 * Lives here rather than in the workflow builder because this file is
 * interpolated as a value, which keeps regex escapes intact; the same regex
 * written inline in the builder's template literal was cooked into an invalid
 * pattern and failed to parse at all.
 */
function anchorsFromMarkdown(md) {
  const out = [];
  const re = /\[([^\]]{10,200})\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = re.exec(String(md || ''))) !== null) {
    const title = m[1].replace(/\s+/g, ' ').trim();
    out.push('<a href="' + m[2] + '">' + title + '</a>');
  }
  return out.join('\n');
}

function parseSitemap(xml, baseUrl, { maxAgeDays = 3, limit = 60 } = {}) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  const out = [];

  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const block = m[1];
    const loc = (block.match(/<loc>([^<]+)<\/loc>/i) || [])[1];
    if (!loc) continue;
    const lastmod = (block.match(/<lastmod>([^<]+)<\/lastmod>/i) || [])[1];

    // Prefer the date in the URL — it is the publication date. lastmod moves
    // when a page is merely re-rendered, so it is the fallback, not the source.
    const published = dateFromUrl(loc) || parseDate(lastmod);
    if (!published || Date.parse(published) < cutoff) continue;

    // The slug leads with the date on these sites, which is not part of the
    // headline: "082426 india ceo series bp sees..." reads as noise.
    let title = titleFromSlug(loc);
    if (title) title = title.replace(/^\d{6}\s+/, '').replace(/^\d{4}[- ]\d{2}[- ]\d{2}\s+/, '');
    if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
    if (!title || title.split(/\s+/).length < 3) continue;

    out.push({ url: absolute(loc, baseUrl), title, author: null, published_at: published, summary_raw: null });
  }

  return out
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, limit);
}

function parseIndex(html, pageUrl, { minScore = 6, limit = 40 } = {}) {
  const origin = new URL(pageUrl).origin;
  const seen = new Map();

  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absolute(m[1], pageUrl);
    let title = strip(m[2]);
    // Anchor text that is just the href carries no information — the slug does.
    // Nor does a call to action: the Clean Energy Council links every story with
    // "Find out more", which is thirteen characters, so it escaped the old
    // length test, survived as the title, and then scored 2 against a floor of 6
    // — three words, under fifteen characters. Every CEC article was discarded
    // that way while the fetch reported success.
    if (!title || /^https?:\/\//i.test(title) || title.length < 12 || GENERIC.test(title)) {
      title = titleFromSlug(url) ?? title;
    }
    if (!title) continue;
    const score = scoreLink(url, title, origin);
    if (score < minScore) continue;
    // Same URL can appear as image link and headline link; keep the better title.
    const prev = seen.get(url);
    if (!prev || title.length > prev.title.length) {
      // Date from the path where the publisher put one there. Without this the
      // article inherits fetch time and can drift into the next day's report.
      seen.set(url, {
        url, title, author: null,
        published_at: dateFromUrl(url),
        summary_raw: null, _score: score,
      });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest);
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * Hash of the normalised title plus the opening of the body. The same story is
 * syndicated across AEMO, RenewEconomy and the trade press under different URLs,
 * so URL identity alone will not deduplicate the sheet.
 */
function contentHash(article) {
  const basis = [
    (article.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    (article.summary_raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 300),
  ].join(' | ');
  return crypto.createHash('sha256').update(basis).digest('hex');
}

/** Applies the per-source filters declared in sources/registry.yaml. */
function passesFilter(article, filter) {
  if (!filter) return true;
  if (filter.path_contains?.length) {
    const path = (() => {
      try {
        return new URL(article.url).pathname;
      } catch {
        return article.url;
      }
    })();
    if (!filter.path_contains.some(p => path.includes(p))) return false;
  }
  if (filter.keywords?.length) {
    const hay = `${article.title} ${article.summary_raw ?? ''}`.toLowerCase();
    if (!filter.keywords.some(k => hay.includes(k.toLowerCase()))) return false;
  }
  if (filter.author && article.author) {
    if (!article.author.toLowerCase().includes(filter.author.toLowerCase())) return false;
  }
  return true;
}

/**
 * Google News appends " - Publisher" to every headline. The sheet already
 * prints the source beside each item, so the suffix is duplication — and on a
 * long regulator name it pushes the actual headline out of view.
 *
 * Only the last segment is removed, and only when it is short and free of
 * sentence punctuation, so a headline that legitimately contains " - " keeps
 * its own text.
 */
function cleanSyndicatedTitle(title, url) {
  const t = String(title || '').trim();
  if (!/(^|\.)news\.google\.com$/i.test(safeHost(url))) return t;
  // " - Publisher" with nothing before it: Google indexed the page with no
  // headline. Trimming has already moved the dash to position 0, so the split
  // below cannot see it — catch the case explicitly and return nothing.
  if (/^-\s+/.test(t)) return '';
  // Greedy, so a headline containing its own " - " splits at the LAST separator
  // and keeps its text: "SUPA ENERGY - THE BASE network exemption - AER".
  const m = t.match(/^([\s\S]*)\s+-\s+([^-]{2,60})$/);
  if (!m) return t;
  if (/[.!?]$/.test(m[2].trim())) return t;
  // May legitimately come back empty: Google indexes some pages with no
  // headline at all, leaving only " - Publisher". normalise() drops those.
  return m[1].trim();
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function normalise(raw, source) {
  return raw
    .map(a => ({ ...a, title: cleanSyndicatedTitle(a.title, a.url) }))
    // Title is checked after cleaning, not before. Twenty of thirty-five AER
    // entries arrived as " - Australian Energy Regulator (AER)" — Google had
    // indexed the page with no headline, so once the publisher suffix goes
    // there is nothing left. Storing those means rows whose title is a
    // publisher's name, which is worse than not having the row.
    .filter(a => a.url && a.title && a.title.length >= 8)
    .filter(a => passesFilter(a, source.config?.filter))
    .map(a => ({
      source_id: source.id,
      url: a.url,
      title: a.title.slice(0, 500),
      author: a.author?.slice(0, 200) ?? null,
      published_at: a.published_at,
      summary_raw: a.summary_raw?.slice(0, 4000) ?? null,
      content_hash: contentHash(a),
    }));
}

module.exports = { parseFeed, parseIndex, normalise, contentHash, passesFilter, strip, absolute, cleanSyndicatedTitle, dateFromUrl, parseSitemap, publishedFromHtml, looksLikeArticle, anchorsFromMarkdown, extractBody };
