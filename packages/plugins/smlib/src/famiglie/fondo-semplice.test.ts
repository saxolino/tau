/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { fondoSemplice } from '#famiglie/fondo-semplice.js';
import {
  lunghezzaDaTaglia,
  piantaCanonica,
  piantaDaTaglia,
  poligonoSemplice,
} from '#famiglie/fondo-pianta-canonica.js';
import { rileggiStep } from '#famiglie/verifiche-comuni.js';
import { valutaFamiglia } from '#famiglie/valuta-famiglia.js';
import type { Valutazione } from '#famiglie/valuta-famiglia.js';

// Costruzioni B-rep ripetute: sulla macchina carica una prova supera i 5 s predefiniti.
vi.setConfig({ testTimeout: 60_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const fondo = (valutazione: Valutazione, nome = 'Fondo DX'): Smlib.Part => {
  const trovato = valutazione.pezzi.find(({ name }) => name === nome);
  if (!(trovato?.shape instanceof lib.Part)) {
    throw new TypeError(`Pezzo ${nome} mancante`);
  }
  return trovato.shape;
};
const blocchi = (valutazione: Valutazione) => valutazione.esiti.filter(({ livello }) => livello === 'blocco');

/** Quota del fondo e spessore lungo la verticale per (x, y): primo e ultimo punto del solido. */
const verticale = (forma: Smlib.Part, x: number, y: number): { fondo: number; spessore: number } => {
  const colpi = forma.raycast([x, y, -50], [0, 0, 1]);
  return { fondo: colpi[0]!.point.z, spessore: colpi.at(-1)!.point.z - colpi[0]!.point.z };
};

describe('pianta canonica', () => {
  it('should give the EU 37 plan length and a simple outline of 24 points', () => {
    expect(piantaCanonica).toHaveLength(24);
    expect(poligonoSemplice(piantaCanonica)).toBe(true);
    const pianta = piantaDaTaglia(37);
    expect(pianta.lunghezza).toBeCloseTo(258.7, 1);
    expect(lunghezzaDaTaglia(42)).toBeCloseTo(292, 0);
    expect(poligonoSemplice(pianta.contorno)).toBe(true);
    const ys = pianta.contorno.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(pianta.lunghezza, 6);
    // Widths: 0.37 of the length at the ball line, 0.25 at the heel centre.
    const xs = pianta.contorno.map(([x]) => x);
    expect(Math.max(...xs) * 2).toBeCloseTo(0.37 * pianta.lunghezza, 0);
    expect(
      poligonoSemplice([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
  });
});

describe('famiglia fondo semplice', () => {
  it('should build a platform whose lowest point is the ground and whose thickness holds', () => {
    const p = fondoSemplice.normalizza({ costruzione: { lato: 'dx' } }, { variante: 'platform' });
    const valutazione = valutaFamiglia(lib, fondoSemplice, { parametri: p, variante: 'platform' });
    const pezzo = fondo(valutazione);
    expect(pezzo.isValid()).toBe(true);
    expect(pezzo.solids()).toHaveLength(1);
    // Minimum absolute of the sole on z = 0.
    expect(pezzo.bbox().min.z).toBeCloseTo(0, 3);
    // 12 mm at the heel and in the forefoot, the toe raised by its spring.
    expect(verticale(pezzo, 0, -20).fondo).toBeCloseTo(0, 3);
    expect(verticale(pezzo, 0, -20).spessore).toBeCloseTo(12, 1);
    expect(verticale(pezzo, 0, 140).spessore).toBeCloseTo(12, 1);
    const punta = verticale(pezzo, 0, 205);
    expect(punta.fondo).toBeGreaterThan(5);
    expect(punta.spessore).toBeCloseTo(12, 1);
    expect(blocchi(valutazione)).toEqual([]);
    expect(valutazione.esiti.find(({ codice }) => codice === 'GRADING')?.livello).toBe('avviso');
  });

  it('should build a wedge from 60 mm at the heel to 8 mm at the toe', () => {
    const p = fondoSemplice.normalizza({ costruzione: { lato: 'dx' } }, { variante: 'zeppa' });
    const pezzo = fondo(valutaFamiglia(lib, fondoSemplice, { parametri: p, variante: 'zeppa', verifiche: false }));
    expect(pezzo.isValid()).toBe(true);
    expect(verticale(pezzo, 0, -20).spessore).toBeCloseTo(60, 1);
    expect(verticale(pezzo, 0, 150).spessore).toBeCloseTo(8, 1);
    expect(pezzo.bbox().min.z).toBeCloseTo(0, 3);
  });

  it('should build a flat leather sole of one thickness with straight sides', () => {
    const p = fondoSemplice.normalizza({ costruzione: { lato: 'dx' } }, { variante: 'cuoio_liscio' });
    const valutazione = valutaFamiglia(lib, fondoSemplice, { parametri: p, variante: 'cuoio_liscio' });
    const pezzo = fondo(valutazione);
    expect(pezzo.isValid()).toBe(true);
    expect(verticale(pezzo, 0, 60).spessore).toBeCloseTo(4.5, 1);
    expect(valutazione.pezzi[0]?.materiale).toBe('cuoio');
    expect(blocchi(valutazione)).toEqual([]);
  });

  it('should make the pair, export to STEP and stay within the rebuild budget', () => {
    const p = fondoSemplice.predefiniti();
    fondoSemplice.costruisci(lib, p);
    let tempo = Number.POSITIVE_INFINITY;
    let pezzi = fondoSemplice.costruisci(lib, p);
    for (let giro = 0; giro < 2; giro++) {
      const inizio = performance.now();
      pezzi = fondoSemplice.costruisci(lib, p);
      tempo = Math.min(tempo, performance.now() - inizio);
    }
    expect(pezzi.map(({ name }) => name)).toEqual(['Fondo DX', 'Fondo SX']);
    expect(rileggiStep(lib, pezzi, 'fondo').esito.livello).toBe('ok');
    // oxlint-disable-next-line no-console -- the rebuild time is reported in the task notes.
    console.log(`fondo semplice (coppia): ${tempo.toFixed(0)} ms`);
    expect(tempo).toBeLessThan(1500);
  });
});
