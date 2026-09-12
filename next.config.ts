import type { NextConfig } from 'next'

/**
 * The project lives inside a OneDrive-synced folder, and Turbopack's persistent
 * cache is a large directory of small `.sst` files that OneDrive holds handles
 * on. That makes `next build` unable to clear its own cache to start clean —
 * EPERM on Windows, surfaced as SAFE_DELETE_BULK_CONFIRM_REQUIRED.
 *
 * Escape hatch: set NEXT_DIST_DIR to an *absolute* path outside the synced
 * tree. It is passed straight through, because Next joins a relative `distDir`
 * against the project root — which would land back on the sync layer.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(process.env.NEXT_DIST_DIR
    ? { distDir: process.env.NEXT_DIST_DIR }
    : {}),
}

export default nextConfig
