// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A stylesheet component test, without an app server or authentication. The
// compact defaults represent the host controls before tablet rules are applied.
describe('CAD tablet touch targets', () => {
  let browser: Browser | undefined;
  let css: string;
  beforeAll(async () => {
    css = await readFile(new URL('cad-tablet.css', import.meta.url), 'utf8');
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'],
    });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it.each([744, 768, 900, 1024, 1366])('should keep primary controls at least 44 pixels at %i px', async (width) => {
    if (!browser) {
      throw new Error('Chromium did not start');
    }
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.setContent(`<style>
        :root { --spacing: 0.25rem; --text-base: 1rem; }
        button, input { box-sizing: border-box; width: 28px; height: 28px; padding: 0; }
        ${css}
      </style>
      <section data-slot="project-top-bar"><button>Misure</button><button>Agente</button></section>
      <section data-cad-home><button>Scegli un’immagine</button></section>
      <section data-slot="tablet-lane"><input aria-label="Misura" /></section>
      <section data-slot="viewer-controls"><div><button>Adatta</button></div></section>
      <section data-chat-composer><button>Microfono</button><div contenteditable="true" role="textbox" aria-label="Messaggio"></div></section>`);
      const targets = await Promise.all(
        ['Misure', 'Agente', 'Scegli un’immagine', 'Adatta', 'Microfono'].map(async (name) =>
          page.getByRole('button', { name, exact: true }).boundingBox(),
        ),
      );
      for (const bounds of targets) {
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      const input = await page.getByRole('textbox', { name: 'Misura' }).boundingBox();
      expect(input?.height).toBeGreaterThanOrEqual(44);
      const message = page.getByRole('textbox', { name: 'Messaggio' });
      const messageBounds = await message.boundingBox();
      expect(messageBounds?.height).toBeGreaterThanOrEqual(44);
      expect(await message.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await page.close();
    }
  });
});
