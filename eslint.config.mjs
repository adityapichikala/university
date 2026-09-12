import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

// Flat config (ESLint 9+). Next 16 ships these as ready-made flat arrays —
// @eslint/eslintrc's FlatCompat blows up on a circular plugin reference.
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    // Build output is never linted. The glob covers the default `.next` as well
    // as any alternate dist dir from NEXT_DIST_DIR (see next.config.ts) and any
    // `.next-bak-*` left behind by a failed build — linting generated bundles
    // produces hundreds of phantom errors and buries real ones.
    ignores: ['.next*/**', 'node_modules/**', 'next-env.d.ts', 'prisma/seed.ts'],
  },
]

export default config
