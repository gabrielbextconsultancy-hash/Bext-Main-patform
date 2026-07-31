import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the cPanel (Passenger) deploy —
  // .next/standalone runs with plain `node server.js`, no dev deps on the host.
  output: 'standalone',
  // Monorepo has two lockfiles; pin tracing to this app so the standalone
  // bundle lands at .next/standalone/server.js (not nested under the repo root).
  outputFileTracingRoot: path.join(process.cwd()),
  turbopack: { root: path.join(process.cwd()) },
};

export default nextConfig;
