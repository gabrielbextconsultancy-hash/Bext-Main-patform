'use strict';

/**
 * Passenger entry point for the cPanel Node.js Selector app.
 *
 * The Selector points at this file; it boots the Next.js standalone server
 * produced by `next build` (output: 'standalone'). Passenger provides PORT.
 * `.cpanel.yml` copies `public/` and `.next/static` into the standalone dir
 * after every build so the bundle is fully self-contained.
 */
process.env.NODE_ENV = 'production';
process.env.HOSTNAME = process.env.HOSTNAME || '127.0.0.1';

// Server-local secrets: env.local.json sits next to this file on the host
// (written once at setup, gitignored) — works around the Selector UI/API
// env-var handling on this host. Existing env always wins.
try {
  const local = require('./env.local.json');
  for (const [k, v] of Object.entries(local)) {
    if (process.env[k] === undefined) process.env[k] = String(v);
  }
} catch { /* no local overrides */ }

require('./.next/standalone/server.js');
