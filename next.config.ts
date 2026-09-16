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

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; block-all-mixed-content; upgrade-insecure-requests;",
          },
        ],
      },
    ]
  },
}

export default nextConfig
