/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { pendente } from '#famiglie/pendente.js';
import { puntale } from '#famiglie/puntale.js';
import { facceAiPunti, pareteMinima, rileggiStep } from '#famiglie/verifiche-comuni.js';
import { valutaFamiglia } from '#famiglie/valuta-famiglia.js';
import type { Valutazione } from '#famiglie/valuta-famiglia.js';

// Costruzioni B-rep ripetute: sulla macchina carica una prova supera i 5 s predefiniti.
vi.setConfig({ testTimeout: 60_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const forma = (valutazione: Valutazione): Smlib.Part => {
  const pezzo = valutazione.pezzi[0];
  if (!(pezzo?.shape instanceof lib.Part)) {
    throw new TypeError('Pezzo mancante');
  }
  return pezzo.shape;
};
const blocchi = (valutazione: Valutazione) => valutazione.esiti.filter(({ livello }) => livello === 'blocco');

describe('famiglia pendente', () => {
  it.each(['disco', 'cuore', 'goccia', 'placchetta'] as const)(
    'should build a %s charm in one piece with its bail',
    (variante) => {
      const p = pendente.normalizza({}, { variante });
      const valutazione = valutaFamiglia(lib, pendente, { parametri: p, variante });
      const pezzo = forma(valutazione);
      expect(pezzo.isValid()).toBe(true);
      // The bail is fused: one solid.
      expect(pezzo.solids()).toHaveLength(1);
      const { min, max, size } = pezzo.bbox();
      expect(size.x).toBeCloseTo(p.corpo.larghezza, 1);
      // Body from -L/2, bail on top.
      expect(min.y).toBeCloseTo(-p.corpo.lunghezza / 2, 2);
      expect(max.y).toBeGreaterThan(p.corpo.lunghezza / 2);
      expect(max.z).toBeCloseTo(p.corpo.spessore + p.corpo.bombatura, 1);
      expect(blocchi(valutazione)).toEqual([]);
    },
  );

  it('should cross the bail and pierce a hole with a 1.2 mm bridge', () => {
    const p = pendente.normalizza({ anellino: { orientamento: 'di_traverso' }, occhiello: { foro: 1.5 } });
    const valutazione = valutaFamiglia(lib, pendente, { parametri: p });
    const pezzo = forma(valutazione);
    expect(pezzo.isValid()).toBe(true);
    expect(pezzo.solids()).toHaveLength(1);
    expect(pezzo.contains([0, 7.5 - 1.2 - 0.75, 0.6])).toBe(false);
    expect(valutazione.esiti.find(({ codice }) => codice === 'PONTE_OCCHIELLO')?.livello).toBe('ok');
    expect(rileggiStep(lib, valutazione.pezzi, 'pendente').esito.livello).toBe('ok');
  });
});

describe('famiglia puntale', () => {
  it('should build a quarter-ellipsoid brass cap of 0.6 mm sheet with two holes', () => {
    const p = puntale.predefiniti();
    const valutazione = valutaFamiglia(lib, puntale, { parametri: p });
    const pezzo = forma(valutazione);
    expect(pezzo.isValid()).toBe(true);
    expect(pezzo.solids()).toHaveLength(1);
    const { min, max } = pezzo.bbox();
    expect(min.y).toBeCloseTo(0, 3);
    expect(max.y).toBeCloseTo(25, 2);
    expect(max.z).toBeCloseTo(10, 2);
    expect(max.x - min.x).toBeCloseTo(30, 2);
    // Sheet thickness measured by rays from the inner faces.
    const interne = facceAiPunti(pezzo, [[0, 12, 9.4 * Math.sqrt(1 - (12 / 24.4) ** 2)]], 0.5);
    expect(
      pareteMinima(pezzo, { facce: interne.length > 0 ? interne : undefined, campioniPerFaccia: 6 }).min,
    ).toBeGreaterThan(0.5);
    expect(blocchi(valutazione)).toEqual([]);
    expect(valutazione.esiti.find(({ codice }) => codice === 'IMBUTITURA')?.livello).toBe('ok');
    expect(rileggiStep(lib, valutazione.pezzi, 'puntale').esito.livello).toBe('ok');
  });
});
