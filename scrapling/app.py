"""
Retrieval service for sources that refuse an ordinary HTTP client.

Why a second fetcher, next to the Node one. The Node fetcher drives Chromium and
renders documents; it is not the problem. The problem is that a WAF fingerprints
the TLS handshake, and both Node's fetch and headless Chromium have handshakes
that are recognisably not a browser. Scrapling's fetcher borrows curl_cffi to
reproduce Chrome's fingerprint exactly, which is a thing neither of ours can do.

Measured on 22 August 2026, against sources that had been failing for weeks:

    EcoGeneration          403  ->  200
    DCCEEW                 403  ->  200     (registry had it marked unfixable)
    NABERS          unreachable  ->  200
    Clean Energy Council  8 links parsed -> 654

The IEA still answers 403 here. That one wants a real browser session, so it is
left alone rather than pretended fixed — see /fetch returning the status honestly.

Retrieval only. Deciding which of the returned links are articles rather than
navigation is the caller's job, and for the awkward sources that is Hermes —
n8n/lib/hermes-extract.js.
"""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urljoin, urlparse

from scrapling.fetchers import Fetcher

PORT = int(os.environ.get("PORT", "8090"))
TIMEOUT = int(os.environ.get("FETCH_TIMEOUT", "45"))

# Optional standing cookies, as {"www.afr.com": {"name": "value"}}, supplied by
# the environment rather than baked in. A session cookie is a credential: it goes
# in .env alongside the others, is gitignored, and expires — when a subscriber
# source starts returning the paywall again, this is the thing to renew.
try:
    SOURCE_COOKIES = json.loads(os.environ.get("SOURCE_COOKIES") or "{}")
except ValueError:
    print("SOURCE_COOKIES is not valid JSON — ignoring it", flush=True)
    SOURCE_COOKIES = {}

# Anchors that are structurally incapable of being an article.
SKIP_HREF = re.compile(r"^(#|mailto:|tel:|javascript:)", re.I)
SKIP_PATH = re.compile(r"/(tag|category|author|search|login|privacy|terms|subscribe)\b", re.I)


def extract_links(page, base):
    """Every same-host link with usable anchor text, deduplicated, in page order."""
    host = urlparse(base).netloc
    seen, out = set(), []
    for a in page.css("a"):
        href = (a.attrib.get("href") or "").strip()
        text = " ".join(a.get_all_text().split())
        if not href or len(text) < 18 or SKIP_HREF.match(href):
            continue
        full = urljoin(base, href).split("#")[0]
        if urlparse(full).netloc != host or SKIP_PATH.search(urlparse(full).path):
            continue
        if full in seen:
            continue
        seen.add(full)
        out.append({"url": full, "text": text[:200]})
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "service": "scrapling"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/fetch":
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self._send(400, {"error": "bad request body: %s" % e})

        url = req.get("url")
        if not url:
            return self._send(400, {"error": "url is required"})

        # Cookies for sources that only serve subscribers. These come from a
        # session the operator established themselves in their own browser and
        # exported — this service never sees a password and never signs in.
        # They are credentials with an expiry, so they live in n8n's credential
        # store and reach us per-request, never in this image or in the repo.
        cookies = req.get("cookies") or SOURCE_COOKIES.get(urlparse(url).netloc)

        try:
            page = Fetcher.get(
                url,
                impersonate=req.get("impersonate", "chrome"),
                timeout=int(req.get("timeout", TIMEOUT)),
                **({"cookies": cookies} if cookies else {}),
            )
        except Exception as e:
            return self._send(502, {"url": url, "error": str(e)[:300]})

        html = page.body.decode("utf-8", "replace") if page.body else ""
        # A refusal is reported as a refusal. Silently returning the block page as
        # if it were content is how DCCEEW stayed "ok" in the health table for weeks.
        self._send(200, {
            "url": url,
            "status": page.status,
            "ok": 200 <= page.status < 300,
            "bytes": len(html),
            "links": extract_links(page, url) if 200 <= page.status < 300 else [],
            "html": html if req.get("include_html") else "",
        })

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print("scrapling fetcher listening on %d" % PORT, flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
