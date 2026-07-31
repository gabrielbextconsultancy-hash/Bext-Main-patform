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
const CHROME = /\/(tag|tags|category|categories|author|page|search|login|subscribe|contact|about|privacy|terms|sitemap|feed|rss|wp-|cdn-cgi)\b/i;
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
  if (CHROME.test(path) || ASSET.test(path)) return -1;
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

function parseIndex(html, pageUrl, { minScore = 6, limit = 40 } = {}) {
  const origin = new URL(pageUrl).origin;
  const seen = new Map();

  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absolute(m[1], pageUrl);
    let title = strip(m[2]);
    // Anchor text that is just the href carries no information — the slug does.
    if (!title || /^https?:\/\//i.test(title) || title.length < 12) {
      title = titleFromSlug(url) ?? title;
    }
    if (!title) continue;
    const score = scoreLink(url, title, origin);
    if (score < minScore) continue;
    // Same URL can appear as image link and headline link; keep the better title.
    const prev = seen.get(url);
    if (!prev || title.length > prev.title.length) {
      seen.set(url, { url, title, author: null, published_at: null, summary_raw: null, _score: score });
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

function normalise(raw, source) {
  return raw
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

module.exports = { parseFeed, parseIndex, normalise, contentHash, passesFilter, strip, absolute };
