import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: __dirname + '/..',
    include: ['test-script/docx_dual_dialogue_preview.test.ts'],
    setupFiles: ['frontend/src/test/setup.ts'],
  },
});
