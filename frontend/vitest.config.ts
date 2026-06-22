import { defineConfig } from 'vitest/config'

// Minimal config for unit tests. Deliberately does NOT load the app's vite
// plugins (react / legacy transpile) — these are pure-logic tests that need no
// DOM or JSX transform. App code never imports vitest, so this is dev-only and
// has no effect on the production build.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
