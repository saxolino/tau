/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { placca, trattoLato } from '#famiglie/placca.js';
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

const forma = (valutazione: Valutazione): Smlib.Part => {
  const pezzo = valutazione.pezzi[0];
  if (!(pezzo?.shape instanceof lib.Part)) {
    throw new TypeError('Placca mancante');
  }
  return pezzo.shape;
};
const codice = (valutazione: Valutazione, nome: string) => valutazione.esiti.find(({ codice: c }) => c === nome);

describe('famiglia placca', () => {
  it('should build the default zamak plate with its rim and two pins under it', () => {
    const p = placca.predefiniti();
    const valutazione = valutaFamiglia(lib, placca, { parametri: p });
    const piastra = forma(valutazione);
    expect(piastra.isValid()).toBe(true);
    expect(piastra.solids()).toHaveLength(1);
    const { min, max, size } = piastra.bbox();
    expect(size.x).toBeCloseTo(30, 3);
    expect(size.y).toBeCloseTo(12, 3);
    expect(max.z).toBeCloseTo(p.piastra.spessore + p.bordo.rilievo, 3);
    expect(min.z).toBeCloseTo(-p.fissaggio.perno.lunghezza, 3);
    // Plate, rim and pins drafted in the die: nothing below 1 degree, no undercut.
    expect(codice(valutazione, 'SFORMO')?.livello).toBe('ok');
    expect(codice(valutazione, 'SOTTOSQUADRO')).toBeUndefined();
    expect(valutazione.esiti.filter(({ livello }) => livello === 'blocco')).toEqual([]);
    expect(valutazione.pezzi[0]).toMatchObject({ name: 'Placca', materiale: 'zama', density: 6.7 });
  });

  it('should raise the text by its depth over the plate (volume of text area times depth)', () => {
    const base = placca.normalizza({ fissaggio: { tipo: 'nessuno' }, bordo: { rilievo: 0 } });
    const conTesto = placca.normalizza({
      ...base,
      testo: { ...base.testo, contenuto: 'SINOPIA', modo: 'rilievo', altezza: 5 },
    });
    const senza = forma(valutaFamiglia(lib, placca, { parametri: base, verifiche: false }));
    const valutazione = valutaFamiglia(lib, placca, { parametri: conTesto });
    const scritta = forma(valutazione);
    expect(scritta.isValid()).toBe(true);
    const { area } = lib.Text('SINOPIA', 5);
    expect(scritta.volume - senza.volume).toBeCloseTo(area * conTesto.testo.profondita, 1);
    expect(scritta.bbox().max.z).toBeCloseTo(conTesto.piastra.spessore + conTesto.testo.profondita, 3);
    // Lato letters cannot be drafted by the kernel: the check says so instead of hiding it.
    expect(codice(valutazione, 'SFORMO_TESTO')?.livello).toBe('avviso');
    expect(codice(valutazione, 'TRATTO_MIN')).toMatchObject({ livello: 'ok', valore: trattoLato * 5 });
  });

  it('should engrave the text into the plate (volume removed = text area times depth)', () => {
    const base = placca.normalizza({ fissaggio: { tipo: 'nessuno' }, bordo: { rilievo: 0 }, piastra: { spessore: 2 } });
    const incisa = placca.normalizza({
      ...base,
      testo: { ...base.testo, contenuto: 'SINOPIA', modo: 'inciso', altezza: 5, profondita: 0.5 },
    });
    const senza = forma(valutaFamiglia(lib, placca, { parametri: base, verifiche: false }));
    const valutazione = valutaFamiglia(lib, placca, { parametri: incisa });
    expect(forma(valutazione).isValid()).toBe(true);
    expect(senza.volume - forma(valutazione).volume).toBeCloseTo(lib.Text('SINOPIA', 5).area * 0.5, 1);
    expect(codice(valutazione, 'PARETE_MIN')).toMatchObject({ livello: 'ok', valore: 1.5 });
  });

  it('should measure the thinnest Lato stroke and grade small zamak lettering', () => {
    // The H crossbar is the thinnest stroke of Lato Regular: 0.099 of the cap height (stems 0.135).
    const traversa = lib.Text('H', 10).intersect(lib.Rectangle(0.01, 20)).area / 0.01;
    expect(traversa / 10).toBeCloseTo(trattoLato, 3);
    expect(lib.Text('I', 10).bbox().size.x / 10).toBeGreaterThan(trattoLato);
    const p = placca.normalizza({ testo: { contenuto: 'LOGO', altezza: 3 } });
    const tratto = codice(valutaFamiglia(lib, placca, { parametri: p }), 'TRATTO_MIN');
    expect(tratto?.livello).toBe('blocco');
    expect(tratto?.valore).toBeCloseTo(0.297, 3);
  });

  it('should shrink a text that does not fit and say so', () => {
    const p = placca.normalizza({ testo: { contenuto: 'ATELIER SINOPIA 1924', altezza: 8 } });
    const valutazione = valutaFamiglia(lib, placca, { parametri: p });
    const ridotto = codice(valutazione, 'TESTO_RIDOTTO');
    expect(ridotto?.livello).toBe('avviso');
    expect(ridotto?.valore).toBeLessThan(8);
    expect(forma(valutazione).bbox().size.x).toBeCloseTo(30, 3);
  });

  it.each(['ovale', 'cerchio', 'scudo'] as const)('should build the %s plate', (variante) => {
    const p = placca.normalizza({ testo: { contenuto: 'S' } }, { variante });
    const valutazione = valutaFamiglia(lib, placca, { parametri: p, variante });
    expect(forma(valutazione).isValid()).toBe(true);
    expect(forma(valutazione).solids()).toHaveLength(1);
    expect(valutazione.esiti.filter(({ livello }) => livello === 'blocco')).toEqual([]);
  });

  it('should dome the face, holes for rivets and stamped brass', () => {
    const bombata = valutaFamiglia(lib, placca, {
      parametri: placca.normalizza({ piastra: { bombatura: 1 }, testo: { contenuto: 'AB' } }),
    });
    expect(forma(bombata).isValid()).toBe(true);
    expect(forma(bombata).bbox().max.z).toBeGreaterThan(2.5);
    const tranciata = valutaFamiglia(lib, placca, {
      parametri: placca.normalizza({
        piastra: { spessore: 0.8 },
        bordo: { rilievo: 0 },
        fissaggio: { tipo: 'ribattini' },
        costruzione: { processo: 'tranciatura_lamiera' },
      }),
    });
    expect(forma(tranciata).isValid()).toBe(true);
    expect(tranciata.pezzi[0]?.materiale).toBe('ottone');
    expect(codice(tranciata, 'PARETE_MIN')?.livello).toBe('ok');
    expect(codice(tranciata, 'RIBATTINI')?.livello).toBe('info');
  });

  it('should cut a plate to a free outline scaled to its length and width, with the text inside', () => {
    // A cloud-like badge: eight points, any scale.
    const contorno: Array<[number, number]> = [
      [0, 10],
      [6, 8],
      [10, 4],
      [9, -3],
      [4, -8],
      [-4, -8],
      [-9, -3],
      [-10, 4],
    ];
    const p = placca.normalizza({
      piastra: { forma: 'contorno', contorno, lunghezza: 36, larghezza: 20 },
      testo: { contenuto: 'SINOPIA' },
    });
    const valutazione = valutaFamiglia(lib, placca, { parametri: p });
    const piastra = forma(valutazione);
    expect(piastra.isValid()).toBe(true);
    expect(piastra.bbox().size.x).toBeCloseTo(36, 1);
    expect(piastra.bbox().size.y).toBeCloseTo(20, 1);
    expect(valutazione.esiti.filter(({ livello }) => livello === 'blocco')).toEqual([]);
    expect(placca.emettiMain(p, {})).toContain('contorno: [[0, 10], [6, 8]');
    // A self-intersecting outline falls back to the rectangle and says so.
    const storto = placca.normalizza({
      piastra: {
        forma: 'contorno',
        contorno: [
          [0, 0],
          [10, 10],
          [10, 0],
          [0, 10],
        ],
      },
    });
    expect(codice(valutaFamiglia(lib, placca, { parametri: storto }), 'CONTORNO')?.livello).toBe('avviso');
  });

  it('should rebuild within the rebuild budget and export to STEP', () => {
    const p = placca.normalizza({ testo: { contenuto: 'SINOPIA' } });
    const { tempo, valore: pezzi } = cronometra(() => placca.costruisci(lib, p));
    expect(tempo).toBeLessThan(budgetTarato(lib));
    expect(rileggiStep(lib, pezzi, 'placca').esito.livello).toBe('ok');
  });
});

describe('logo da SVG sulla placca', () => {
  // Cornice 40 × 30 con un foro 20 × 10: area 1000 unità² (a 10 mm di larghezza: 0,25 mm per unità → 62,5 mm²).
  const cornice = '<svg viewBox="0 0 40 30"><path d="M0 0H40V30H0Z M10 10V20H30V10Z"/></svg>';
  const piana = placca.normalizza({ fissaggio: { tipo: 'nessuno' }, bordo: { rilievo: 0 } });
  const con = (logo: Partial<(typeof piana)['logo']>) =>
    placca.normalizza({ ...piana, logo: { ...piana.logo, ...logo } });

  it('should raise the logo by its depth over the plate: volume of the SVG area times depth', () => {
    const senza = forma(valutaFamiglia(lib, placca, { parametri: piana, verifiche: false }));
    const valutazione = valutaFamiglia(lib, placca, {
      parametri: con({ svg: cornice, modo: 'rilievo', larghezza: 10, profondita: 0.3 }),
    });
    const marcata = forma(valutazione);
    expect(marcata.isValid()).toBe(true);
    expect(marcata.solids()).toHaveLength(1);
    expect(marcata.volume - senza.volume).toBeCloseTo(62.5 * 0.3, 1);
    expect(marcata.bbox().max.z).toBeCloseTo(piana.piastra.spessore + 0.3, 3);
    expect(codice(valutazione, 'SFORMO_LOGO')?.livello).toBe('avviso');
    expect(codice(valutazione, 'TRATTO_MIN_LOGO')).toMatchObject({ livello: 'ok', soglia: 0.4 });
    // Il tratto della cornice: 10 unità = 2,5 mm.
    expect(codice(valutazione, 'TRATTO_MIN_LOGO')?.valore).toBeCloseTo(2.5, 1);
  });

  it('should engrave the logo: the volume goes down by area times depth, and the wall under it is checked', () => {
    const senza = forma(valutaFamiglia(lib, placca, { parametri: piana, verifiche: false }));
    const valutazione = valutaFamiglia(lib, placca, {
      parametri: con({ svg: cornice, modo: 'inciso', larghezza: 10, profondita: 0.4 }),
    });
    const incisa = forma(valutazione);
    expect(incisa.isValid()).toBe(true);
    expect(senza.volume - incisa.volume).toBeCloseTo(62.5 * 0.4, 1);
    expect(codice(valutazione, 'PARETE_MIN')).toMatchObject({ valore: piana.piastra.spessore - 0.4 });
  });

  it('should move the logo and scale it with the width', () => {
    const marcata = forma(
      valutaFamiglia(lib, placca, {
        parametri: con({ svg: cornice, larghezza: 8, x: 6, y: -1 }),
        verifiche: false,
      }),
    );
    // Il logo da 8 × 6 mm centrato in (6, −1) sporge sopra la lastra: la cima parte dal suo riquadro.
    const cima = marcata.bbox();
    expect(cima.max.z).toBeCloseTo(piana.piastra.spessore + 0.3, 3);
    expect(marcata.contains([6 - 3.9, -1, piana.piastra.spessore + 0.1])).toBe(true);
    expect(marcata.contains([-6, -1, piana.piastra.spessore + 0.1])).toBe(false);
  });

  it('should flag a stroke thinner than the process minimum', () => {
    // Barra di 100 × 1 unità a 20 mm di larghezza: 0,2 mm di tratto, sotto lo 0,4 della pressofusione.
    const sottile = '<svg viewBox="0 0 100 10"><rect x="0" y="0" width="100" height="1"/></svg>';
    const valutazione = valutaFamiglia(lib, placca, { parametri: con({ svg: sottile, larghezza: 20 }) });
    const tratto = codice(valutazione, 'TRATTO_MIN_LOGO');
    expect(tratto?.livello).toBe('blocco');
    expect(tratto?.valore).toBeCloseTo(0.2, 2);
    // Un processo meno esigente (tranciatura: 0,3) lo vede ancora sotto.
    const tranciata = valutaFamiglia(lib, placca, {
      parametri: con({ svg: sottile, larghezza: 20 }),
      processo: 'tranciatura_lamiera',
    });
    expect(codice(tranciata, 'TRATTO_MIN_LOGO')).toMatchObject({ soglia: 0.3 });
  });

  it('should refuse an open or self-intersecting SVG without breaking the plate', () => {
    const aperto = '<svg viewBox="0 0 40 30"><path d="M0 0 L40 0 L40 30"/></svg>';
    const cravatta = '<svg viewBox="0 0 40 30"><path d="M0 0 L40 30 L40 0 L0 30 Z"/></svg>';
    for (const [svg, atteso] of [
      [aperto, 'SVG_APERTO'],
      [cravatta, 'SVG_AUTOINTERSECANTE'],
    ] as const) {
      const valutazione = valutaFamiglia(lib, placca, { parametri: con({ svg }) });
      expect(codice(valutazione, atteso)?.livello).toBe('avviso');
      expect(codice(valutazione, 'TRATTO_MIN_LOGO')).toBeUndefined();
      expect(forma(valutazione).isValid()).toBe(true);
    }
  });

  it('should shrink a logo that does not fit and drop one outside the plate', () => {
    const ridotto = valutaFamiglia(lib, placca, {
      parametri: con({ svg: cornice, larghezza: 40, x: 0 }),
      verifiche: false,
    });
    expect(codice(ridotto, 'LOGO_RIDOTTO')?.livello).toBe('avviso');
    const fuori = valutaFamiglia(lib, placca, {
      parametri: con({ svg: cornice, larghezza: 10, x: 29 }),
      verifiche: false,
    });
    expect(codice(fuori, 'LOGO_FUORI')?.livello).toBe('avviso');
  });
});
