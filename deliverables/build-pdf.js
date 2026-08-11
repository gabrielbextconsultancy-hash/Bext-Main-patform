#!/usr/bin/env node
/**
 * Renders a client deck to PDF from the same HTML the site serves, so the two
 * can never disagree.
 *
 *   node deliverables/build-pdf.js
 *
 * Uses the fetcher's /pdf endpoint on the VPS — Chromium is already running
 * there, so there is nothing to install locally. Needs an SSH tunnel to it:
 *
 *   ssh -i ~/.ssh/pf-nfac-hostinger -L 8080:127.0.0.1:8080 root@187.127.213.243 -N
 *
 * The fetcher binds to the internal Docker network only, hence the tunnel.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REPO = path.join(__dirname, '..');

const DECKS = [
  {
    src: path.join(REPO, 'dashboard', 'public', 'proposal', 'index.html'),
    out: path.join(REPO, 'deliverables', 'BEXT-Business-Structure-Efficiency-Draft-Plan-2026-08-11.pdf'),
  },
  {
    // A document rather than a deck: A4 portrait, and the CSS is written for
    // print (page breaks, avoid splitting rows) rather than for a 16:9 slide.
    src: path.join(REPO, 'docs', 'access-checklist.html'),
    out: path.join(REPO, 'deliverables', 'BEXT-Access-Permissions-Checklist-2026-08-11.pdf'),
    width: '210mm',
    height: '297mm',
  },
];

const ENDPOINT = process.env.FETCHER_URL ?? 'http://127.0.0.1:8080';

(async () => {
  for (const deck of DECKS) {
    const html = fs.readFileSync(deck.src, 'utf8');
    const r = await fetch(`${ENDPOINT}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        width: deck.width ?? '1280px',
        height: deck.height ?? '720px',
      }),
    });
    if (!r.ok) {
      console.error(`FAILED ${path.basename(deck.out)} — ${r.status} ${(await r.text()).slice(0, 200)}`);
      process.exitCode = 1;
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(deck.out, buf);
    console.log(`${path.basename(deck.out)} — ${(buf.length / 1024).toFixed(0)} KB`);
  }
})().catch(e => {
  console.error(e.message);
  console.error('Is the tunnel open?  ssh -i ~/.ssh/pf-nfac-hostinger -L 8080:127.0.0.1:8080 root@187.127.213.243 -N');
  process.exit(1);
});
