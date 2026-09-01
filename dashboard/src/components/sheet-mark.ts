/**
 * Marking one article inside a rendered sheet — shared by the delivered viewer
 * and the pre-send preview, because two copies of "find the card and outline
 * it" is how the two views would drift into disagreeing (R038's lesson).
 */

export const HIGHLIGHT_ID = 'bext-highlighted-article';

/**
 * Return a copy of the sheet with the card containing `url` outlined.
 *
 * Parsed with DOMParser rather than matched with a regex: the card is an
 * ancestor of the link, not a string near it, and email HTML nests tables
 * several deep. Parsing does not execute anything — DOMParser builds an inert
 * document — and the result is serialised straight back to a string.
 */
export function markArticle(html: string, url: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Each card links the article twice — once around the image, once around
    // the headline. Prefer the one carrying text: the image anchor's nearest
    // cell holds only the picture, and outlining that marks a photograph rather
    // than an article. Measured on the 31 Aug sheet, the image cell scored 0
    // characters against the headline cell's 419.
    const exact = Array.from(doc.querySelectorAll(`a[href="${CSS.escape(url)}"]`));
    const byPath = exact.length
      ? []
      // Sheets link the publisher URL; the row may carry the canonical one, so
      // fall back to matching on the path when the full URL does not hit.
      : Array.from(doc.querySelectorAll('a')).filter(a => {
          try {
            return new URL(a.getAttribute('href') ?? '', url).pathname === new URL(url).pathname;
          } catch {
            return false;
          }
        });
    const candidates = exact.length ? exact : byPath;
    const link =
      candidates.find(a => (a.textContent ?? '').trim().length > 10) ?? candidates[0];
    if (!link) return html;

    // Walk out to the first ancestor cell that actually holds the card's prose,
    // rather than the first cell of any kind.
    let card: Element = link;
    for (let i = 0; i < 8 && card.parentElement; i += 1) {
      card = card.parentElement;
      if (
        (card.tagName === 'TD' || card.tagName === 'TABLE') &&
        (card.textContent ?? '').trim().length > 80
      ) break;
    }

    card.setAttribute('id', HIGHLIGHT_ID);
    // Outline AND fill. The outline alone was correct and invisible: the sheet
    // runs to 287 KB, the marked card is usually far below the fold, and the
    // iframe is sandboxed with no scripts — so the #fragment is the only way to
    // scroll it, and nothing can force the scroll if the browser declines. A
    // tint survives that, because the reader finds it by scanning rather than
    // by landing on it.
    card.setAttribute(
      'style',
      `${card.getAttribute('style') ?? ''};outline:3px solid #ef4444;outline-offset:4px;` +
        'background:#fff1f2;border-radius:6px;scroll-margin-top:24px;'
    );

    // A label inside the card, so the marking is unambiguous once found.
    const tag = doc.createElement('div');
    tag.setAttribute('style',
      'background:#ef4444;color:#fff;font:700 10px/1.6 Arial,sans-serif;letter-spacing:.08em;'
      + 'text-transform:uppercase;padding:2px 8px;border-radius:3px;display:inline-block;margin:6px 0');
    tag.textContent = 'the article you selected';
    card.insertBefore(tag, card.firstChild);

    // A note at the top, so it is obvious the outline is ours and not the
    // client's copy. Placed in the body, not the stored row.
    const banner = doc.createElement('div');
    banner.setAttribute(
      'style',
      'background:#fee2e2;color:#991b1b;font:600 12px/1.5 Arial,sans-serif;' +
        'padding:8px 12px;border-bottom:1px solid #fecaca;'
    );
    // Name the article in the banner: "an article is outlined below" is useless
    // in a sheet of 170; the title tells the reader what to scan for.
    const headline = (link.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90);
    banner.textContent = headline
      ? `Dashboard view only — showing “${headline}”, outlined in red below. The emailed report carried no highlight.`
      : 'Dashboard view only — the outlined article is the one you selected. The emailed report carried no highlight.';
    doc.body.insertBefore(banner, doc.body.firstChild);

    return '<!doctype html>' + doc.documentElement.outerHTML;
  } catch {
    // A sheet that will not parse is still worth showing, unmarked.
    return html;
  }
}

