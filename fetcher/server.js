/**
 * Browser fetch service.
 *
 * Eleven of the briefed sources cannot be read with an HTTP GET:
 *   - AEMO, DCCEEW, DEECA, VicGrid, SEC Victoria, VEU, S&P Global sit behind bot
 *     protection that returns a 6 KB block page to anything without a real
 *     browser fingerprint
 *   - AER, UNFCCC, Victorian Premier render their article lists in JavaScript,
 *     so the HTML that arrives over HTTP contains no links at all
 *
 * Those include the top Australian energy regulators, so they are not optional
 * for the daily report. This service renders a page in headless Chromium and
 * returns the resulting HTML. n8n calls it instead of its HTTP Request node for
 * any source flagged requires_browser in sources/registry.yaml.
 *
 * Listens on the internal Docker network only — never published to the host.
 *
 *   POST /fetch  { "url": "...", "waitFor": "networkidle", "timeout": 30000 }
 *   GET  /health
 */
const http = require('http');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT ?? 8080);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT ?? 2);
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT ?? 35000);

let browser = null;
let active = 0;

async function getBrowser() {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Chromium advertises itself as automated by default; the sites we need
      // reject that outright.
      '--disable-blink-features=AutomationControlled',
      // aer.gov.au terminates Chromium's HTTP/2 connections with
      // ERR_HTTP2_PROTOCOL_ERROR. Forcing HTTP/1.1 makes it serve normally.
      '--disable-http2',
    ],
  });
  return browser;
}

/** Imperva and similar serve a small JS challenge page under a 403, set a
 *  cookie, and expect the client to come back. One reload after a pause is the
 *  difference between a block page and the article list. */
const CHALLENGE = /_Incapsula_Resource|Request unsuccessful\. Incapsula|Pardon Our Interruption|__cf_chl|Checking your browser/i;

async function render(url, { waitFor = 'domcontentloaded', timeout = NAV_TIMEOUT } = {}) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-AU',
    timezoneId: 'Australia/Melbourne',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'en-AU,en;q=0.9' },
  });

  // navigator.webdriver is the single most common bot tell.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  // Images and fonts are pure cost here — only the DOM matters.
  await page.route('**/*', route => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    return route.continue();
  });

  try {
    let response = await page.goto(url, { waitUntil: waitFor, timeout });
    // Client-rendered lists often paint just after domcontentloaded.
    await page.waitForTimeout(1200);
    let html = await page.content();

    if ((response?.status() === 403 || CHALLENGE.test(html)) && CHALLENGE.test(html)) {
      // Give the challenge script time to run and set its cookie, then retry.
      await page.waitForTimeout(6000);
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForTimeout(2500);
      html = await page.content();
    }

    return {
      status: response?.status() ?? 0,
      html,
      finalUrl: page.url(),
      challenged: CHALLENGE.test(html),
    };
  } finally {
    await context.close();
  }
}

/** Renders supplied HTML to PDF. Used for the client deliverables, which are
 *  authored as web decks and need a PDF alongside for sending and archiving. */
async function toPdf(html, { width = '1280px', height = '720px' } = {}) {
  const b = await getBrowser();
  const context = await b.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Fonts and any late layout settle before we measure pages.
    await page.waitForTimeout(600);
    return await page.pdf({ width, height, printBackground: true, pageRanges: '' });
  } finally {
    await context.close();
  }
}

const send = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, active, browser: !!browser?.isConnected() });
  }
  if (req.method === 'POST' && req.url === '/pdf') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 3e7) req.destroy(); });
    req.on('end', async () => {
      try {
        const { html, width, height } = JSON.parse(raw);
        if (!html) return send(res, 400, { error: 'html required' });
        const pdf = await toPdf(html, { width, height });
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length });
        res.end(pdf);
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/fetch') {
    return send(res, 404, { error: 'POST /fetch, POST /pdf, or GET /health' });
  }
  if (active >= MAX_CONCURRENT) {
    // A 2 GB container running Chromium will thrash rather than queue politely.
    return send(res, 503, { error: 'busy', active });
  }

  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 1e6) req.destroy();
  });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid JSON' }); }
    if (!body?.url || !/^https?:\/\//i.test(body.url)) {
      return send(res, 400, { error: 'url must be an absolute http(s) URL' });
    }

    active++;
    const started = Date.now();
    try {
      const out = await render(body.url, { waitFor: body.waitFor, timeout: body.timeout });
      send(res, 200, { ...out, ms: Date.now() - started });
    } catch (e) {
      send(res, 502, { error: e.message, ms: Date.now() - started });
    } finally {
      active--;
    }
  });
});

server.listen(PORT, () => console.log(`fetcher listening on ${PORT}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    server.close();
    await browser?.close().catch(() => {});
    process.exit(0);
  });
}
