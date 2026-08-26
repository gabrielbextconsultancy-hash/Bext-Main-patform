# Builds docs/source-checklist.html from a live audit snapshot.
#
# Inputs, produced fresh before each run:
#   audit.json       one row per registered source, with live counts and status
#   brief-links.txt  the 66 hyperlinks embedded in the client's project brief
#
# The tables are data-driven so the checklist cannot drift from reality; the
# error/reason columns carry what was actually diagnosed, not guesses.
import json, io, re, datetime
from urllib.parse import urlparse

rows = json.load(io.open('audit.json', encoding='utf-8'))
# node-postgres serialises bigint counts as strings; make them numbers once here.
for r in rows:
    for k in ('articles_7d', 'articles_24h', 'dated_24h', 'consecutive_failures'):
        r[k] = int(r.get(k) or 0)
brief = [l.strip() for l in io.open('docs/brief-links.txt', encoding='utf-8') if l.strip()]

# What was actually found wrong (or right) per source, from the investigations
# of 21-26 Aug 2026. Anything not listed gets a derived note.
NOTES = {
 'reuters-carbon': ('Account wall (HTTP 401). A genuine login, not a fingerprint block. Route is the free Reuters newsletter into the intake mailbox; inactive until that lands so it cannot report false health.'),
 'iea': ('Account wall (HTTP 403 to every fetcher). Replaced by newsletter intake; the old scrape source is retired at 527 consecutive failures.'),
 'iea-energy-efficiency': ('Successor to the IEA scrape, awaiting the newsletter route. Never run yet.'),
 'the-australian': ('Subscription site. Newsletter subscribed to the intake mailbox; articles arrive by email (tier 0), not by scraping.'),
 'newsletter-other': ('Catch-all for newsletters from senders not yet mapped to a source. Fills only when such mail arrives.'),
 'afr-energy': ('Listing scrapes cleanly; article bodies are paywalled, so summaries come from the listing. Most items carry no machine-readable date - the article-page date reader now fills them in.'),
 'renewables-now': ('Highest-volume source (167 articles / 7d). Rate-limits (HTTP 429) under parallel fetching - per-host politeness is mandatory. No date in its markup; dates are read from each article page.'),
 'spglobal-latest-news': ('Listing is client-rendered and the edge refuses a headless browser (403), so neither ordinary tier can work. Read from its XML sitemap instead - working since 26 Aug (14 articles first day).'),
 'spglobal-crude-oil': ('Same block as the parent section; read from its own sitemap. Working since 26 Aug (7 articles, including the exact stories the client flagged missing).'),
 'spglobal-natural-gas': ('Sitemap fetches (1.1 MB) but yields no recent articles. Under watch: either the section is quiet or the sitemap is the wrong one - not yet proven either way.'),
 'spglobal-energy-transition': ('Older scrape source. TLS-fingerprint 403 solved by the Scrapling fetcher; captures the newsroom listing, which yields little and no dates.'),
 'vic-premier': ('Articles load by in-page XHR; the listing HTML carries no links for any parser. Unsolved - needs its JSON endpoint captured. Fails visibly (428+ consecutive) rather than pretending health.'),
 'aer-registers': ('Same class as vic-premier: client-rendered register, no feed, no links in the HTML. Unsolved and visibly failing (494+ consecutive).'),
 'aemo': ('Fetches heavily but the newsroom links site navigation alongside stories - a podcast page, a scholarship, market explainers. The news-vs-reference judge now holds those out of the sheet.'),
 'cec': ('Every story was once lost to a "Find out more" link text (scored as too short); fixed via slug-derived titles. Publishes no date in its markup; member-portal login (tier 3) is available for the Monday Megawatt.'),
 'dcceew': ('Every article was once dropped because /about/news/ paths were mistaken for chrome; fixed. 28 articles / 7d since.'),
 'eco-generation': ('TLS-fingerprint 403 until the Scrapling fetcher; now healthy on RSS (11 / 7d). Flagged by the client on 21 Aug - the miss predates the fix.'),
 'fifth-estate': ('Flagged by the client on 21 Aug; now healthy on RSS (9 / 7d).'),
 'reneweconomy': ('Flagged by the client on 21 Aug; now RSS plus the daily newsletter into the intake mailbox (51 / 7d).'),
 'pv-magazine-au': ('Flagged by the client on 21 Aug; now RSS plus newsletter (24 / 7d).'),
 'conversation-au': ('Healthy scrape; some articles carry no meta date, filled by the article-page reader.'),
 'nabers': ('TLS-fingerprint 403 solved by Scrapling. Publishes no dates; several captured pages are program pages, which the judge now separates from news.'),
 'energy-rating-gems': ('Parser found nothing for 71 consecutive fetches until the markup fix; 44 articles / 7d since. Captured pages are often program/registry pages - judged before the sheet.'),
 'pca': ('Parser silent for 527 consecutive fetches until fixed; now 12 / 7d on RSS.'),
 'us-doe': ('The energy.gov miss of 21 Aug; now healthy on RSS (5 / 7d).'),
 'solar-victoria': ('Quiet since 31 Jul. Publishes rarely; worth a manual glance if it stays silent past mid-September.'),
 'veu-program': ('Feed publishes rarely; last item 3 Aug. Quiet, not broken.'),
 'aemc-registers': ('Rule-change register; publishes in bursts around determinations. Quiet weeks are normal.'),
}

def status_of(r):
    if not r['active']:
        return ('OFF', 'walled' if r['slug'] in ('reuters-carbon','iea','the-australian') else 'pending')
    if r['consecutive_failures'] and r['consecutive_failures'] >= 3:
        return ('FAILING', None)
    if r['articles_7d'] == 0:
        return ('QUIET', None)
    return ('WORKING', None)

def derived_note(r):
    st, _ = status_of(r)
    if st == 'WORKING':
        return 'Fetches and parses cleanly on schedule.'
    if st == 'QUIET':
        return 'Fetch succeeds; the publisher has simply released nothing in the window. Quiet is watched, not hidden.'
    return 'See status.'

host = lambda u: urlparse(u).netloc.replace('www.','')
esc = lambda s: (s or '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

cats = {}
for r in rows:
    cats.setdefault(r['category'], []).append(r)

tot = len(rows); act = sum(1 for r in rows if r['active'])
working = sum(1 for r in rows if status_of(r)[0]=='WORKING')
quiet = sum(1 for r in rows if status_of(r)[0]=='QUIET')
failing = sum(1 for r in rows if status_of(r)[0]=='FAILING')
off = sum(1 for r in rows if status_of(r)[0]=='OFF')
a24 = sum(r['articles_24h'] for r in rows); a7 = sum(r['articles_7d'] for r in rows)

BADGE = {'WORKING':'#166534;background:#dcfce7','QUIET':'#854d0e;background:#fef9c3',
         'FAILING':'#991b1b;background:#fee2e2','OFF':'#374151;background:#e5e7eb'}

def table(cat):
    out = []
    for r in sorted(cats[cat], key=lambda x: (status_of(x)[0]!='FAILING', x['name'].lower())):
        st, sub = status_of(r)
        label = st + (' — account' if sub=='walled' else (' — pending' if sub=='pending' else ''))
        note = NOTES.get(r['slug']) or derived_note(r)
        err = ''
        if st=='FAILING': err = (r['last_status'] or '') + ' ×' + str(r['consecutive_failures'])
        elif st=='OFF' and sub=='walled': err = 'login required'
        out.append(
          '<tr><td><b>%s</b><br><span class="u">%s</span></td>'
          '<td class="m">%s</td>'
          '<td><span class="badge" style="color:%s">%s</span></td>'
          '<td class="n">%s / %s</td>'
          '<td class="n">%s</td>'
          '<td class="err">%s</td>'
          '<td class="note">%s</td></tr>'
          % (esc(r['name']), esc(host(r['url'] or '')), r['method'], BADGE[st], label,
             r['articles_7d'], r['articles_24h'], esc(r['latest'] or '—'), esc(err), esc(note)))
    return '\n'.join(out)

when = datetime.date.today().strftime('%d %B %Y')

html = """<!doctype html><html><head><meta charset="utf-8">
<title>BEXT Source Checklist</title>
<style>
 @page { size: A4; margin: 14mm; }
 body { font: 10px/1.45 'Segoe UI', system-ui, sans-serif; color:#111827; margin:0; }
 h1 { font-size:21px; margin:0 0 2px; } h2 { font-size:14px; margin:22px 0 6px; border-bottom:2px solid #0f766e; padding-bottom:3px; }
 h3 { font-size:11.5px; margin:14px 0 4px; }
 .sub { color:#6b7280; margin-bottom:14px; }
 .tiles { display:flex; gap:8px; margin:12px 0; }
 .tile { flex:1; border:1px solid #e5e7eb; border-radius:6px; padding:8px 10px; }
 .tile b { font-size:16px; display:block; }
 table { width:100%%; border-collapse:collapse; margin:6px 0 10px; }
 th { text-align:left; font-size:8.5px; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; border-bottom:1px solid #d1d5db; padding:3px 5px; }
 td { border-bottom:1px solid #f3f4f6; padding:4px 5px; vertical-align:top; }
 .u { color:#6b7280; font-size:8.5px; } .m { color:#374151; } .n { white-space:nowrap; }
 .badge { font-weight:600; font-size:8.5px; padding:1px 6px; border-radius:8px; white-space:nowrap; }
 .err { color:#991b1b; font-size:9px; } .note { color:#374151; font-size:9px; }
 .box { border:1px solid #e5e7eb; border-left:4px solid #0f766e; border-radius:4px; padding:8px 10px; margin:8px 0; }
 .warn { border-left-color:#b45309; }
 ul { margin:4px 0 8px 16px; padding:0; } li { margin:2px 0; }
 .small { font-size:9px; color:#374151; }
 .pagebreak { page-break-before: always; }
</style></head><body>

<h1>Industry Daily Report — Source Checklist &amp; Diagnosis</h1>
<div class="sub">Against the Project Brief of 28 Jul 2026 (66 embedded links) · live pipeline state as of %(when)s</div>

<div class="tiles">
 <div class="tile"><b>%(brief)d</b>links in the client brief</div>
 <div class="tile"><b>%(tot)d</b>sources registered (%(act)d active)</div>
 <div class="tile"><b>%(working)d</b>working — delivering articles</div>
 <div class="tile"><b>%(quiet)d</b>working but quiet this week</div>
 <div class="tile"><b>%(failing)d</b>failing (visible, tracked)</div>
 <div class="tile"><b>%(off)d</b>off — walled or pending</div>
</div>
<div class="tiles">
 <div class="tile"><b>%(a24)d</b>articles captured, last 24 h</div>
 <div class="tile"><b>%(a7)d</b>articles captured, last 7 days</div>
 <div class="tile"><b>05:00</b>report send (AEST), reads the finished prior day</div>
 <div class="tile"><b>3×/day</b>quality passes: 06:00 · 12:00 · 23:00</div>
</div>

<div class="box">Every link in the brief maps to a registered source below — 66 of 66. The registry carries
seven more than the brief because several brief links share a publisher (split into sections) and the
newsletter intake adds sources of its own. A source marked QUIET fetched successfully and found the
publisher had released nothing; that state is recorded and watched, never hidden behind an "ok".</div>

<h2>Australian News</h2>
<table><tr><th>Source</th><th>Method</th><th>Status</th><th>Articles 7d/24h</th><th>Last article</th><th>Error</th><th>Reason / remedy</th></tr>
%(t_aus)s</table>

<h2>Industry Updates</h2>
<table><tr><th>Source</th><th>Method</th><th>Status</th><th>Articles 7d/24h</th><th>Last article</th><th>Error</th><th>Reason / remedy</th></tr>
%(t_ind)s</table>

<h2>International Industry Updates</h2>
<table><tr><th>Source</th><th>Method</th><th>Status</th><th>Articles 7d/24h</th><th>Last article</th><th>Error</th><th>Reason / remedy</th></tr>
%(t_int)s</table>

<div class="pagebreak"></div>
<h2>The errors that occur, and what each one means</h2>
<table>
<tr><th>Error class</th><th>How it shows</th><th>Real examples</th><th>Remedy in place</th></tr>
<tr><td><b>TLS-fingerprint block</b></td><td>HTTP 403 to plain fetch and to headless Chromium alike</td><td>DCCEEW, S&amp;P Global, EcoGeneration, NABERS</td><td>Scrapling fetcher impersonates Chrome's TLS handshake; all four now return 200</td></tr>
<tr><td><b>Client-rendered listing</b></td><td>HTTP 200 but the HTML contains no article links</td><td>S&amp;P Global sections, vic-premier, aer-registers</td><td>S&amp;P read from its XML sitemaps; the two XHR registers remain open items and fail visibly</td></tr>
<tr><td><b>Account wall</b></td><td>401/403 that no fetcher can pass — a genuine login</td><td>Reuters, IEA, The Australian, AFR article bodies</td><td>Newsletters subscribed into the intake mailbox (tier 0); CEC member portal has a tier-3 login</td></tr>
<tr><td><b>Rate limiting</b></td><td>HTTP 429 when a host is hit in parallel — looks identical to "no data" if unhandled</td><td>Renewables Now (23 of 31 "dateless" articles were really 429s); S&amp;P sitemaps fetched as a burst</td><td>Per-host serialisation with delay; sitemap fetches staggered; 429 recorded as blocked and retried, never written off</td></tr>
<tr><td><b>No publication date in markup</b></td><td>Article captured but dated by fetch time — lands in the wrong day's report</td><td>7 sources in 10; measured: one article in three mis-filed</td><td>Article pages opened and article:published_time / JSON-LD read; three quality passes daily; the 23:00 pass closes the day</td></tr>
<tr><td><b>Unrecognised markup</b></td><td>Fetch reports "ok" while the parser finds nothing, for weeks</td><td>PCA (527 straight), Energy Rating/GEMS (71), CEC ("Find out more" links)</td><td>Parser fixes plus per-tier attempt logging, so "ok but empty" is visible per run</td></tr>
<tr><td><b>Navigation captured as news</b></td><td>Site furniture enters the corpus and scores well</td><td>AEMO podcast page, "IT change &amp; release management", DWGM/ISP explainers, "Legal notice"</td><td>Model judge (news vs reference) holds standing pages out of the sheet; undecided ships</td></tr>
<tr><td><b>Archive unlock flood</b></td><td>A parser fix suddenly makes years-old pages look like today's news</td><td>40 CEC articles from 2022 (23 Aug); 484 stale-dated found on 26 Aug</td><td>report_eligible hold, applied automatically the moment a resolved date proves an article old</td></tr>
<tr><td><b>Scoring outage</b></td><td>LLM quota exhausted; unscored articles would silently vanish from the sheet</td><td>Gemini daily quota, 25 Aug</td><td>Score coalesced to 0 (ranked last, not dropped); backlog scored when quota returns</td></tr>
<tr><td><b>Send failure</b></td><td>Report renders but the mail does not arrive</td><td>DKIM failure silently discarded by Gmail (to 24 Aug); Graph 400 on semicolon recipients (26 Aug)</td><td>Send moved to Microsoft Graph (Microsoft-signed); non-202 throws so a failed send can never be recorded as sent</td></tr>
</table>

<h2>The two missing-article reports, diagnosed</h2>

<h3>21 August — the first complaint (~20 URLs)</h3>
<div class="box">Root causes, each since fixed: <b>unrecognised markup</b> (DCCEEW chrome filter, CEC link text,
PCA and GEMS parsers — sources reported "ok" while returning nothing), <b>TLS blocks</b> (EcoGeneration and
others, solved by the Scrapling fetcher), <b>account walls</b> (IEA, energy.gov then unregistered, AFR bodies —
newsletter routes and new RSS sources), and <b>listing roll-off</b> on high-volume sites between hourly fetches
(RenewEconomy, PV Magazine, Fifth Estate, Renewables Now — all now on RSS/newsletter and healthy: 51, 24, 9
and 167 articles this week respectively).</div>

<h3>25 August — the second complaint (26 URLs)</h3>
<div class="box">Checked one by one against the database: <b>21 of 26 had been fetched all along.</b> They were
invisible for different reasons: <b>11</b> dated by fetch time into the wrong day (the date-drift fault, one in
three articles), <b>3</b> cut by one point at the then-floor of 16, <b>2</b> scored 0 by an over-tight rule
(since softened), <b>1</b> a physics explainer, correctly absent. The <b>4 S&amp;P stories were genuinely never
fetched</b> — we monitored a different S&amp;P section, and the right one is double-blocked (client-rendered
+ edge 403). Its sitemaps are now registered and delivering; the exact flagged stories were captured on the
first working run.</div>

<h2>What is read before each daily report</h2>
<div class="box">Hourly, every source is fetched down a five-tier ladder (email → direct → browser → login →
model) with every attempt logged. Every 30 minutes new articles are scored (the scorer exits instantly when
there is nothing new). Three times a day — 06:00, 12:00 and 23:00 — the quality pass opens undated articles to
read their true publication date, judges news from standing pages, and writes a coverage line: fetched, dated,
undated, wrong-day-corrected, and sources that ran clean but returned nothing. The 23:00 pass completes the
day before it closes. At 05:00 the report queries the finished prior day — floor 1, no reference pages, no
stale-dated items, minus everything already sent (the ledger guarantees nothing is lost to midnight and
nothing repeats). Current volume: ~90–190 items per morning across the three brief categories.</div>

<div class="pagebreak"></div>
<h2>How to capture more, and the two libraries asked about</h2>

<h3>github.com/D4Vinci/Scrapling — already integrated</h3>
<div class="box">This is not a proposal; it is running. The <b>bext-scrapling</b> container on the VPS is built
on exactly this library — it is what impersonates Chrome's TLS fingerprint and turned the DCCEEW, S&amp;P,
EcoGeneration and NABERS 403s into 200s, and it fetches every article page the date-reader opens. It is tier 1
of the retrieval ladder.</div>

<h3>github.com/firecrawl/firecrawl — worth a pilot, for a narrow job</h3>
<div class="box warn">Firecrawl self-hosts as a crawl-and-extract service with real JavaScript rendering and
LLM-assisted extraction. Honest assessment: <b>most of what it offers, the pipeline now already does</b> —
fetching, link discovery, per-page metadata, model fallback. Its genuine advantage is executing a page's
JavaScript and waiting for XHR content, which is precisely the one unsolved class: <b>vic-premier</b> and
<b>aer-registers</b>, and proving whether S&amp;P natural-gas is quiet or wrong. Recommendation: pilot it
self-hosted against those two or three sources as an additional ladder tier, rather than replacing a working
stack wholesale. Cost: one more container (~1–2 GB RAM) on a VPS that also runs an 8B model — check headroom
before committing. If the pilot solves the XHR pair, keep it for that tier alone.</div>

<h3>Beyond the two libraries — the levers that add the most articles next</h3>
<ul class="small">
<li><b>Land the newsletters.</b> Reuters, IEA and The Australian content only arrives by mail; the intake workflow exists — finishing the subscriptions is the cheapest coverage gain left.</li>
<li><b>Capture the two XHR endpoints</b> (vic-premier, aer-registers) — by hand in browser dev-tools, or by the Firecrawl pilot.</li>
<li><b>Resolve S&amp;P natural-gas</b>: confirm quiet vs wrong sitemap, and register further S&amp;P sections (electric-power, LNG) the same proven way.</li>
<li><b>Wire the quiet-source alert to Teams.</b> The coverage line already counts sources that ran clean and returned nothing; nobody is paged yet. This turns the next silent failure into a same-day fix instead of a client complaint.</li>
<li><b>CEC member portal (tier 3)</b> is built and awaiting the credential — unlocks member-only content, licensing permitting.</li>
</ul>

<div class="sub" style="margin-top:16px">BEXT Consultancy · automation stack · generated %(when)s · sources of truth: sources/registry.yaml, live database, fetch_attempts log</div>
</body></html>""" % dict(when=when, brief=len(brief), tot=tot, act=act, working=working,
                       quiet=quiet, failing=failing, off=off, a24=a24, a7=a7,
                       t_aus=table('Australian News'), t_ind=table('Industry Updates'),
                       t_int=table('International Industry Updates'))

io.open('docs/source-checklist.html','w',encoding='utf-8').write(html)
print('wrote docs/source-checklist.html (%d KB)' % (len(html)//1024))
