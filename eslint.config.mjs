import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

// Flat config (ESLint 9+). Next 16 ships these as ready-made flat arrays —
// @eslint/eslintrc's FlatCompat blows up on a circular plugin reference.
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'prisma/seed.ts'],
  },
]

export default config
