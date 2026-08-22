import { defineConfig } from 'vitest/config'

// Its own config rather than an entry in test-script/vitest.config.ts, which
// only scans that directory's top level. Keeping it separate also keeps the
// harness out of the default `npx vitest run` in test-script/ — these tests
// need a browser step to produce their input, and the shared suite should not
// have to reason about that.
export default defineConfig({
  root: __dirname,
  test: {
    environment: 'node',
    include: ['*.test.ts'],
    setupFiles: ['../../frontend/src/test/setup.ts'],
  },
})
