/**
 * `output: 'standalone'` produces a server bundle but deliberately leaves out
 * `public/` and `.next/static/` — Next assumes a CDN serves them. On the cPanel
 * (Passenger) host there is no CDN: the Node process serves everything, so
 * without this step every static asset and every file in public/ 404s.
 *
 * Runs automatically as the postbuild step.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');

if (!fs.existsSync(standalone)) {
  console.log('copy-standalone-assets: no standalone output, nothing to do');
  process.exit(0);
}

const copies = [
  { from: path.join(root, 'public'), to: path.join(standalone, 'public') },
  { from: path.join(root, '.next', 'static'), to: path.join(standalone, '.next', 'static') },
];

let files = 0;
for (const { from, to } of copies) {
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, to, { recursive: true });
  const count = (function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true })
      .reduce((n, e) => n + (e.isDirectory() ? walk(path.join(dir, e.name)) : 1), 0);
  })(to);
  files += count;
  console.log(`copy-standalone-assets: ${path.relative(root, from)} → ${count} files`);
}
console.log(`copy-standalone-assets: ${files} files total`);
