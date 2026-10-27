/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { anello } from '#famiglie/anello.js';
import { diametroInterno, rigaTaglia, tabellaTaglie, tagliaDaDiametro } from '#famiglie/taglie-anello.js';
import { valoriDerivati } from '#famiglie/parametri.js';
import { rileggiStep } from '#famiglie/verifiche-comuni.js';
import { budgetTarato } from '#famiglie/budget-tempo.js';
import { valutaFamiglia } from '#famiglie/valuta-famiglia.js';
import type { Valutazione } from '#famiglie/valuta-famiglia.js';

/** Il migliore di tre tempi (ms) dopo il giro a vuoto, e l'ultimo risultato. */
const cronometra = <T>(costruisci: () => T): { tempo: number; valore: T } => {
  let valore = costruisci();
  let tempo = Number.POSITIVE_INFINITY;
  for (let giro = 0; giro < 3; giro++) {
    const inizio = performance.now();
    valore = costruisci();
    tempo = Math.min(tempo, performance.now() - inizio);
  }
  return { tempo, valore };
};
// Costruzioni B-rep ripetute: sulla macchina carica una prova supera i 5 s predefiniti.
vi.setConfig({ testTimeout: 60_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const pezzo = (valutazione: Valutazione, nome: string): Smlib.Part => {
  const trovato = valutazione.pezzi.find(({ name }) => name === nome);
  if (!(trovato?.shape instanceof lib.Part)) {
    throw new TypeError(`Pezzo ${nome} mancante`);
  }
  return trovato.shape;
};
const codice = (valutazione: Valutazione, nome: string) => valutazione.esiti.find(({ codice: c }) => c === nome);

describe('taglie degli anelli', () => {
  it('should convert IT, US and ISO sizes to the inner diameter', () => {
    expect(diametroInterno('it', 14)).toBeCloseTo(17.19, 2);
    expect(Math.abs(diametroInterno('us', 7) - 17.35)).toBeLessThan(0.05);
    expect(diametroInterno('eu_iso', 54)).toBeCloseTo(17.19, 2);
    expect(diametroInterno('diametro', 18)).toBe(18);
    expect(tagliaDaDiametro('it', 17.19)).toBe(14);
    expect(tagliaDaDiametro('us', 17.32)).toBe(7);
    expect(tagliaDaDiametro('eu_iso', 17.19)).toBe(54);
  });
});

describe('famiglia anello', () => {
  it('should build an IT 14 ring with a 4-prong head and a 5 mm stone', () => {
    const p = anello.predefiniti();
    const valutazione = valutaFamiglia(lib, anello, { parametri: p });
    expect(valutazione.pezzi.map(({ name }) => name)).toEqual(['Anello', 'Pietra']);
    const metallo = pezzo(valutazione, 'Anello');
    expect(metallo.isValid()).toBe(true);
    expect(metallo.solids()).toHaveLength(1);
    expect(valoriDerivati(anello.parametri, p)['taglia.diametroInterno']).toBeCloseTo(17.19, 2);
    // The finger hole: a ray along X from the axis meets the band at the inner radius.
    const raggio = 17.19 / 2;
    expect(metallo.contains([0, 0, 0])).toBe(false);
    expect(metallo.contains([raggio + 0.3, 0, 0])).toBe(true);
    expect(metallo.contains([raggio - 0.05, 0, 0])).toBe(false);
    // The band tapers: thinner at the bottom (-Z) than at the sides.
    expect(metallo.contains([0, 0, -(raggio + 1.8 * 0.8 + 0.05)])).toBe(false);
    expect(metallo.contains([0, 0, -(raggio + 1.8 * 0.8 - 0.1)])).toBe(true);
    // The prongs bite the girdle by 0.1 mm (the seat the setter cuts); nothing else touches the stone.
    const pietra = pezzo(valutazione, 'Pietra');
    const presa = metallo.intersect(pietra).volume;
    expect(presa).toBeGreaterThan(0);
    expect(presa).toBeLessThan(1);
    expect(valutazione.esiti.filter(({ livello }) => livello === 'blocco')).toEqual([]);
    expect(codice(valutazione, 'TAGLIA')?.messaggio).toContain('IT 14');
    // Weight of the 18 kt gold only.
    const pesi = valutazione.esiti.filter(({ codice: c }) => c === 'PESO');
    const oro = (metallo.volume * 15.5) / 1000;
    expect(pesi.find(({ pezzo: nome }) => nome === 'Anello')?.valore).toBeCloseTo(oro, 6);
    expect(pesi.find(({ pezzo: nome }) => nome === undefined)?.valore).toBeCloseTo(oro, 6);
    expect(pesi.some(({ pezzo: nome }) => nome === 'Pietra')).toBe(false);
  });

  it.each([4, 6])('should build %i prongs', (numero) => {
    const p = anello.normalizza({ griffe: { numero } });
    const metallo = pezzo(valutaFamiglia(lib, anello, { parametri: p, verifiche: false }), 'Anello');
    expect(metallo.isValid()).toBe(true);
    // Count the prong tips cut by a plane just under their tops (the girdle is 0.2 mm above the band + pavilion).
    const cintura = 17.19 / 2 + 1.8 + 0.2 + 0.43 * 5;
    const quota = cintura + 0.8 - 0.6;
    expect(metallo.section(lib.Plane.XY.offset(quota)).faces()).toHaveLength(numero);
  });

  it('should seat the stone in a closed bezel and block a pavilion that pokes out', () => {
    const chiuso = valutaFamiglia(lib, anello, { parametri: anello.predefiniti('chiuso'), variante: 'chiuso' });
    expect(pezzo(chiuso, 'Anello').isValid()).toBe(true);
    expect(codice(chiuso, 'PIETRA_BUCA_FONDO')?.livello).toBe('ok');
    // The prong gallery rises so that the pavilion tip clears the band: no warning for the default stone.
    expect(codice(valutaFamiglia(lib, anello, { parametri: anello.predefiniti() }), 'PIETRA_BUCA_FONDO')?.livello).toBe(
      'ok',
    );
  });

  it('should build a plain band of every profile, revolved when it does not taper', () => {
    for (const profilo of ['tondo', 'piatto', 'd', 'comfort'] as const) {
      const p = anello.normalizza({ gambo: { profilo, rastremazione: 1 } }, { variante: 'fascia' });
      const valutazione = valutaFamiglia(lib, anello, { parametri: p, variante: 'fascia' });
      expect(valutazione.pezzi).toHaveLength(1);
      expect(pezzo(valutazione, 'Anello').isValid()).toBe(true);
    }
  });

  it('should rebuild within the rebuild budget and export to STEP', () => {
    const p = anello.predefiniti();
    const { tempo, valore: pezzi } = cronometra(() => anello.costruisci(lib, p));
    expect(tempo).toBeLessThan(budgetTarato(lib));
    expect(rileggiStep(lib, pezzi, 'anello').esito.livello).toBe('ok');
  });
});

describe('tabella delle taglie degli anelli', () => {
  it('should match published values in every system', () => {
    // ISO 8653: la taglia è la circonferenza interna; IT = circonferenza − 40; US 0,8128 mm di diametro per taglia.
    expect(diametroInterno('eu_iso', 44)).toBeCloseTo(14.01, 2);
    expect(diametroInterno('eu_iso', 62)).toBeCloseTo(19.74, 2);
    expect(diametroInterno('it', 8)).toBeCloseTo(15.28, 2);
    expect(diametroInterno('it', 24)).toBeCloseTo(20.37, 2);
    for (const [us, pubblicato] of [
      [5, 15.7],
      [7, 17.3],
      [9, 18.9],
      [10, 19.8],
    ] as const) {
      expect(Math.abs(diametroInterno('us', us) - pubblicato)).toBeLessThan(0.1);
    }
  });

  it('should list every allowed size of a system, growing, each read in all systems', () => {
    const italiane = tabellaTaglie('it');
    expect(italiane).toHaveLength(35);
    expect(italiane[0]!.valore).toBe(1);
    expect(italiane.at(-1)!.valore).toBe(35);
    const us = tabellaTaglie('us');
    expect(us).toHaveLength(25);
    expect(us.map(({ valore }) => valore).slice(0, 3)).toEqual([3, 3.5, 4]);
    for (const tabella of [italiane, us, tabellaTaglie('eu_iso'), tabellaTaglie('diametro')]) {
      for (const [indice, riga] of tabella.entries()) {
        if (indice > 0) {
          expect(riga.diametro).toBeGreaterThan(tabella[indice - 1]!.diametro);
        }
        expect(riga.circonferenza).toBeCloseTo(riga.diametro * Math.PI, 6);
      }
    }
    const riga = rigaTaglia('it', 14);
    expect(riga).toMatchObject({ it: 14, eu_iso: 54 });
    expect(riga.us).toBe(7);
    expect(riga.circonferenza).toBeCloseTo(54, 6);
  });
});
