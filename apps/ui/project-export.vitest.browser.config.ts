import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { tauRuntime } from '@taucad/runtime/vite';

/** Independent STEP validation in the actual browser Worker/WASM environment. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tauRuntime()],
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  test: {
    include: ['app/workers/project-export.browser.test.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: 'chromium' } }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
