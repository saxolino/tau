import { defineConfig } from 'vitest/config';

// A real Chromium CSS fixture via Playwright, with no Vite or application server.
export default defineConfig({
  test: {
    include: ['app/styles/cad-tablet-targets.browser.test.ts'],
    environment: 'node',
    maxWorkers: 2,
  },
});
