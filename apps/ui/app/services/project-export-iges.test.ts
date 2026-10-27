/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import initialize from 'libcascade/single/init';
import type { OpenCascadeInstance } from 'libcascade/init';
import type * as Smlib from '@classcad/smlibwasm';
import { preparaStep, rileggi } from '@taucad/smlib/consegna';
import { convertStepToIges } from './project-export-iges.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
let oc: OpenCascadeInstance;
let lib: typeof Smlib;
beforeAll(async () => {
  [oc, lib] = await Promise.all([
    initialize({ print: () => undefined, printErr: () => undefined }),
    import('@classcad/smlibwasm'),
  ]);
});

describe('IGES: converted by OpenCASCADE, checked by SMLib', () => {
  it('should round-trip the delivery STEP to IGES solids with the same volumes', () => {
    const placca = lib
      .Box(40, 20, 3)
      .cut(lib.Cylinder(3, 10).translate([0, 0, -2]))
      .named('Placca');
    const anello = lib.Torus(10, 1.5).translate([40, 0, 0]).named('Anello');
    const step = new TextEncoder().encode(lib.toStep([placca, anello], { name: 'assembly' }));
    const consegna = preparaStep(lib, {
      step,
      pezzi: [
        {
          nome: 'Placca',
          volumeMm3: placca.volume,
          materiale: { chiave: 'ottone', nome: 'Ottone', colore: '#b8995a' },
        },
        { nome: 'Anello', volumeMm3: anello.volume },
      ],
      progetto: 'Prova IGES',
    });
    expect(consegna.stato).toBe('verificato');
    if (consegna.stato !== 'verificato') {
      return;
    }
    const iges = convertStepToIges(oc, consegna.step);
    const testo = new TextDecoder().decode(iges);
    // IGES 5.3 fixed columns: the start section, the global section in millimetres, solids (186) in the directory.
    expect(testo.split('\n')[0]).toMatch(/S0000001\s*$/u);
    expect(testo).toMatch(/2HMM/u);
    expect(testo).toMatch(/^ {5}186 /mu);
    const esito = rileggi(lib, {
      formato: 'iges',
      file: iges,
      attesi: consegna.pezzi.map(({ nome, volumeMm3 }) => ({ nome, volumeMm3 })),
    });
    expect(esito.stato).toBe('verificato');
    if (esito.stato === 'verificato') {
      expect(esito.pezzi.map(({ nome, solidi }) => [nome, solidi]).sort()).toEqual([
        ['Anello', 1],
        ['Placca', 1],
      ]);
      const placcaLetta = esito.pezzi.find(({ nome }) => nome === 'Placca')!;
      expect(placcaLetta.volumeMm3).toBeCloseTo(placca.volume, 3);
    }
  });

  it('should refuse an IGES whose solids do not match the expected pieces', () => {
    const cubo = lib.Box(10, 10, 10).named('Cubo');
    const step = new TextEncoder().encode(lib.toStep([cubo], { name: 'Cubo', assembly: true }));
    const iges = convertStepToIges(oc, step);
    expect(
      rileggi(lib, {
        formato: 'iges',
        file: iges,
        attesi: [
          { nome: 'Cubo', volumeMm3: 1000 },
          { nome: 'Altro', volumeMm3: 8 },
        ],
      }),
    ).toMatchObject({ stato: 'da_correggere', problema: 'solids' });
    expect(rileggi(lib, { formato: 'iges', file: iges, attesi: [{ nome: 'Cubo', volumeMm3: 1200 }] })).toEqual({
      stato: 'da_correggere',
      problema: 'volume',
      pezzi: ['Cubo'],
    });
  });

  it('should throw on bytes that are not STEP rather than write an empty IGES', () => {
    expect(() => convertStepToIges(oc, new TextEncoder().encode('nulla'))).toThrow();
  });
});
