import { defineConfig } from 'vitest/config'

// Runs the repro in test-script/ against the frontend sources. Root is the
// project root so the exporter's font paths resolve off frontend/public.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test-script/hindi_*_export.test.ts'],
    setupFiles: ['./frontend/src/test/setup.ts'],
  },
})
