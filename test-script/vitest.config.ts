import { defineConfig } from 'vitest/config'

// Runs the scripts in this folder against the frontend sources. Mirrors
// frontend/vitest.config.ts (node environment, same setup shims) but points
// `include` here instead of at frontend/src, so these harness scripts are not
// picked up by the app's own `npm test` run.
export default defineConfig({
  root: __dirname,
  test: {
    environment: 'node',
    include: ['*.test.ts'],
    setupFiles: ['../frontend/src/test/setup.ts'],
  },
})
