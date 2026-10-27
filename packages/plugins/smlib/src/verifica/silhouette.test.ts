/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { cpus, loadavg } from 'node:os';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { assiCamera, vistaRender } from '#verifica/camera.js';
import type { CameraVerifica } from '#verifica/camera.js';
import {
  meshDaForme,
  riquadro,
  silhouetteMesh,
  silhouetteMeshMorbida,
  silhouetteRender,
  tolleranzaPerPixel,
} from '#verifica/silhouette.js';
import type { MascheraBinaria } from '#verifica/silhouette.js';
import { famiglie } from '#famiglie/registro.js';

vi.setConfig({ testTimeout: 60_000 });
const carico = loadavg()[0]! / cpus().length;
const fattoreTempo = (process.env['CI'] ? 2 : 1) * (carico > 0.4 ? 4 : 1);
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const camera = (parziale: Partial<CameraVerifica> = {}): CameraVerifica => ({
  azimuth: 0,
  elevation: 0,
  rollo: 0,
  pxPerMm: 4,
  cx: 0,
  cy: 0,
  ...parziale,
});

const iou = (a: MascheraBinaria, b: MascheraBinaria): number => {
  let intersezione = 0;
  let unione = 0;
  for (let indice = 0; indice < a.dati.length; indice++) {
    intersezione += a.dati[indice]! & b.dati[indice]!;
    unione += a.dati[indice]! | b.dati[indice]!;
  }
  return unione === 0 ? 1 : intersezione / unione;
};

const baricentro = (maschera: MascheraBinaria, colonne: (x: number) => boolean): [number, number] => {
  let [sx, sy, n] = [0, 0, 0];
  for (let y = 0; y < maschera.altezza; y++) {
    for (let x = 0; x < maschera.larghezza; x++) {
      if (maschera.dati[y * maschera.larghezza + x] && colonne(x)) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  return [sx / n, sy / n];
};

const millisecondi = <T>(fn: () => T): { valore: T; tempo: number } => {
  const inizio = performance.now();
  const valore = fn();
  return { valore, tempo: performance.now() - inizio };
};

const pezziTacco = (): Smlib.Shape[] => {
  const tacco = famiglie.tacco!;
  const p: unknown = tacco.normalizza({ ...tacco.predefiniti('stiletto'), costruzione: { lato: 'dx' } }, {});
  return tacco.costruisci(lib, p, { variante: 'stiletto' }).map((pezzo) => pezzo.shape as Smlib.Shape);
};

describe('camera della verifica', () => {
  it('should give unit orthogonal axes with right = direction × up', () => {
    const { direzione, su, destra } = assiCamera({ azimuth: 37, elevation: 22, rollo: -12 });
    const punto = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(punto(direzione, direzione)).toBeCloseTo(1, 12);
    expect(punto(su, su)).toBeCloseTo(1, 12);
    expect(punto(direzione, su)).toBeCloseTo(0, 12);
    expect(punto(destra, su)).toBeCloseTo(0, 12);
    // Front view: looks along +Y, right is +X, up is +Z (the render convention).
    const fronte = assiCamera({ azimuth: 0, elevation: 0, rollo: 0 });
    expect(fronte.direzione.map((v) => v + 0)).toEqual([0, 1, 0]);
    expect(fronte.destra[0]).toBeCloseTo(1, 12);
    expect(fronte.su[2]).toBeCloseTo(1, 12);
  });

  it('should match the named azimuth/elevation views of render pixel by pixel', () => {
    const forma = lib.Box(20, 10, 5, { align: ['min', 'min', 'min'] }).fuse(lib.Box(2, 2, 15, { align: 'min' }));
    for (const [azimuth, elevation] of [
      [0, 0],
      [90, 0],
      [-60, 25],
      [135, -30],
      [30, 90],
    ] as const) {
      const c = camera({ azimuth, elevation });
      const nostra = silhouetteRender(lib, [forma], c, { larghezza: 128, altezza: 128 });
      const immagine = lib.render(forma, {
        view: { azimuth, elevation },
        frame: { scale: 4, midX: 0, midY: 0 },
        size: [128, 128],
        background: [0, 255, 0],
        supersample: 1,
      });
      const diretta = Uint8Array.from({ length: 128 * 128 }, (_, indice) =>
        immagine.pixels[indice * 3] === 0 && immagine.pixels[indice * 3 + 1] === 255 ? 0 : 1,
      );
      expect(diretta.some(Boolean)).toBe(true);
      expect(nostra.dati).toEqual(diretta);
    }
  });

  it('should put the frame mid point at the picture centre (midX along right, midY along up)', () => {
    const cubo = lib.Box(10, 10, 10);
    // 10 mm at 4 px/mm: 41 columns with the borders included (pixel centres on integers).
    const centrato = riquadro(silhouetteRender(lib, [cubo], camera(), { larghezza: 128, altezza: 128 }))!;
    expect(centrato).toEqual([44, 44, 84, 84]);
    // cx = +5 mm: the picture centre moves 5 mm right, the cube 20 px left; cy = +5 mm: the cube 20 px down.
    expect(riquadro(silhouetteRender(lib, [cubo], camera({ cx: 5 }), { larghezza: 128, altezza: 128 }))).toEqual([
      24, 44, 64, 84,
    ]);
    expect(riquadro(silhouetteRender(lib, [cubo], camera({ cy: 5 }), { larghezza: 128, altezza: 128 }))).toEqual([
      44, 64, 84, 104,
    ]);
    expect(vistaRender(camera({ cx: 1, cy: 2, pxPerMm: 3 })).frame).toEqual({ scale: 3, midX: 1, midY: 2 });
  });

  it('should turn the part counterclockwise in the picture with a positive roll', () => {
    const barra = lib.Box(40, 2, 2);
    const ruotata = silhouetteRender(lib, [barra], camera({ rollo: 30 }), { larghezza: 256, altezza: 256 });
    const [x0, y0, x1, y1] = riquadro(ruotata)!;
    // A 40 × 2 mm bar turned by 30°: width 40·cos30 + 2·sin30, height 40·sin30 + 2·cos30 (mm, at 4 px/mm).
    expect(x1 - x0).toBeCloseTo((40 * Math.cos(Math.PI / 6) + 2 * Math.sin(Math.PI / 6)) * 4, -0.5);
    expect(y1 - y0).toBeCloseTo((40 * Math.sin(Math.PI / 6) + 2 * Math.cos(Math.PI / 6)) * 4, -0.5);
    // Counterclockwise: the right end rises (smaller row).
    const [, destra] = baricentro(ruotata, (x) => x > 128);
    const [, sinistra] = baricentro(ruotata, (x) => x < 128);
    expect(destra).toBeLessThan(sinistra - 20);
  });
});

describe('silhouette del solido', () => {
  it('should give a 40 × 40 px square for a 10 mm cube at 4 px/mm on both paths', () => {
    const cubo = lib.Box(10, 10, 10);
    const viaA = silhouetteRender(lib, [cubo], camera());
    const viaB = silhouetteMesh(meshDaForme(lib, [cubo], 0.01), camera());
    for (const maschera of [viaA, viaB]) {
      const [x0, y0, x1, y1] = riquadro(maschera)!;
      expect(x1 - x0 + 1).toBeGreaterThanOrEqual(40);
      expect(x1 - x0 + 1).toBeLessThanOrEqual(41);
      expect(y1 - y0 + 1).toBeGreaterThanOrEqual(40);
      expect(y1 - y0 + 1).toBeLessThanOrEqual(41);
      expect(Math.abs((x0 + x1) / 2 - 128)).toBeLessThanOrEqual(1);
    }
    // Path B samples pixel centres (40 columns, 108–147); render lights every touched pixel (41, 108–148).
    expect(riquadro(viaB)).toEqual([108, 108, 147, 147]);
    expect(riquadro(viaA)).toEqual([108, 108, 148, 148]);
  });

  it('should give fractional coverage that adds up to the projected area (supersampled path B)', () => {
    // A 10 mm cube at 4 px/mm shifted by a third of a pixel: 1600 px² of area, split over the border pixels.
    const cubo = lib.Box(10, 10, 10);
    const morbida = silhouetteMeshMorbida(meshDaForme(lib, [cubo], 0.01), camera({ cx: 1 / 12, cy: -1 / 12 }));
    const area = morbida.copertura.reduce((somma, valore) => somma + valore, 0);
    expect(area).toBeCloseTo(1600, 0);
    expect(morbida.copertura.some((valore) => valore > 0 && valore < 1)).toBe(true);
    expect(morbida.dati.reduce((somma, valore) => somma + valore, 0)).toBe(1600);
  });

  it('should agree between render and the mesh fill on a heel and a buckle seen three-quarters with roll', () => {
    const fibbia = famiglie.fibbia!;
    const pezziFibbia = fibbia
      .costruisci(lib, fibbia.normalizza(fibbia.predefiniti('rettangolare')), {})
      .map((pezzo) => pezzo.shape as Smlib.Shape);
    for (const [forme, c] of [
      [pezziTacco(), camera({ azimuth: 62, elevation: 12, rollo: 8, pxPerMm: 2.2, cx: -2, cy: 44 })],
      [pezziFibbia, camera({ azimuth: 15, elevation: 65, rollo: -10, pxPerMm: 7, cx: 0, cy: 0 })],
    ] as const) {
      const viaA = silhouetteRender(lib, forme, c);
      const viaB = silhouetteMesh(meshDaForme(lib, forme, tolleranzaPerPixel(c.pxPerMm)), c);
      const pieniB = viaB.dati.reduce((somma, v) => somma + v, 0);
      const soloB = viaB.dati.reduce((somma, v, indice) => somma + (v & (1 - viaA.dati[indice]!)), 0);
      expect(pieniB).toBeGreaterThan(3000);
      // Render is path B grown by about half a pixel on every side: B lies inside it, the rest is a thin rim.
      expect(soloB / pieniB).toBeLessThan(0.002);
      expect(iou(viaA, viaB)).toBeGreaterThan(0.95);
    }
  });

  it('should render a heel silhouette at 256² within 150 ms (path A) and fill it in a few ms (path B)', () => {
    const forme = pezziTacco();
    const c = camera({ azimuth: 70, elevation: 10, pxPerMm: 2.2, cy: 44 });
    silhouetteRender(lib, forme, c);
    const tempiA: number[] = [];
    for (let giro = 0; giro < 3; giro++) {
      tempiA.push(millisecondi(() => silhouetteRender(lib, forme, c)).tempo);
    }
    const tessellazione = millisecondi(() => meshDaForme(lib, forme, tolleranzaPerPixel(c.pxPerMm)));
    const tempiB: number[] = [];
    for (let giro = 0; giro < 5; giro++) {
      tempiB.push(millisecondi(() => silhouetteMesh(tessellazione.valore, c)).tempo);
    }
    // oxlint-disable-next-line no-console -- T-D3-01 records the measured times.
    console.log(
      `silhouette 256² del tacco: render ${Math.min(...tempiA).toFixed(1)} ms · tessellate ${tessellazione.tempo.toFixed(1)} ms` +
        ` (${tessellazione.valore.triangoli.length / 3} triangoli) + riempimento ${Math.min(...tempiB).toFixed(2)} ms`,
    );
    // 150 ms is the budget of the specification for a lone run (measured 81 ms); in CI and with the suite running in
    // parallel the threshold widens, while path B must stay at least ten times faster than render either way.
    expect(Math.min(...tempiA)).toBeLessThan(150 * fattoreTempo);
    expect(Math.min(...tempiB)).toBeLessThan(Math.min(...tempiA) / 10);
  });
});
