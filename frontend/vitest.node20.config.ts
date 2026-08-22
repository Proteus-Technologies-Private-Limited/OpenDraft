import { defineConfig } from 'vitest/config'

/**
 * The unit suite as CI runs it.
 *
 * CI is on Node 20, which has no `navigator` global; a developer on Node 21+
 * does. That difference hid a module-scope `navigator` read that passed locally
 * and failed on push. `npx vitest run --config vitest.node20.config.ts` removes
 * the global first, so the gap can be caught before pushing.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/no-navigator.ts', './src/test/setup.ts'],
  },
})
