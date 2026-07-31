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

require('./.next/standalone/server.js');
