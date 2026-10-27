/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { disegniTavola, nomeProdotto, pezzoPiano, preparaDxf, preparaStep, rileggi } from '#consegna/funzioni.js';
import type { PezzoConsegna } from '#consegna/tipi.js';
import { sfoltisciPercorso, spezzaPercorso } from '#consegna/percorsi.js';

vi.setConfig({ testTimeout: 60_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const ottone = { chiave: 'ottone', nome: 'Ottone', colore: '#b8995a' } as const;

/** Una placca 40 × 20 × 3 con un foro passante da 6 e un cubo da 10, come il kernel li scrive: un prodotto, solidi nominati. */
const modello = (): { step: Uint8Array<ArrayBuffer>; placca: Smlib.Part; cubo: Smlib.Part } => {
  const placca = lib
    .Box(40, 20, 3)
    .cut(lib.Cylinder(3, 10).translate([0, 0, -2]))
    .named('Placca');
  const cubo = lib.Box(10, 10, 10).translate([30, 0, 5]).named('Cubo è');
  const step = new TextEncoder().encode(lib.toStep([placca, cubo], { name: 'assembly' }));
  return { step, placca, cubo };
};

const pezziDi = (placca: Smlib.Part, cubo: Smlib.Part): PezzoConsegna[] => [
  { nome: 'Placca', volumeMm3: placca.volume, materiale: ottone },
  { nome: 'Cubo è', volumeMm3: cubo.volume },
];

describe('STEP da consegnare, scritto e riletto da SMLib', () => {
  it('should rewrite one product per piece with its material and verify the bytes read back', () => {
    const { step, placca, cubo } = modello();
    const esito = preparaStep(lib, { step, pezzi: pezziDi(placca, cubo), progetto: 'Fibbia «prova»' });
    expect(esito.stato).toBe('verificato');
    if (esito.stato !== 'verificato') {
      return;
    }
    expect(esito.pezzi.map(({ nome, prodotto, solidi, valido }) => [nome, prodotto, solidi, valido])).toEqual([
      ['Placca', 'Placca · Ottone', 1, true],
      ['Cubo è', 'Cubo è', 1, true],
    ]);
    expect(esito.pezzi[0]!.volumeMm3).toBeCloseTo(40 * 20 * 3 - Math.PI * 9 * 3, 6);
    expect(esito.pezzi[1]!.ingombro).toEqual([10, 10, 10]);
    // Plate −20..20 and cube 25..35 on X; −10..10 on Y; plate −1,5..1,5 and cube 0..10 on Z.
    expect(esito.ingombro.map((valore) => Math.round(valore * 1000) / 1000)).toEqual([55, 20, 11.5]);
    // The file itself: an assembly named after the project, a product per piece, the brass colour on the plate.
    const testo = new TextDecoder().decode(esito.step);
    expect(testo).toMatch(/PRODUCT\('Placca \\X2\\00B7\\X0\\ Ottone'/u);
    expect(testo).toMatch(/COLOUR_RGB\('',0\.72156862745098\d*,0\.6\d*,0\.35294117647058\d*\)/u);
    // Read back independently of the function: two parts, same volumes.
    const letti = [...(lib.fromStep(esito.step) as Smlib.ShapeList<Smlib.Part>)];
    expect(letti).toHaveLength(2);
    expect(letti.map((parte) => parte.volume).sort((a, b) => a - b)[1]).toBeCloseTo(placca.volume, 6);
  });

  it('should deliver only the chosen piece, read back on its own', () => {
    const { step, placca, cubo } = modello();
    const esito = preparaStep(lib, {
      step,
      pezzi: pezziDi(placca, cubo),
      selezionati: ['Cubo è'],
      progetto: 'Prova',
    });
    expect(esito.stato).toBe('verificato');
    if (esito.stato === 'verificato') {
      expect(esito.pezzi.map(({ nome }) => nome)).toEqual(['Cubo è']);
      expect(lib.fromStep(esito.step)).toBeInstanceOf(lib.Part);
    }
  });

  it('should refuse a volume that differs from the Measures, naming the piece', () => {
    const { step, placca, cubo } = modello();
    const pezzi = pezziDi(placca, cubo).map((pezzo) =>
      pezzo.nome === 'Placca' ? { ...pezzo, volumeMm3: 40 * 20 * 3 } : pezzo,
    );
    expect(preparaStep(lib, { step, pezzi, progetto: 'Prova' })).toEqual({
      stato: 'da_correggere',
      problema: 'volume',
      pezzi: ['Placca'],
    });
  });

  it('should refuse missing and unknown names, an unknown selection and bytes that are not STEP', () => {
    const { step, placca, cubo } = modello();
    expect(
      preparaStep(lib, { step, pezzi: [{ nome: 'Placca' }, { nome: 'Telaio' }], progetto: 'Prova' }),
    ).toMatchObject({ stato: 'da_correggere', problema: 'names', pezzi: ['Telaio', 'Cubo è'] });
    expect(
      preparaStep(lib, { step, pezzi: pezziDi(placca, cubo), selezionati: ['Nessuno'], progetto: 'Prova' }),
    ).toEqual({ stato: 'da_correggere', problema: 'selection' });
    expect(
      preparaStep(lib, { step: new TextEncoder().encode('non è uno STEP'), pezzi: [], progetto: 'Prova' }),
    ).toEqual({ stato: 'da_correggere', problema: 'read' });
  });

  it('should refuse two solids under one piece name', () => {
    const doppio = lib
      .Box(5, 5, 5)
      .fuse(lib.Box(5, 5, 5).translate([20, 0, 0]))
      .named('Doppio');
    const step = new TextEncoder().encode(lib.toStep([doppio], { name: 'assembly' }));
    expect(preparaStep(lib, { step, pezzi: [{ nome: 'Doppio' }], progetto: 'Prova' })).toEqual({
      stato: 'da_correggere',
      problema: 'solids',
      pezzi: ['Doppio'],
    });
  });
});

describe('IGES riletto da SMLib', () => {
  it('should refuse bytes that are not IGES and accept nothing it cannot read', () => {
    expect(
      rileggi(lib, { formato: 'iges', file: new TextEncoder().encode('nulla'), attesi: [{ nome: 'A', volumeMm3: 1 }] }),
    ).toEqual({ stato: 'da_correggere', problema: 'read' });
  });
});

describe('DXF per la fabbrica', () => {
  it('should give the true-size outline of a flat plate: four lines, one circle, two closed chains', () => {
    const { step, placca, cubo } = modello();
    const esito = preparaDxf(lib, { step, pezzi: pezziDi(placca, cubo), selezionati: ['Placca'] });
    expect(esito).toMatchObject({ stato: 'verificato', modo: 'contorno', contorni: 2, entita: 5 });
    if (esito.stato !== 'verificato') {
      return;
    }
    expect(esito.dxf.match(/\nLINE\r?\n/gu)).toHaveLength(4);
    expect(esito.dxf.match(/\nCIRCLE\r?\n/gu)).toHaveLength(1);
    // Model coordinates, millimetres: the outline is the 40 × 20 rectangle around the origin, the hole Ø 6.
    const catene = [...lib.fromDxfWires(esito.dxf)];
    const esterno = catene.map((catena) => catena.bbox()).find(({ max }) => max.x > 10)!;
    expect([esterno.min.x, esterno.min.y, esterno.max.x, esterno.max.y]).toEqual([-20, -10, 20, 10]);
    const foro = catene.map((catena) => catena.bbox()).find(({ max }) => max.x < 10)!;
    expect(foro.max.x - foro.min.x).toBeCloseTo(6, 9);
    expect(esito.dxf).toMatch(/\$INSUNITS\r?\n\s*70\r?\n\s*4/u);
  });

  it('should draw the three views with dashed hidden lines when a piece is not flat', () => {
    const { step, placca, cubo } = modello();
    const esito = preparaDxf(lib, { step, pezzi: pezziDi(placca, cubo) });
    expect(esito).toMatchObject({ stato: 'verificato', modo: 'viste' });
    if (esito.stato === 'verificato') {
      expect(esito.dxf).toContain('HIDDEN');
      expect(esito.dxf).toContain('DASHED');
      expect(esito.entita).toBeGreaterThan(10);
    }
  });

  it('should call flat a plate, a sole and a declared stamped part, not a cube or a pin', () => {
    expect(pezzoPiano([40, 20, 3])).toBe(true);
    expect(pezzoPiano([260, 90, 12])).toBe(true);
    expect(pezzoPiano([10, 10, 10])).toBe(false);
    expect(pezzoPiano([2, 30, 2])).toBe(false);
    expect(pezzoPiano([10, 10, 10], true)).toBe(true);
  });
});

describe('disegni della tavola', () => {
  it('should give front, left, top in first angle with hidden lines, an isometric view and the overall size', () => {
    const { step } = modello();
    const esito = disegniTavola(lib, { step });
    expect(esito.stato).toBe('pronto');
    if (esito.stato !== 'pronto') {
      return;
    }
    expect(esito.viste.map(({ nome }) => nome)).toEqual(['front', 'left', 'top', 'iso']);
    for (const vista of esito.viste) {
      expect(vista.visibili).toMatch(/^M-?\d/u);
      expect(vista.riquadro.larghezza).toBeGreaterThan(0);
    }
    // The hole is hidden in the front view of the plate; the iso has no hidden lines.
    expect(esito.viste[0]!.nascoste.length).toBeGreaterThan(0);
    expect(esito.viste[3]!.nascoste).toBe('');
    // Plate from −20 to 20, cube from 25 to 35 on X; plate −10..10 on Y; cube 0..10 over the plate's −1,5 on Z.
    expect(esito.ingombro.map((valore) => Math.round(valore * 1000) / 1000)).toEqual([55, 20, 11.5]);
    expect(esito.pezzi.map(({ nome }) => nome)).toEqual(['Placca', 'Cubo è']);
    expect(esito.viste[0]!.riquadro.larghezza).toBeCloseTo(55, 6);
  });

  it('should draw only the chosen piece', () => {
    const { step } = modello();
    const esito = disegniTavola(lib, { step, selezionati: ['Cubo è'] });
    expect(esito).toMatchObject({ stato: 'pronto', ingombro: [10, 10, 10] });
    expect(disegniTavola(lib, { step, selezionati: ['Nessuno'] })).toEqual({
      stato: 'da_correggere',
      problema: 'selection',
    });
  });

  it('should name a product after its piece and material', () => {
    expect(nomeProdotto({ nome: 'Telaio fibbia', materiale: ottone })).toBe('Telaio fibbia · Ottone');
    expect(nomeProdotto({ nome: 'Ardiglione' })).toBe('Ardiglione');
  });
});

describe('percorsi leggeri per la tavola', () => {
  it('should thin a dense polyline within tolerance and keep lines, arcs and closures exact', () => {
    // A quarter circle of radius 10 drawn as 2001 points, then an exact arc and a closed square.
    const punti = Array.from({ length: 2001 }, (_valore, indice) => {
      const angolo = (indice / 2000) * (Math.PI / 2);
      return `${indice === 0 ? 'M' : 'L'}${(10 * Math.cos(angolo)).toFixed(6)} ${(10 * Math.sin(angolo)).toFixed(6)}`;
    });
    const denso = `${punti.join(' ')} A10 10 0 0 1 -10 0 M20 0 L30 0 L30 10 L20 10 Z`;
    const leggero = sfoltisciPercorso(denso, 0.01);
    expect(leggero.length).toBeLessThan(denso.length / 20);
    expect(leggero).toContain('A10 10 0 0 1 -10 0');
    expect(leggero).toContain('M20 0 L30 0 L30 10 L20 10 Z');
    // Every kept point lies on the circle; the chord error stays within the tolerance.
    const tenuti = [...leggero.split(' A')[0]!.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/gu)].map(([, x, y]) => [
      Number(x),
      Number(y),
    ]);
    expect(tenuti.length).toBeGreaterThan(10);
    for (const [x, y] of tenuti) {
      expect(Math.hypot(x!, y!)).toBeCloseTo(10, 3);
    }
    const passo = Math.PI / 2 / (tenuti.length - 1);
    expect(10 * (1 - Math.cos(passo / 2))).toBeLessThan(0.02);
  });

  it('should leave a path it cannot read as it is, and split long paths at moves', () => {
    expect(sfoltisciPercorso('M0 0 C1 1 2 2 3 3', 0.1)).toBe('M0 0 C1 1 2 2 3 3');
    const lungo = Array.from({ length: 1000 }, (_valore, indice) => `M${String(indice)} 0 L${String(indice)} 1`).join(
      ' ',
    );
    const pezzi = spezzaPercorso(lungo, 500);
    expect(pezzi.length).toBeGreaterThan(10);
    expect(pezzi.every((pezzo) => pezzo.startsWith('M') && pezzo.length <= 500)).toBe(true);
    expect(pezzi.join(' ')).toBe(lungo);
    expect(spezzaPercorso('')).toEqual([]);
  });
});
