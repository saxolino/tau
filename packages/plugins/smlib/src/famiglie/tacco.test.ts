/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { cpus, loadavg } from 'node:os';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { tacco } from '#famiglie/tacco.js';
import type { VarianteTacco } from '#famiglie/tacco.js';
import { valoriDerivati } from '#famiglie/parametri.js';
import { facceAiPunti, pareteMinima, puntiMarcati, rileggiStep, sformo } from '#famiglie/verifiche-comuni.js';
import { valutaFamiglia } from '#famiglie/valuta-famiglia.js';
import type { Valutazione } from '#famiglie/valuta-famiglia.js';

// Budget di 300 ms per ricostruzione (T-D1-12): doppio in CI e con la macchina carica (altri processi in corso).
const budget = (): number => 300 * (process.env['CI'] ? 2 : 1) * (loadavg()[0]! / cpus().length > 0.8 ? 2 : 1);
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

const blocchi = (valutazione: Valutazione) => valutazione.esiti.filter(({ livello }) => livello === 'blocco');

describe('famiglia tacco', () => {
  it('should build an 85 mm stiletto with a 10 x 10 top lift and a steel shank', () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx' } }, { variante: 'stiletto' });
    const valutazione = valutaFamiglia(lib, tacco, p, { variante: 'stiletto' });
    expect(valutazione.pezzi.map(({ name }) => name)).toEqual(['Tacco DX', 'Tappo DX', 'Anima DX']);
    const corpo = pezzo(valutazione, 'Tacco DX');
    const tappo = pezzo(valutazione, 'Tappo DX');
    const anima = pezzo(valutazione, 'Anima DX');
    for (const forma of [corpo, tappo, anima]) {
      expect(forma.isValid()).toBe(true);
      expect(forma.solids()).toHaveLength(1);
    }
    // Height from the ground to the back point of the seat.
    expect(corpo.bbox().max.z).toBeCloseTo(85, 2);
    expect(tappo.bbox().min.z).toBeCloseTo(0, 6);
    expect(tappo.bbox().size.x).toBeCloseTo(10, 3);
    expect(tappo.bbox().size.y).toBeCloseTo(10, 3);
    expect(tappo.bbox().size.z).toBeCloseTo(5, 6);
    // The seat: 48 wide, 55 long (projected: the seat is tilted 6 degrees).
    expect(corpo.bbox().size.x).toBeCloseTo(48, 2);
    expect(corpo.bbox().min.y).toBeLessThan(-27.4);
    // The shank, 72 mm, enters the top lift by 2 mm and stays inside the body (a hole of 0.1 mm clearance).
    expect(valoriDerivati(tacco.parametri, p)['anima.lunghezza']).toBe(72);
    // Its axis starts 2 mm down in the top lift (z = 3), tilted forward by the 3 degree pitch.
    expect(anima.bbox().min.z).toBeCloseTo(3 - 2.5 * Math.sin((3 * Math.PI) / 180), 3);
    expect(corpo.intersect(anima).volume).toBeLessThan(1e-3);
    expect(tappo.intersect(anima).volume).toBeLessThan(1e-3);
    expect(blocchi(valutazione)).toEqual([]);
    expect(valutazione.pezzi.map(({ materiale }) => materiale)).toEqual(['abs', 'tpu', 'acciaio']);
  });

  it('should hollow the stiletto from the seat with 2.2 mm walls drafted for the core', () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx' } });
    const valutazione = valutaFamiglia(lib, tacco, p);
    const corpo = pezzo(valutazione, 'Tacco DX');
    const punti = puntiMarcati(corpo, 'cavita');
    expect(punti?.length).toBeGreaterThan(2);
    const facce = facceAiPunti(corpo, punti!);
    const parete = pareteMinima(corpo, { facce, campioniPerFaccia: 6 });
    // 2.2 mm at the stations; between them the inner and outer lofts part by up to 6 %, still above the 1.8 mm of ABS.
    expect(parete.min).toBeGreaterThan(2.2 * 0.94);
    expect(parete.min).toBeLessThan(2.6);
    const estrazione = sformo(corpo, [0, 0, 1], 1, facce);
    expect(estrazione.sottosquadri).toEqual([]);
    expect(estrazione.insufficienti).toEqual([]);
    expect(estrazione.minimo).toBeGreaterThanOrEqual(1.5 - 1e-3);
    expect(valutazione.esiti.find(({ codice }) => codice === 'SFORMO')?.livello).toBe('ok');
    expect(valutazione.esiti.find(({ codice }) => codice === 'PARETE_MIN')?.livello).toBe('ok');
    // The hollow heel is lighter than the solid one of the same outline.
    const pieno = pezzo(
      valutaFamiglia(lib, tacco, { ...p, costruzione: { ...p.costruzione, processo: 'stampa_3d_resina' } }),
      'Tacco DX',
    );
    expect(corpo.volume).toBeLessThan(pieno.volume * 0.85);
  });

  it('should build a 60 mm block heel without shank', () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx' } }, { variante: 'blocco' });
    const valutazione = valutaFamiglia(lib, tacco, p, { variante: 'blocco' });
    expect(valutazione.pezzi.map(({ name }) => name)).toEqual(['Tacco DX', 'Tappo DX']);
    const corpo = pezzo(valutazione, 'Tacco DX');
    expect(corpo.isValid()).toBe(true);
    expect(corpo.bbox().max.z).toBeCloseTo(60, 2);
    expect(pezzo(valutazione, 'Tappo DX').bbox().size.x).toBeCloseTo(42, 3);
    expect(blocchi(valutazione)).toEqual([]);
  });

  it('should narrow a spool heel to a quarter of the seat area at its waist', () => {
    const p = tacco.normalizza(
      {
        dorso: { bombatura: 0 },
        fronte: { bombatura: 0 },
        seduta: { inclinazione: 0 },
        costruzione: { lato: 'dx', processo: 'cnc' },
      },
      { variante: 'rocchetto' },
    );
    const corpo = pezzo(valutaFamiglia(lib, tacco, p, { variante: 'rocchetto' }), 'Tacco DX');
    const meta = p.tappo.altezza + p.vita.quota * (p.tacco.altezza - p.tappo.altezza);
    const vita = corpo.section(lib.Plane.XY.offset(meta)).area;
    const seduta = (Math.PI / 4) * p.seduta.lunghezza * p.seduta.larghezza;
    expect(vita / seduta).toBeCloseTo(0.25, 2);
  });

  it.each(['cono', 'kitten', 'rocchetto'] as const satisfies readonly VarianteTacco[])(
    'should build the %s variant as valid solids',
    (variante) => {
      const p = tacco.normalizza({ costruzione: { lato: 'dx' } }, { variante });
      const valutazione = valutaFamiglia(lib, tacco, p, { variante });
      for (const { shape } of valutazione.pezzi) {
        expect(shape instanceof lib.Part && shape.isValid() && shape.solids().length === 1).toBe(true);
      }
      expect(pezzo(valutazione, 'Tacco DX').bbox().max.z).toBeCloseTo(p.tacco.altezza, 2);
      expect(blocchi(valutazione)).toEqual([]);
    },
  );

  it('should build rectangular and shield seats', () => {
    for (const forma of ['rettangolo', 'scudo'] as const) {
      const p = tacco.normalizza({ seduta: { forma }, costruzione: { lato: 'dx' } });
      const valutazione = valutaFamiglia(lib, tacco, p);
      const corpo = pezzo(valutazione, 'Tacco DX');
      expect(corpo.isValid()).toBe(true);
      expect(corpo.bbox().size.x).toBeCloseTo(48, 2);
      expect(blocchi(valutazione)).toEqual([]);
    }
  });

  it('should make the left heel the mirror of the right one, side by side', () => {
    const valutazione = valutaFamiglia(lib, tacco, tacco.predefiniti());
    expect(valutazione.pezzi.map(({ name }) => name)).toEqual([
      'Tacco DX',
      'Tappo DX',
      'Anima DX',
      'Tacco SX',
      'Tappo SX',
      'Anima SX',
    ]);
    const destro = pezzo(valutazione, 'Tacco DX').bbox();
    const sinistro = pezzo(valutazione, 'Tacco SX').bbox();
    expect(sinistro.min.x).toBeCloseTo(-destro.max.x, 6);
    expect(sinistro.max.x).toBeCloseTo(-destro.min.x, 6);
    expect(sinistro.min.y).toBeCloseTo(destro.min.y, 6);
    expect(sinistro.max.z).toBeCloseTo(destro.max.z, 6);
    expect(pezzo(valutazione, 'Tacco SX').volume).toBeCloseTo(pezzo(valutazione, 'Tacco DX').volume, 3);
    expect(destro.min.x).toBeGreaterThan(0);
    // The checks find the cavity of the left heel too.
    expect(puntiMarcati(pezzo(valutazione, 'Tacco SX'), 'cavita')?.length).toBeGreaterThan(2);
    expect(blocchi(valutazione)).toEqual([]);
  });

  it('should keep the parameters inside the constraints', () => {
    const p = tacco.normalizza({
      tacco: { altezza: 40, spinta: 10 },
      tappo: { lunghezza: 80, larghezza: 9 },
      anima: { diametro: 7 },
      vita: { scala: 0.1 },
    });
    expect(tacco.vincoli(p)).toEqual([]);
    expect(p.tappo.lunghezza).toBeLessThanOrEqual(p.seduta.lunghezza);
    expect(p.anima.diametro).toBe(6);
    expect(tacco.schema.safeParse(p).success).toBe(true);
  });

  it('should rebuild the pair within the rebuild budget and export it to STEP', () => {
    const p = tacco.predefiniti();
    const { tempo, valore: pezzi } = cronometra(() => tacco.costruisci(lib, p));
    expect(tempo).toBeLessThan(budget());
    const { esito, corpi } = rileggiStep(lib, pezzi, 'tacco');
    expect(esito.livello).toBe('ok');
    expect(corpi).toHaveLength(6);
  });
});
