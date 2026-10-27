// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { costruisciSerie, csvSerie, esportaSerieStep, riepilogoSerie } from '#serie/costruzione.js';
import { asseDellaSerie, famiglieConSerie, pianoSerie, regoleDiCrescita } from '#serie/piano.js';

vi.setConfig({ testTimeout: 120_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const crescente = (valori: readonly number[]): boolean => valori.every((v, i) => i === 0 || v > valori[i - 1]!);
const misura = (voce: { misure: ReadonlyArray<{ id: string; valore: number }> }, id: string): number =>
  voce.misure.find((m) => m.id === id)!.valore;

describe('piano della serie', () => {
  it('should list the families that have a series and their growth rules', () => {
    expect(famiglieConSerie).toEqual(expect.arrayContaining(['anello', 'fondo_semplice', 'tacco']));
    expect(regoleDiCrescita('anello').some(({ chiave }) => chiave === 'gambo.spessore')).toBe(true);
    expect(regoleDiCrescita('fibbia')).toEqual([]);
    expect(asseDellaSerie('anello', { sistema: 'us' })?.intervallo).toEqual([3, 15]);
    expect(asseDellaSerie('fibbia')).toBeUndefined();
  });

  it('should plan a ring series IT 8–24 with growing diameter and the rules applied from the base', () => {
    const piano = pianoSerie({ famiglia: 'anello', variante: 'fascia', da: 8, a: 24, sistema: 'it' });
    expect(piano.voci).toHaveLength(17);
    expect(piano.voci[0]!.etichetta).toBe('IT 8');
    expect(piano.voci.at(-1)!.etichetta).toBe('IT 24');
    expect(crescente(piano.voci.map((voce) => misura(voce, 'diametro')))).toBe(true);
    expect(crescente(piano.voci.map((voce) => misura(voce, 'gamboSpessore')))).toBe(true);
    // La taglia del base (IT 14) conserva le misure del base: le regole sono relative ad essa.
    const base = piano.voci.find((voce) => voce.valore === 14)!;
    expect(misura(base, 'gamboSpessore')).toBe(1.8);
    expect(misura(base, 'gamboLarghezza')).toBe(3);
    expect(misura(piano.voci[0]!, 'it')).toBe(8);
    expect(misura(piano.voci[0]!, 'diametro')).toBeCloseTo(15.28, 2);
    expect(new Set(piano.voci.map(({ nomeFile }) => nomeFile)).size).toBe(17);
  });

  it('should convert the base to the series system and refuse an empty or out-of-range series', () => {
    const piano = pianoSerie({ famiglia: 'anello', da: 5, a: 7, sistema: 'us', passo: 1 });
    expect(piano.voci.map(({ etichetta }) => etichetta)).toEqual(['US 5', 'US 6', 'US 7']);
    expect(() => pianoSerie({ famiglia: 'anello', da: 24, a: 8 })).toThrow(RangeError);
    expect(() => pianoSerie({ famiglia: 'anello', da: 1, a: 99 })).toThrow(RangeError);
    expect(() => pianoSerie({ famiglia: 'fibbia' })).toThrow(RangeError);
    expect(() => pianoSerie({ famiglia: 'fondo_semplice', da: 35, a: 47, passo: 0.1 })).toThrow(RangeError);
  });

  it('should keep the ratios of a sole fixed while its width follows the length', () => {
    const piano = pianoSerie({ famiglia: 'fondo_semplice', da: 35, a: 42 });
    expect(piano.voci.map(({ valore }) => valore)).toEqual([35, 36, 37, 38, 39, 40, 41, 42]);
    expect(crescente(piano.voci.map((voce) => misura(voce, 'lunghezza')))).toBe(true);
    expect(crescente(piano.voci.map((voce) => misura(voce, 'larghezzaPianta')))).toBe(true);
    const rapporti = new Set(
      piano.voci.map((voce) => (misura(voce, 'larghezzaPianta') / misura(voce, 'lunghezza')).toFixed(2)),
    );
    expect(rapporti.size).toBe(1);
    // EU 38 = 38 × 6,667 + 12 = 265,3 mm (ipotesi dichiarata della famiglia).
    expect(misura(piano.voci[3]!, 'lunghezza')).toBeCloseTo(265.35, 1);
  });

  it('should plan a heel series on its height', () => {
    const piano = pianoSerie({ famiglia: 'tacco', da: 60, a: 100, passo: 20 });
    expect(piano.voci.map(({ etichetta }) => etichetta)).toEqual(['60 mm', '80 mm', '100 mm']);
  });
});

describe('serie costruita', () => {
  it('should build a ring series with growing volume and weight and a CSV table', () => {
    const piano = pianoSerie({ famiglia: 'anello', variante: 'fascia', da: 8, a: 24, passo: 4, sistema: 'it' });
    const riepilogo = riepilogoSerie(lib, piano);
    expect(riepilogo.righe).toHaveLength(5);
    expect(riepilogo.righe.every((riga) => riga.costruita)).toBe(true);
    expect(crescente(riepilogo.righe.map((riga) => riga.volumeMm3!))).toBe(true);
    expect(crescente(riepilogo.righe.map((riga) => riga.pesoGrammi!))).toBe(true);
    // Fascia IT 14 (⌀ 17,19) di oro 18 kt (15,5 g/cm³): decine di millimetri cubi → qualche grammo.
    expect(riepilogo.righe[2]!.pesoGrammi).toBeGreaterThan(1);
    expect(riepilogo.righe[2]!.pesoGrammi).toBeLessThan(10);
    const righe = csvSerie(riepilogo).split('\n');
    expect(righe).toHaveLength(6);
    expect(righe[0]).toContain('Taglia IT');
    expect(righe[0]).toContain('Peso (g)');
    expect(righe[1]!.startsWith('IT 8;')).toBe(true);
  });

  it('should build a sole series EU 35–42 (step 3) with growing volume and weight', () => {
    const riepilogo = riepilogoSerie(lib, pianoSerie({ famiglia: 'fondo_semplice', da: 35, a: 41, passo: 3 }));
    expect(riepilogo.righe.map(({ etichetta }) => etichetta)).toEqual(['EU 35', 'EU 38', 'EU 41']);
    expect(crescente(riepilogo.righe.map((riga) => riga.volumeMm3!))).toBe(true);
    expect(crescente(riepilogo.righe.map((riga) => riga.pesoGrammi!))).toBe(true);
  });

  it('should build a heel series with growing volume', () => {
    const riepilogo = riepilogoSerie(lib, pianoSerie({ famiglia: 'tacco', da: 60, a: 100, passo: 40 }));
    expect(riepilogo.righe.every((riga) => riga.costruita)).toBe(true);
    expect(crescente(riepilogo.righe.map((riga) => riga.volumeMm3!))).toBe(true);
  });

  it('should hand the live pieces and a STEP file per size to the export', () => {
    const piano = pianoSerie({ famiglia: 'anello', variante: 'fascia', da: 12, a: 14, passo: 2, sistema: 'it' });
    lib.scope(() => {
      const modelli = costruisciSerie(lib, piano);
      expect(modelli.map(({ voce }) => voce.nomeFile)).toEqual(piano.voci.map(({ nomeFile }) => nomeFile));
      expect(modelli.every(({ pezzi }) => pezzi.length > 0)).toBe(true);
    });
    const { file, saltate } = esportaSerieStep(lib, piano);
    expect(saltate).toEqual([]);
    expect(file.map(({ nome }) => nome)).toEqual(piano.voci.map(({ nomeFile }) => nomeFile));
    for (const { step } of file) {
      expect(step).toContain('ISO-10303-21');
      expect(lib.fromStep(step)).toBeDefined();
    }
  });
});
