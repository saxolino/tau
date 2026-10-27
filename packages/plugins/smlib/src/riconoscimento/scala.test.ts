// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MascheraBinaria } from '#riconoscimento/scala.js';
import {
  asseDaCosa,
  estensioneMaschera,
  larghezzaForoInterno,
  lunghezzaPiantaDaTaglia,
  pxPerMmDaMisura,
  scegliScala,
} from '#riconoscimento/scala.js';

/** A 300×200 picture with a filled rectangle of 200×100 px at (50, 50); optionally a hole. */
const rettangolo = (foro?: { x0: number; y0: number; x1: number; y1: number }): MascheraBinaria => {
  const larghezza = 300;
  const altezza = 200;
  const dati = new Uint8Array(larghezza * altezza);
  for (let y = 50; y < 150; y++) {
    for (let x = 50; x < 250; x++) {
      const nelForo = foro !== undefined && x >= foro.x0 && x < foro.x1 && y >= foro.y0 && y < foro.y1;
      dati[y * larghezza + x] = nelForo ? 0 : 1;
    }
  }
  return { larghezza, altezza, dati };
};

describe('stima della scala', () => {
  it('should measure 4 px/mm on a 200×100 px rectangle for 50 mm of width and 25 mm of height', () => {
    const maschera = rettangolo();
    expect(estensioneMaschera(maschera)).toStrictEqual({
      x0: 50,
      y0: 50,
      x1: 249,
      y1: 149,
      larghezza: 200,
      altezza: 100,
    });
    expect(pxPerMmDaMisura(maschera, { valoreMm: 50, cosa: 'larghezza' })).toBe(4);
    expect(pxPerMmDaMisura(maschera, { valoreMm: 25, cosa: 'altezza tacco' })).toBe(4);
    expect(pxPerMmDaMisura(maschera, { valoreMm: 50, cosa: '⌀' })).toBe(4);
    expect(
      pxPerMmDaMisura({ larghezza: 2, altezza: 2, dati: new Uint8Array(4) }, { valoreMm: 5, cosa: 'x' }),
    ).toBeUndefined();
  });

  it('should read the axis of a measure from its words', () => {
    expect(asseDaCosa('Altezza tacco')).toBe('verticale');
    expect(asseDaCosa('inner_width_mm')).toBe('orizzontale');
    expect(asseDaCosa('luce')).toBe('orizzontale');
    expect(asseDaCosa('diametro')).toBe('lungo');
  });

  it('should find the width of the inner hole of a buckle mask and ignore the outside', () => {
    expect(larghezzaForoInterno(rettangolo())).toBeUndefined();
    expect(larghezzaForoInterno(rettangolo({ x0: 90, y0: 70, x1: 170, y1: 130 }))).toBe(80);
  });

  it('should pick the first available source in the order misura, libreria, catalogo, taglia, forma', () => {
    const maschera = rettangolo({ x0: 90, y0: 70, x1: 170, y1: 130 });
    const tutte = {
      misura: { valoreMm: 50, cosa: 'larghezza' },
      libreria: { larghezzaMm: 40 },
      catalogo: { valoreMm: 20, cosa: 'inner_width_mm' },
      taglia: { taglia: 37, lunghezzaPx: 500 },
      forma: { lunghezzaPiedeMm: 260 },
    };
    expect(scegliScala(tutte, maschera)).toStrictEqual({
      tipo: 'misura',
      valoreMm: 50,
      cosa: 'larghezza',
      pxPerMm: 4,
      confidenza: 0.95,
    });
    const { misura: _misura, ...senzaMisura } = tutte;
    expect(scegliScala(senzaMisura, maschera)).toMatchObject({ tipo: 'libreria', pxPerMm: 5, confidenza: 0.9 });
    const { libreria: _libreria, ...soloCatalogo } = senzaMisura;
    // The inner width of the catalogue is read on the hole (80 px / 20 mm), not on the outside.
    expect(scegliScala(soloCatalogo, maschera)).toMatchObject({ tipo: 'catalogo', pxPerMm: 4, confidenza: 0.9 });
    const { catalogo: _catalogo, ...soloTaglia } = soloCatalogo;
    expect(scegliScala(soloTaglia)).toMatchObject({ tipo: 'taglia', valoreMm: 258.7, confidenza: 0.6 });
    expect(scegliScala({ forma: { lunghezzaPiedeMm: 272 } })).toMatchObject({ tipo: 'forma', valoreMm: 272 });
    expect(scegliScala({})).toBeUndefined();
  });

  it('should turn a size into the length of the sole plan', () => {
    expect(lunghezzaPiantaDaTaglia(37)).toBeCloseTo(258.68, 2);
    expect(lunghezzaPiantaDaTaglia(42)).toBeCloseTo(292.01, 2);
  });
});
