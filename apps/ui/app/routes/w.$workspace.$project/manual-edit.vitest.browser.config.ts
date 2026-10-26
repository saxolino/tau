import process from 'node:process';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/** Pointer, keyboard, history and narrow-viewport acceptance for manual modelling. */
export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  plugins: [tailwindcss()],
  cacheDir: '../../node_modules/.cache/manual-edit-browser',
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: {
    include: ['@testing-library/react', 'react', 'react-dom/client', 'lucide-react', 'radix-ui'],
  },
  server: {
    host: '127.0.0.1',
    fs: { allow: [fileURLToPath(new URL('../../../../..', import.meta.url))] },
  },
  test: {
    include: ['app/routes/w.$workspace.$project/manual-edit.browser.test.tsx'],
    fileParallelism: false,
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: process.env['TAU_TEST_BROWSER_CHANNEL'] ?? 'chromium' } }),
      instances: [{ browser: 'chromium' }],
      screenshotDirectory: '../../out/test-results/vitest-browser/manual-edit',
      commands: {
        async dragManualPoint(context, label: string, movement: { x: number; y: number }) {
          const point = context.iframe.getByRole('button', { name: label, exact: true });
          const bounds = await point.boundingBox();
          if (!bounds) {
            throw new Error(`Profile point is not visible: ${label}`);
          }
          const x = bounds.x + bounds.width / 2;
          const y = bounds.y + bounds.height / 2;
          await context.page.mouse.move(x, y);
          await context.page.mouse.down();
          await context.page.mouse.move(x + movement.x, y + movement.y, { steps: 8 });
          await context.page.mouse.up();
        },
      },
    },
  },
});
