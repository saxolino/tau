/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { occhiello, volumeOcchiello } from '#famiglie/occhiello.js';
import { borchia, raggioCalotta } from '#famiglie/borchia.js';
import { rileggiStep } from '#famiglie/verifiche-comuni.js';
import { valutaFamiglia } from '#famiglie/valuta-famiglia.js';
import type { Valutazione } from '#famiglie/valuta-famiglia.js';

let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const forma = (valutazione: Valutazione, indice = 0): Smlib.Part => {
  const pezzo = valutazione.pezzi[indice];
  if (!(pezzo?.shape instanceof lib.Part)) {
    throw new TypeError('Pezzo mancante');
  }
  return pezzo.shape;
};
const blocchi = (valutazione: Valutazione) => valutazione.esiti.filter(({ livello }) => livello === 'blocco');

describe('famiglia occhiello', () => {
  it('should revolve the eyelet profile into a valid solid of the expected volume', () => {
    const p = occhiello.predefiniti();
    const valutazione = valutaFamiglia(lib, occhiello, p);
    const pezzo = forma(valutazione);
    expect(pezzo.isValid()).toBe(true);
    const { size, min, max } = pezzo.bbox();
    expect(size.x).toBeCloseTo(p.flangia.diametro, 3);
    expect(min.z).toBeCloseTo(-p.gambo.altezza, 6);
    expect(max.z).toBeCloseTo(p.flangia.spessore, 6);
    // The analytic volume less the two rounds of the flange rim (r = 0.27: 0.45 of the 0.6 sheet), (1 - pi/4) r^2 each
    // along a circle of radius ~4.5.
    const raggio = Math.min(p.flangia.raggio, 0.45 * p.flangia.spessore);
    const raccordi = 2 * (1 - Math.PI / 4) * raggio ** 2 * 2 * Math.PI * (p.flangia.diametro / 2 - raggio * 0.22);
    expect(pezzo.volume).toBeCloseTo(volumeOcchiello(p) - raccordi, 1);
    // A hole of 5 mm right through.
    expect(pezzo.contains([0, 0, 0])).toBe(false);
    expect(blocchi(valutazione)).toEqual([]);
    expect(valutazione.esiti.find(({ codice }) => codice === 'FLANGIA_FORO')?.livello).toBe('ok');
  });

  it('should add the washer and flag a deep draw', () => {
    const p = occhiello.normalizza({ rondella: { abilitata: true }, gambo: { altezza: 8 }, parete: { spessore: 0.3 } });
    const valutazione = valutaFamiglia(lib, occhiello, p);
    expect(valutazione.pezzi.map(({ name }) => name)).toEqual(['Occhiello', 'Rondella']);
    expect(forma(valutazione, 1).isValid()).toBe(true);
    expect(forma(valutazione).intersect(forma(valutazione, 1)).volume).toBeLessThan(1e-6);
    expect(valutazione.esiti.find(({ codice }) => codice === 'IMBUTITURA')?.livello).toBe('avviso');
    expect(rileggiStep(lib, valutazione.pezzi, 'occhiello').esito.livello).toBe('ok');
  });
});

describe('famiglia borchia', () => {
  it('should build a 3 mm dome head on a drafted shank', () => {
    const p = borchia.predefiniti('cupola');
    const valutazione = valutaFamiglia(lib, borchia, p, { variante: 'cupola' });
    const pezzo = forma(valutazione);
    expect(pezzo.isValid()).toBe(true);
    expect(pezzo.solids()).toHaveLength(1);
    expect(pezzo.bbox().max.z).toBeCloseTo(3, 3);
    expect(pezzo.bbox().size.x).toBeCloseTo(8, 3);
    expect(pezzo.bbox().min.z).toBeCloseTo(-6, 6);
    // The cap of a sphere: pi h^2 (3R - h) / 3 with R from the chord 8 and the height 3.
    const r = raggioCalotta(8, 3);
    const calotta = (Math.PI * 9 * (3 * r - 3)) / 3;
    expect(pezzo.section(lib.Plane.XY.offset(0.01)).area).toBeCloseTo(Math.PI * 16, 0);
    expect(pezzo.volume).toBeGreaterThan(calotta);
    expect(pezzo.volume).toBeLessThan(calotta + Math.PI * 1.25 ** 2 * 6);
    expect(blocchi(valutazione)).toEqual([]);
    expect(valutazione.esiti.find(({ codice }) => codice === 'SFORMO')?.livello).toBe('ok');
  });

  it.each(['piramide', 'piatta', 'cono'] as const)('should build the %s head', (variante) => {
    const valutazione = valutaFamiglia(lib, borchia, borchia.predefiniti(variante), { variante });
    expect(forma(valutazione).isValid()).toBe(true);
    expect(forma(valutazione).solids()).toHaveLength(1);
    expect(blocchi(valutazione)).toEqual([]);
  });

  it('should hollow a zamak head from below and keep the shank attached', () => {
    const p = borchia.normalizza({ testa: { diametro: 14, altezza: 5 }, costruzione: { cava: true } });
    const piena = forma(
      valutaFamiglia(lib, borchia, { ...p, costruzione: { ...p.costruzione, cava: false } }, { verifiche: false }),
    );
    const valutazione = valutaFamiglia(lib, borchia, p);
    expect(forma(valutazione).isValid()).toBe(true);
    expect(forma(valutazione).solids()).toHaveLength(1);
    expect(forma(valutazione).volume).toBeLessThan(piena.volume * 0.8);
    expect(valutazione.esiti.find(({ codice }) => codice === 'PARETE_MIN')?.livello).toBe('ok');
  });
});
