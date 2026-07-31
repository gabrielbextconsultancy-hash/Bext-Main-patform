import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the cPanel (Passenger) deploy —
  // .next/standalone runs with plain `node server.js`, no dev deps on the host.
  output: 'standalone',
  // pg is server-external by default; Turbopack then imports it via a hashed
  // alias that only resolves on the build machine. Bundling it makes the
  // standalone output truly portable to the cPanel host.
  transpilePackages: ['pg'],
  // Monorepo has two lockfiles; pin tracing to this app so the standalone
  // bundle lands at .next/standalone/server.js (not nested under the repo root).
  outputFileTracingRoot: path.join(process.cwd()),
  turbopack: { root: path.join(process.cwd()) },
};

export default nextConfig;
