/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { tacco } from '#famiglie/tacco.js';
import { profiloTacco, sedutaDi } from '#famiglie/tacco-profilo.js';
import type { VarianteTacco } from '#famiglie/tacco-profilo.js';
import { valoriDerivati } from '#famiglie/parametri.js';
import { facceAiPunti, pareteMinima, puntiMarcati, rileggiStep, sformo } from '#famiglie/verifiche-comuni.js';
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

const blocchi = (valutazione: Valutazione) => valutazione.esiti.filter(({ livello }) => livello === 'blocco');
const codice = (valutazione: Valutazione, cercato: string) =>
  valutazione.esiti.find(({ codice: trovato }) => trovato === cercato);

/** La quota della superficie del pezzo sotto il punto (x, y), con un raggio che scende dall'alto. */
const quotaDallAlto = (forma: Smlib.Part, x: number, y: number): number => {
  const [colpo] = forma.raycastMany([[x, y, 500]], [[0, 0, -1]]);
  if (!colpo) {
    throw new TypeError(`Nessuna superficie sotto ${x}, ${y}`);
  }
  return 500 - colpo.distance;
};

/** Larghezza del pezzo sul piano orizzontale a quota z. */
const larghezzaA = (forma: Smlib.Part, z: number): { x: number; y: number; area: number } => {
  const sezione = forma.section(lib.Plane.XY.offset(z));
  const ingombro = sezione.bbox();
  return { x: ingombro.size.x, y: ingombro.size.y, area: sezione.area };
};

describe('famiglia tacco', () => {
  it('should build an 85 mm stiletto with a 10 x 10 top lift and a steel shank under an inclined seat', () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx' } }, { variante: 'stiletto' });
    const valutazione = valutaFamiglia(lib, tacco, { parametri: p, variante: 'stiletto' });
    expect(valutazione.pezzi.map(({ name }) => name)).toEqual(['Tacco DX', 'Tappo DX', 'Anima DX']);
    const corpo = pezzo(valutazione, 'Tacco DX');
    const tappo = pezzo(valutazione, 'Tappo DX');
    const anima = pezzo(valutazione, 'Anima DX');
    for (const forma of [corpo, tappo, anima]) {
      expect(forma.isValid()).toBe(true);
      expect(forma.solids()).toHaveLength(1);
    }
    // Height from the ground to the back point of the seat, and nothing above it.
    expect(corpo.bbox().max.z).toBeCloseTo(85, 2);
    expect(tappo.bbox().min.z).toBeCloseTo(0, 6);
    expect(tappo.bbox().size.x).toBeCloseTo(10, 2);
    expect(tappo.bbox().size.y).toBeCloseTo(10, 2);
    expect(tappo.bbox().size.z).toBeCloseTo(5, 6);
    // The seat: 48 wide (the loft overshoots by tenths), 55 long along a 14° slope.
    expect(corpo.bbox().size.x).toBeGreaterThan(47.5);
    expect(corpo.bbox().size.x).toBeLessThan(49);
    const { dorso, petto } = sedutaDi(p);
    // Back point B and front point F of the seat, within the tenths the spline loft overshoots.
    expect(Math.abs(corpo.bbox().min.y - dorso[0])).toBeLessThan(0.2);
    expect(Math.abs(corpo.bbox().max.y - petto[0])).toBeLessThan(0.2);
    // The shank, from 2 mm inside the top lift to 6 mm under the seat, stays inside the body.
    expect(valoriDerivati(tacco.parametri, p)['anima.lunghezza']).toBeGreaterThan(60);
    expect(anima.bbox().min.z).toBeCloseTo(3 - 2.5 * Math.sin((3 * Math.PI) / 180), 3);
    expect(corpo.intersect(anima).volume).toBeLessThan(1e-3);
    expect(tappo.intersect(anima).volume).toBeLessThan(1e-3);
    expect(codice(valutazione, 'PERNO_PARETE')?.livello).toBe('ok');
    expect(blocchi(valutazione)).toEqual([]);
    expect(valutazione.pezzi.map(({ materiale }) => materiale)).toEqual(['abs', 'tpu', 'acciaio']);
  });

  it('should look like a stiletto from the side: thin straight shank, wide seat, arched breast', () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx', processo: 'stampa_3d_resina' } }, { variante: 'stiletto' });
    const corpo = pezzo(valutaFamiglia(lib, tacco, { parametri: p }), 'Tacco DX');
    const profilo = profiloTacco(p, 'stiletto');
    const vita = profilo.vita!;
    // The shank at half its height is a third of the seat; the v1 funnel was already half the seat there.
    const fusto = larghezzaA(corpo, (p.tappo.altezza + vita) / 2);
    expect(fusto.x).toBeLessThan(0.3 * p.seduta.larghezza);
    expect(fusto.y).toBeLessThan(0.3 * p.seduta.lunghezza);
    // The breast is an arch: just under the front of the seat the body is much shorter than the seat.
    const sottoPetto = larghezzaA(corpo, profilo.seduta.petto[1] - 5);
    expect(sottoPetto.y).toBeLessThan(0.8 * (profilo.seduta.petto[0] - profilo.seduta.dorso[0]));
    // Symmetric across x = 0 at every height: the loft does not twist.
    for (const z of [10, 30, 50, 65, 75]) {
      const { min, max } = corpo.section(lib.Plane.XY.offset(z)).bbox();
      expect(Math.abs(min.x + max.x), `z ${z}`).toBeLessThan(0.02);
    }
  });

  it('should dish the seat under the shoe: lower in the middle than at B, F and the sides', () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx', processo: 'cnc' } }, { variante: 'blocco' });
    const corpo = pezzo(valutaFamiglia(lib, tacco, { parametri: p, variante: 'blocco' }), 'Tacco DX');
    const { dorso, petto, inclinazione } = sedutaDi(p);
    const centro = (dorso[0] + petto[0]) / 2;
    const piano = dorso[1] - (centro - dorso[0]) * Math.tan(inclinazione);
    expect(quotaDallAlto(corpo, 0, centro)).toBeLessThan(piano - 3);
    expect(quotaDallAlto(corpo, 0.4 * p.seduta.larghezza, centro)).toBeGreaterThan(
      quotaDallAlto(corpo, 0, centro) + 1.5,
    );
    expect(quotaDallAlto(corpo, 0, dorso[0] + 0.5)).toBeGreaterThan(dorso[1] - 0.3);
  });

  it('should hollow the stiletto from the seat with walls of at least 2.2 mm, drafted along the seat normal', () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx' } });
    const valutazione = valutaFamiglia(lib, tacco, { parametri: p });
    const corpo = pezzo(valutazione, 'Tacco DX');
    const punti = puntiMarcati(corpo, 'cavita');
    expect(punti?.length).toBeGreaterThan(2);
    const facce = facceAiPunti(corpo, punti!);
    const parete = pareteMinima(corpo, { facce, campioniPerFaccia: 6 });
    expect(parete.min).toBeGreaterThan(2.2 * 0.98);
    expect(parete.min).toBeLessThan(3);
    const { inclinazione } = sedutaDi(p);
    const estrazione = sformo(corpo, {
      direzione: [0, Math.sin(inclinazione), Math.cos(inclinazione)],
      minimo: 1.5,
      facce,
    });
    expect(estrazione.sottosquadri).toEqual([]);
    expect(estrazione.insufficienti).toEqual([]);
    expect(codice(valutazione, 'SFORMO')?.livello).toBe('ok');
    expect(codice(valutazione, 'PARETE_MIN')?.livello).toBe('ok');
    // The hollow heel is lighter than the solid one of the same outline.
    const pieno = pezzo(
      valutaFamiglia(lib, tacco, {
        parametri: { ...p, costruzione: { ...p.costruzione, processo: 'stampa_3d_resina' } },
      }),
      'Tacco DX',
    );
    expect(corpo.volume).toBeLessThan(pieno.volume * 0.85);
  });

  it.each([
    {
      nome: '«Tacco a spillo» del 29 ottobre (v1: tromba, parete 0,01 mm, 9 facce in sottosquadro)',
      variante: 'stiletto',
      grezzi: { tacco: { altezza: 95 }, tappo: { lunghezza: 13, larghezza: 10 } },
    },
    {
      nome: '«Tacco» a blocco del 29 ottobre (v1: colonna dritta, seduta piana)',
      variante: 'blocco',
      grezzi: {
        tacco: { altezza: 94 },
        seduta: { lunghezza: 38, larghezza: 40, forma: 'rettangolo' },
        tappo: { lunghezza: 31, larghezza: 32 },
      },
    },
    {
      nome: 'stiletto alto con la seduta a 32° (la foto della Libreria)',
      variante: 'stiletto',
      grezzi: {
        tacco: { altezza: 120, spinta: 1.2 },
        seduta: { lunghezza: 51, inclinazione: 32 },
        tappo: { lunghezza: 6, larghezza: 6, altezza: 5.4 },
        vita: { quota: 0.63, scala: 0.21 },
        fronte: { bombatura: -4 },
      },
    },
    { nome: 'cono basso', variante: 'cono', grezzi: { tacco: { altezza: 35 }, seduta: { inclinazione: 4 } } },
  ] as const)('should build $nome as a valid, manufacturable pair', ({ variante, grezzi }) => {
    const valutazione = valutaFamiglia(lib, tacco, { parametri: grezzi, variante });
    const corpo = pezzo(valutazione, 'Tacco DX');
    expect(corpo.isValid()).toBe(true);
    expect(blocchi(valutazione)).toEqual([]);
    const parete = codice(valutazione, 'PARETE_MIN');
    expect(parete?.livello === 'ok' || parete?.messaggio.startsWith('Tacco pieno')).toBe(true);
    expect(valutazione.esiti.filter(({ codice: trovato }) => trovato === 'SOTTOSQUADRO')).toEqual([]);
    // The left heel is the mirror of the right one.
    expect(pezzo(valutazione, 'Tacco SX').volume).toBeCloseTo(corpo.volume, 3);
  });

  it('should build a 60 mm block heel without shank', () => {
    const p = tacco.normalizza({ costruzione: { lato: 'dx' } }, { variante: 'blocco' });
    const valutazione = valutaFamiglia(lib, tacco, { parametri: p, variante: 'blocco' });
    expect(valutazione.pezzi.map(({ name }) => name)).toEqual(['Tacco DX', 'Tappo DX']);
    const corpo = pezzo(valutazione, 'Tacco DX');
    expect(corpo.isValid()).toBe(true);
    expect(corpo.bbox().max.z).toBeCloseTo(60, 2);
    // The shield top lift: the spline through 16 points of its superellipse overshoots the flat sides by a tenth.
    expect(Math.abs(pezzo(valutazione, 'Tappo DX').bbox().size.x - 42)).toBeLessThan(0.4);
    expect(codice(valutazione, 'PARETE_MIN')?.livello).toBe('ok');
    expect(blocchi(valutazione)).toEqual([]);
  });

  it('should narrow a spool heel at its waist and open it again toward a wide top lift', () => {
    const p = tacco.normalizza(
      { seduta: { inclinazione: 0 }, costruzione: { lato: 'dx', processo: 'cnc' } },
      { variante: 'rocchetto' },
    );
    const corpo = pezzo(valutaFamiglia(lib, tacco, { parametri: p, variante: 'rocchetto' }), 'Tacco DX');
    const vita = profiloTacco(p, 'rocchetto').vita!;
    const stretta = larghezzaA(corpo, vita).x;
    expect(stretta).toBeLessThan(0.75 * p.tappo.larghezza);
    expect(larghezzaA(corpo, p.tappo.altezza + 0.5).x).toBeGreaterThan(stretta + 3);
    expect(larghezzaA(corpo, p.tacco.altezza - 8).x).toBeGreaterThan(2 * stretta);
  });

  it.each(['cono', 'kitten', 'rocchetto'] as const satisfies readonly VarianteTacco[])(
    'should build the %s variant as valid solids',
    (variante) => {
      const p = tacco.normalizza({ costruzione: { lato: 'dx' } }, { variante });
      const valutazione = valutaFamiglia(lib, tacco, { parametri: p, variante });
      for (const { shape } of valutazione.pezzi) {
        expect(shape instanceof lib.Part && shape.isValid() && shape.solids().length === 1).toBe(true);
      }
      expect(pezzo(valutazione, 'Tacco DX').bbox().max.z).toBeCloseTo(p.tacco.altezza, 2);
      expect(blocchi(valutazione)).toEqual([]);
    },
  );

  it('should build ellipse, rectangular and shield seats', () => {
    for (const forma of ['ellisse', 'rettangolo', 'scudo'] as const) {
      const p = tacco.normalizza({ seduta: { forma }, costruzione: { lato: 'dx' } });
      const valutazione = valutaFamiglia(lib, tacco, { parametri: p });
      const corpo = pezzo(valutazione, 'Tacco DX');
      expect(corpo.isValid()).toBe(true);
      expect(corpo.bbox().size.x).toBeGreaterThan(47.5);
      expect(corpo.bbox().size.x).toBeLessThan(49);
      expect(blocchi(valutazione)).toEqual([]);
    }
  });

  it('should make the left heel the mirror of the right one, side by side', () => {
    const valutazione = valutaFamiglia(lib, tacco, { parametri: tacco.predefiniti() });
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
      seduta: { inclinazione: 35 },
    });
    expect(tacco.vincoli(p)).toEqual([]);
    expect(p.tappo.lunghezza).toBeLessThanOrEqual(p.seduta.lunghezza);
    expect(p.anima.diametro).toBe(6);
    expect(p.seduta.inclinazione).toBeLessThan(35);
    expect(tacco.schema.safeParse(p).success).toBe(true);
    // The spool may narrow under its top lift, the others not.
    const rocchetto = tacco.normalizza({ vita: { scala: 0.2 }, tappo: { larghezza: 30 } }, { variante: 'rocchetto' });
    expect(rocchetto.vita.scala * rocchetto.seduta.larghezza).toBeLessThan(0.5 * rocchetto.tappo.larghezza);
  });

  it('should rebuild the pair within the rebuild budget and export it to STEP', () => {
    const p = tacco.predefiniti();
    const { tempo, valore: pezzi } = cronometra(() => tacco.costruisci(lib, p));
    expect(tempo).toBeLessThan(budgetTarato(lib));
    const { esito, corpi } = rileggiStep(lib, pezzi, 'tacco');
    expect(esito.livello).toBe('ok');
    expect(corpi).toHaveLength(6);
  });
});
