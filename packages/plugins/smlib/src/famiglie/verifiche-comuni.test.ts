/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (processi, materiali, varianti, taglie): snake_case come in Sinopia. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import type { DefinizioneParametro, ParametriAnnidati } from '#famiglie/famiglia.js';
import { materiale, materiali } from '#famiglie/materiali.js';
import {
  interpolaMonotona,
  normalizzaConParametri,
  predefinitiDaParametri,
  schemaDaParametri,
  valoriDerivati,
} from '#famiglie/parametri.js';
import { sogliaParete, sogliaSformo, soglieProcessi } from '#famiglie/processi.js';
import { emettiMainFamiglia } from '#famiglie/emetti-main.js';
import {
  esitoMinimo,
  facceAiPunti,
  marcaFacce,
  pareteMinima,
  pesoGrammi,
  puntiMarcati,
  rileggiStep,
  sformo,
  sformoDuePiani,
  solidoChiuso,
  trasportaMarcatori,
} from '#famiglie/verifiche-comuni.js';

// Costruzioni B-rep ripetute: sulla macchina carica una prova supera i 5 s predefiniti.
vi.setConfig({ testTimeout: 60_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

describe('verifiche comuni delle famiglie', () => {
  it('should measure a 2 mm wall on a box shelled to 2 mm', () => {
    const box = lib.Box(20, 20, 20);
    const shelled = box.shell(
      2,
      box.faces().filter((face) => face.normalAt(face.interiorPoint()).z > 0.9),
    );
    const misura = pareteMinima(shelled);
    expect(misura.campioni).toBeGreaterThan(20);
    expect(misura.min).toBeCloseTo(2, 1);
    expect(Math.abs(misura.min - 2)).toBeLessThan(0.05);
  });

  it('should find no insufficient draft on a box drafted by 5 degrees and vertical walls before', () => {
    const box = lib.Box(20, 20, 20);
    const sides = box.faces().filter((face) => Math.abs(face.normalAt(face.interiorPoint()).z) < 0.1);
    const bottom = box.faces().find((face) => face.normalAt(face.interiorPoint()).z < -0.9)!;
    expect(sformo(box, { direzione: [0, 0, -1], minimo: 1 }).verticali).toHaveLength(4);
    const drafted = box.draft(sides, 5, bottom);
    const misura = sformo(drafted, { direzione: [0, 0, -1], minimo: 1 });
    expect(misura.insufficienti).toHaveLength(0);
    expect(misura.verticali).toHaveLength(0);
    // The top face looks away from a pull towards -Z: it belongs to the other half of the mould.
    expect(misura.sottosquadri).toHaveLength(1);
    expect(misura.sottosquadri[0]!.normalAt(misura.sottosquadri[0]!.interiorPoint()).z).toBeCloseTo(1, 6);
    // Only the side walls: their least draft is the 5 degrees given.
    const pareti = drafted.faces().filter((face) => Math.abs(face.normalAt(face.interiorPoint()).z) < 0.5);
    expect(sformo(drafted, { direzione: [0, 0, -1], minimo: 1, facce: pareti }).minimo).toBeCloseTo(5, 3);
  });

  it('should release both halves of a part drafted about a mid parting plane', () => {
    const anello = lib.Rectangle(30, 20, { fillet: 4 }).cut(lib.Rectangle(20, 10, { fillet: 1 }));
    const telaio = lib.Pos(0, 0, 1.5).mul(anello).extrude(1.5, { both: true, taper: 1 });
    const misura = sformoDuePiani(telaio, { piano: 1.5, minimo: 0.99 });
    expect(misura.sottosquadri).toHaveLength(0);
    expect(misura.insufficienti).toHaveLength(0);
    expect(misura.minimo).toBeCloseTo(1, 3);
    // Seen from one side only, the lower half is an undercut.
    expect(sformo(telaio, { direzione: [0, 0, 1], minimo: 0.99 }).sottosquadri.length).toBeGreaterThan(0);
  });

  it('should weigh a brass cylinder with the density in g/cm3', () => {
    const cilindro = lib.Cylinder(5, 10);
    const ottone = materiale('ottone');
    expect(ottone.densita).toBe(8.5);
    // Pi * 25 * 10 mm3 = 785.4 mm3 = 0.7854 cm3 at 8.5 g/cm3.
    expect(pesoGrammi(cilindro, ottone.densita)).toBeCloseTo(Math.PI * 250 * 8.5e-3, 6);
  });

  it('should tell a closed single solid from two bodies', () => {
    expect(solidoChiuso(lib, lib.Box(5, 5, 5))).toBe(true);
    expect(solidoChiuso(lib, lib.Box(5, 5, 5).fuse(lib.Box(5, 5, 5).translate(20, 0, 0)))).toBe(false);
    expect(solidoChiuso(lib, lib.Rectangle(5, 5))).toBe(false);
  });

  it('should find marked faces again on a mirrored copy', () => {
    const box = lib.Box(10, 10, 10).translate(10, 0, 0);
    const top = box.faces().filter((face) => face.normalAt(face.interiorPoint()).z > 0.9);
    marcaFacce(
      box,
      'sopra',
      top.map((face) => face.interiorPoint().toArray()),
    );
    const specchio = box.mirror(lib.Plane.YZ);
    trasportaMarcatori(box, specchio, ([x, y, z]) => [-x, y, z]);
    const trovate = facceAiPunti(specchio, puntiMarcati(specchio, 'sopra')!);
    expect(trovate).toHaveLength(1);
    expect(trovate[0]!.center().x).toBeCloseTo(-10, 6);
  });

  it('should write the pieces as STEP and read them back with names and volumes', () => {
    const pezzi = [
      { name: 'Telaio', shape: lib.Box(10, 10, 2), ruolo: 'telaio', materiale: 'zama', density: 6.7 },
      { name: 'Ardiglione', shape: lib.Cylinder(1, 12), ruolo: 'ardiglione', materiale: 'acciaio', density: 7.85 },
    ];
    const { corpi, esito } = rileggiStep(lib, pezzi, 'prova');
    expect(esito.livello).toBe('ok');
    expect(corpi.map(({ nome }) => nome ?? '').sort((a, b) => a.localeCompare(b))).toEqual(['Ardiglione', 'Telaio']);
    expect(corpi.find(({ nome }) => nome === 'Telaio')!.volume).toBeCloseTo(200, 6);
  });

  it('should grade a measured minimum against its threshold', () => {
    expect(esitoMinimo('PARETE_MIN', { valore: 1.3, soglia: 1.2, cosa: 'Parete' }).livello).toBe('ok');
    expect(esitoMinimo('PARETE_MIN', { valore: 1, soglia: 1.2, cosa: 'Parete' }).livello).toBe('avviso');
    expect(esitoMinimo('PARETE_MIN', { valore: 0.9, soglia: 1.2, cosa: 'Parete' }).livello).toBe('blocco');
  });
});

describe('processi e materiali', () => {
  it('should give per-process wall and draft thresholds of the specification', () => {
    expect(sogliaParete('pressofusione_zama')).toBe(1.2);
    expect(sogliaParete('fusione_cera_persa', 'oro_18kt_giallo')).toBe(0.5);
    expect(sogliaParete('fusione_cera_persa', 'argento_925')).toBe(0.6);
    expect(sogliaParete('stampaggio_iniezione', 'abs')).toBe(1.8);
    expect(sogliaParete('cnc', 'legno_faggio')).toBe(6);
    expect(sogliaSformo('pressofusione_zama')).toBe(1);
    expect(sogliaSformo('stampaggio_iniezione', 'gomma')).toBe(3);
    expect(sogliaSformo('cnc')).toBeUndefined();
    expect(new Set(Object.values(soglieProcessi).map(({ fonte }) => fonte))).toEqual(new Set(['mestiere']));
  });

  it('should list the materials of the specification with their densities', () => {
    const attese: Record<string, number> = {
      oro_18kt_giallo: 15.5,
      argento_925: 10.4,
      platino_950: 20.5,
      ottone: 8.5,
      zama: 6.7,
      acciaio: 7.85,
      abs: 1.05,
      tpu: 1.2,
      legno_faggio: 0.72,
      eva: 0.2,
      cuoio: 0.9,
    };
    for (const [chiave, densita] of Object.entries(attese)) {
      expect(materiali[chiave]?.densita).toBe(densita);
    }
    expect(() => materiale('kryptonite')).toThrow(RangeError);
  });
});

describe('parametri', () => {
  const definizioni: DefinizioneParametro[] = [
    { chiave: 'telaio.luce', unita: 'mm', min: 5, max: 60, default: 20, fonteDefault: 'mestiere' },
    { chiave: 'telaio.lati', unita: 'n', min: 3, max: 8, default: 4, fonteDefault: 'mestiere' },
    {
      chiave: 'telaio.profilo',
      unita: 'enum',
      valori: ['piatto', 'tondo'],
      default: 'piatto',
      fonteDefault: 'mestiere',
    },
    { chiave: 'costruzione.cavo', unita: 'bool', default: false, fonteDefault: 'scelta_nostra' },
    {
      chiave: 'telaio.doppio',
      unita: 'mm',
      default: 40,
      fonteDefault: 'derivato',
      derivato: (p) => 2 * (p['telaio'] as { luce: number }).luce,
    },
  ];

  it('should build a nested schema and defaults from the definitions', () => {
    const schema = schemaDaParametri(definizioni);
    const predefiniti = predefinitiDaParametri<ParametriAnnidati>(definizioni, { 'telaio.luce': 30 });
    expect(predefiniti).toEqual({ telaio: { luce: 30, lati: 4, profilo: 'piatto' }, costruzione: { cavo: false } });
    expect(schema.safeParse(predefiniti).success).toBe(true);
    expect(schema.safeParse({ ...predefiniti, telaio: { luce: 70, lati: 4, profilo: 'piatto' } }).success).toBe(false);
    expect(valoriDerivati(definizioni, predefiniti)).toEqual({ 'telaio.doppio': 60 });
  });

  it('should clamp, round and complete partial parameters', () => {
    const base = predefinitiDaParametri(definizioni);
    expect(normalizzaConParametri(definizioni, { telaio: { luce: 99, lati: 5.6, profilo: 'ovale' } }, base)).toEqual({
      telaio: { luce: 60, lati: 6, profilo: 'piatto' },
      costruzione: { cavo: false },
    });
    expect(() => normalizzaConParametri(definizioni, 'fibbia', base)).toThrow(TypeError);
  });

  it('should interpolate monotonically through the points without overshoot', () => {
    const punti = [
      [0, 0.18],
      [0.55, 0.45],
      [1, 1],
    ] as const;
    expect(interpolaMonotona(punti, 0)).toBeCloseTo(0.18, 12);
    expect(interpolaMonotona(punti, 0.55)).toBeCloseTo(0.45, 12);
    expect(interpolaMonotona(punti, 1)).toBeCloseTo(1, 12);
    let precedente = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const valore = interpolaMonotona(punti, t);
      expect(valore).toBeGreaterThanOrEqual(precedente - 1e-12);
      precedente = valore;
    }
    // A waist narrower than both ends stays a minimum at its point (no dip below it).
    const rocchetto = [
      [0, 0.6],
      [0.5, 0.4],
      [1, 1],
    ] as const;
    for (let t = 0; t <= 1; t += 0.01) {
      expect(interpolaMonotona(rocchetto, t)).toBeGreaterThanOrEqual(0.4 - 1e-12);
    }
  });

  it('should emit a project main.ts that imports the family from the built-in module', () => {
    const codice = emettiMainFamiglia(
      { id: 'fibbia', versione: 1, variante: 'rettangolare' },
      { cinturino: { larghezza: 20 }, telaio: { profilo: 'bombato' } },
      { 'cinturino.larghezza': 'Dalla misura dichiarata.' },
    );
    expect(codice).toContain("import { fibbia } from '@sinopia/famiglie';");
    expect(codice).toContain(
      "export const defaultParams = { cinturino: { larghezza: 20 }, telaio: { profilo: 'bombato' } };",
    );
    expect(codice).toContain('export const ipotesi = { "cinturino.larghezza": \'Dalla misura dichiarata.\' };');
    expect(codice).toContain("export const famiglia = { id: 'fibbia', versione: 1, variante: 'rettangolare' };");
    expect(codice).toContain("return fibbia.costruisci(p, { variante: 'rettangolare' });");
  });
});
