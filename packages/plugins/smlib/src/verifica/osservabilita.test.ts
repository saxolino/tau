// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import {
  differenzaSilhouette,
  esitoOsservabilita,
  PASSO_OSSERVABILITA,
  SOGLIA_OSSERVABILITA,
} from '#verifica/osservabilita.js';
import { eseguiCaso } from '#verifica/set-sintetico.js';

vi.setConfig({ testTimeout: 180_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

describe('osservabilità: le funzioni pure', () => {
  it('should measure the area that changes inside the valid region only', () => {
    const base = { larghezza: 4, altezza: 1, dati: Uint8Array.of(1, 1, 0, 0) };
    const altra = { larghezza: 4, altezza: 1, dati: Uint8Array.of(1, 0, 1, 0) };
    expect(differenzaSilhouette(base, altra)).toBe(1);
    // The changed pixels lie in an occluded stretch (valida = 0): the view cannot see them.
    expect(differenzaSilhouette(base, altra, Uint8Array.of(1, 0, 0, 1))).toBe(0);
  });

  it('should call a parameter observable from the threshold and give the band the view does not tell apart', () => {
    const range = [20, 120] as const;
    const visto = esitoOsservabilita('tacco.altezza', { sensibilita: 0.1, degrado: 0.05 }, 85, range);
    expect(visto.osservabile).toBe(true);
    // 5 % of 100 mm = 5 mm moves the IoU by 5 %: the IoU would move by the threshold (2.5 %) at ±2.5 mm.
    expect(visto.banda[0]).toBeCloseTo(85 - (PASSO_OSSERVABILITA * 100 * SOGLIA_OSSERVABILITA) / 0.05, 9);
    const nonVisto = esitoOsservabilita('seduta.larghezza', { sensibilita: 0.004, degrado: 0.004 }, 48, [30, 70]);
    expect(nonVisto.osservabile).toBe(false);
    // 5 % of 40 mm = 2 mm moves the IoU by 0.4 %: the IoU would move by 2.5 % at ±12.5 mm.
    expect(nonVisto.banda[0]).toBeCloseTo(35.5, 9);
    expect(nonVisto.banda[1]).toBeCloseTo(60.5, 9);
    // No effect at all: the band is the parameter's whole range.
    expect(esitoOsservabilita('x', { sensibilita: 0, degrado: 0 }, 1, [0, 10]).banda).toEqual([0, 10]);
    expect(esitoOsservabilita('x', { sensibilita: 0.1, degrado: SOGLIA_OSSERVABILITA }, 1, [0, 10]).osservabile).toBe(
      true,
    );
  });
});

describe('osservabilità: tacchi da una sola vista (set sintetico)', () => {
  it('should not call measured a heel parameter the single side view leaves 2–9 mm wrong', () => {
    // A block heel (seed 102): the optimiser leaves the seat and top-piece sizes 3.7–5.9 mm off and the height 5 mm off;
    // none of them may come out as measured.
    const { risultato } = eseguiCaso(lib, { famiglia: 'tacco', variante: 'blocco', seme: 102 });
    const sbagliati = risultato.errori.filter(
      (errore) => errore.unita === 'mm' && Math.abs(errore.ottimizzato - errore.vero) > 2,
    );
    expect(sbagliati.length).toBeGreaterThanOrEqual(3);
    for (const errore of sbagliati) {
      expect(errore.osservabile, `${errore.chiave} (errore ${(errore.ottimizzato - errore.vero).toFixed(1)} mm)`).toBe(
        false,
      );
    }
  });

  it('should still call measured what the side view fixes: the stiletto height, within 2 mm', () => {
    const { risultato } = eseguiCaso(lib, { famiglia: 'tacco', variante: 'stiletto', seme: 101 });
    const altezza = risultato.errori.find((errore) => errore.chiave === 'tacco.altezza')!;
    expect(altezza.osservabile).toBe(true);
    expect(Math.abs(altezza.ottimizzato - altezza.vero)).toBeLessThan(2);
    // The widths of the seat and of the top piece are not visible from the side: not measured.
    for (const chiave of ['seduta.larghezza', 'tappo.larghezza']) {
      expect(risultato.errori.find((errore) => errore.chiave === chiave)!.osservabile, chiave).toBe(false);
    }
  });
});
