import { defineConfig } from 'vitest/config';

// Runs the .odraft validation suite, which lives here rather than under
// frontend/src (it is a conversion check, not an app unit test) and so is
// outside the include glob in frontend/vitest.config.ts. Mirrors that config
// otherwise — node environment plus the localStorage shim the stores read at
// module scope.
export default defineConfig({
  root: new URL('../frontend', import.meta.url).pathname,
  test: {
    environment: 'node',
    include: ['../test-script/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
