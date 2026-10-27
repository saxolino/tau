/* oxlint-disable new-cap -- SMLib exposes capitalized native shape factories. */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { CacheMesh, creaCacheMeshKernel, hashByte64, improntaForma, limitiCacheMesh } from '#utils/mesh-cache.js';
import type { FacceInCache } from '#utils/mesh-cache.js';
import {
  normalizeRenderShapes,
  render,
  resolveSmlibTessellation,
  resolveSmlibViewTessellation,
  snapPresetLinearTolerance,
} from '#utils/render-output.js';
import { famiglie } from '#famiglie/registro.js';
import type { FamigliaQualsiasi } from '#famiglie/famiglia.js';

let library: typeof Smlib;
beforeAll(async () => {
  library = await import('@classcad/smlibwasm');
});

const facce = (numeri: number): FacceInCache => ({
  faces: {
    triangles: Array.from({ length: numeri }, (_, indice) => indice),
    vertices: [],
    normals: [],
    faceGroups: [],
  },
  faceMappingTrusted: true,
});

describe('hashByte64', () => {
  it('should be deterministic and carry the length', () => {
    const byte = Uint8Array.from({ length: 1001 }, (_, indice) => (indice * 37) % 256);
    expect(hashByte64(byte)).toBe(hashByte64(new Uint8Array(byte)));
    expect(hashByte64(byte)).toMatch(/^[\da-f]{16}:1001$/);
    expect(hashByte64(byte.subarray(0, 1000))).not.toBe(hashByte64(byte));
  });

  it('should tell apart inputs that differ in any single bit, the top bit of two words included', () => {
    const base = new Uint8Array(64);
    const visti = new Set([hashByte64(base)]);
    for (let indice = 0; indice < base.length; indice++) {
      for (let bit = 0; bit < 8; bit++) {
        const variante = new Uint8Array(base);
        variante[indice] = 2 ** bit;
        visti.add(hashByte64(variante));
      }
    }
    expect(visti.size).toBe(1 + 64 * 8);
    // Two top-bit flips cancel in a plain multiply-xor hash; the rotations here keep them apart.
    const due = new Uint8Array(base);
    due[3] = 0x80;
    due[7] = 0x80;
    const altri = new Uint8Array(base);
    altri[11] = 0x80;
    altri[15] = 0x80;
    expect(new Set([hashByte64(base), hashByte64(due), hashByte64(altri)]).size).toBe(3);
  });

  it('should hash a view that does not start on a word boundary like a copy', () => {
    const buffer = Uint8Array.from({ length: 41 }, (_, indice) => indice);
    const vista = buffer.subarray(1);
    expect(vista.byteOffset % 4).not.toBe(0);
    expect(hashByte64(vista)).toBe(hashByte64(new Uint8Array(vista)));
  });
});

describe('CacheMesh', () => {
  it('should evict the least recently used entry past its entry limit', () => {
    const cache = new CacheMesh({ byte: 1_000_000, voci: 2 });
    cache.scriviFacce('a', facce(1));
    cache.scriviFacce('b', facce(1));
    expect(cache.leggiFacce('a')).toBeDefined();
    cache.scriviFacce('c', facce(1));
    expect(cache.leggiFacce('b')).toBeUndefined();
    expect(cache.leggiFacce('a')).toBeDefined();
    expect(cache.leggiFacce('c')).toBeDefined();
    expect(cache.stato).toMatchObject({ voci: 2, espulsi: 1, colpi: 3, mancati: 1 });
  });

  it('should evict past its byte limit, never keep an entry larger than the limit, and free bytes on eviction', () => {
    const cache = new CacheMesh({ byte: 1000, voci: 100 });
    cache.scriviFacce('a', facce(70));
    cache.scriviFacce('b', facce(70));
    expect(cache.leggiFacce('a')).toBeUndefined();
    expect(cache.stato.byte).toBe(560);
    cache.scriviFacce('enorme', facce(200));
    expect(cache.leggiFacce('enorme')).toBeUndefined();
    expect(cache.leggiFacce('b')).toBeDefined();
    cache.svuota();
    expect(cache.stato).toMatchObject({ voci: 0, byte: 0 });
  });

  it('should keep faces and edges of the same key apart', () => {
    const cache = new CacheMesh({ byte: 1_000_000, voci: 10 });
    cache.scriviFacce('k', facce(3));
    expect(cache.leggiSpigoli('k')).toBeUndefined();
    cache.scriviSpigoli('k', { lines: [1, 2, 3, 4, 5, 6], edgeGroups: [{ start: 0, count: 6, edgeId: 0 }] });
    expect(cache.leggiSpigoli('k')?.lines).toHaveLength(6);
    expect(cache.leggiFacce('k')?.faces.triangles).toHaveLength(3);
  });

  it('should give a kernel separate fine and interactive caches', () => {
    const cache = creaCacheMeshKernel();
    expect(cache.fine).not.toBe(cache.interattiva);
    expect(limitiCacheMesh.interattiva.byte).toBeLessThan(limitiCacheMesh.fine.byte);
  });
});

describe('improntaForma', () => {
  it('should give the same body built twice the same fingerprint and a different body another one', () => {
    const corpo = (altezza: number): Smlib.Part => library.Box(10, 20, altezza).cut(library.Cylinder(3, 40));
    const uno = corpo(30);
    const due = corpo(30);
    const altro = corpo(31);
    expect(improntaForma(library, uno)).toBe(improntaForma(library, due));
    expect(improntaForma(library, uno)).not.toBe(improntaForma(library, altro));
  });

  it('should fingerprint a face through a temporary shell and free that shell', () => {
    const faccia = [...library.Box(10, 10, 10).faces()][0]!;
    const prima = library.memoryUsage().handles;
    const impronta = improntaForma(library, faccia);
    expect(impronta).toMatch(/^[\da-f]{16}:\d+$/);
    expect(library.memoryUsage().handles).toBe(prima);
    expect(improntaForma(library, faccia)).toBe(impronta);
  });
});

describe('snapPresetLinearTolerance', () => {
  it('should snap down by less than one step of 2^(1/16), keep grid values, and stay within the preset range', () => {
    for (const tolleranza of [0.0123, 0.0187, 0.078, 0.5, 3.7]) {
      const agganciata = snapPresetLinearTolerance(tolleranza);
      expect(agganciata).toBeLessThanOrEqual(tolleranza);
      expect(agganciata).toBeGreaterThan(tolleranza / 2 ** (1 / 16));
      expect(snapPresetLinearTolerance(agganciata)).toBe(agganciata);
    }
    expect(snapPresetLinearTolerance(0.001)).toBe(0.001);
    // A hair of difference in the overall size keeps the tolerance.
    expect(snapPresetLinearTolerance(0.0162)).toBe(snapPresetLinearTolerance(0.0161));
  });
});

describe('render with the per-piece mesh cache', () => {
  const pezziFibbia = (ardiglione: number) => {
    const famiglia: FamigliaQualsiasi = famiglie.fibbia!;
    const p = famiglia.normalizza(famiglia.predefiniti('rettangolare'), {
      variante: 'rettangolare',
    }) as unknown as { ardiglione: { diametro: number } };
    p.ardiglione.diametro *= ardiglione;
    return normalizeRenderShapes(library, famiglia.costruisci(library, p, { variante: 'rettangolare' }));
  };
  const tolleranze = (pezzi: ReturnType<typeof pezziFibbia>) =>
    resolveSmlibViewTessellation(library, pezzi, {
      tessellation: 'medium',
      explicitDefaults: { linearTolerance: 0.02, angularTolerance: 20 },
    });

  it('should give exactly the geometry of an uncached render, and reuse the pieces whose form did not change', () => {
    const cache = new CacheMesh({ byte: 64 * 1024 * 1024, voci: 64 });
    const prima = pezziFibbia(1);
    const opzioni = { library, tessellation: tolleranze(prima), collectBrepEdges: true };
    const conCache = render(prima, { ...opzioni, cache });
    expect(conCache).toEqual(render(pezziFibbia(1), opzioni));
    expect(cache.stato).toMatchObject({ colpi: 0, voci: 4 });

    // Same frame, larger pin: the frame comes from the cache, the pin is tessellated again.
    const dopo = pezziFibbia(1.1);
    const tolleranzeDopo = tolleranze(dopo);
    expect(tolleranzeDopo).toEqual(opzioni.tessellation);
    const riusate = render(dopo, { ...opzioni, cache });
    expect(riusate).toEqual(render(pezziFibbia(1.1), opzioni));
    expect(riusate[0]!.faces).toBe(conCache[0]!.faces);
    expect(riusate[1]!.faces).not.toBe(conCache[1]!.faces);
    expect(cache.stato.colpi).toBe(2);
  });

  it('should snap a view preset onto its grid and leave an export preset exact', () => {
    const pezzi = pezziFibbia(1);
    const richiesta = {
      tessellation: 'medium',
      explicitDefaults: { linearTolerance: 0.02, angularTolerance: 20 },
    } as const;
    const esatta = resolveSmlibTessellation(library, pezzi, richiesta);
    expect(tolleranze(pezzi).linearTolerance).toBe(snapPresetLinearTolerance(esatta.linearTolerance));
    const esplicita = { ...richiesta, tessellation: { linearTolerance: 0.0173 } };
    expect(resolveSmlibViewTessellation(library, pezzi, esplicita).linearTolerance).toBe(0.0173);
  });

  it('should not reuse a mesh made at other tolerances', () => {
    const cache = new CacheMesh({ byte: 64 * 1024 * 1024, voci: 64 });
    const pezzi = pezziFibbia(1);
    const fine = render(pezzi, { library, tessellation: tolleranze(pezzi), cache });
    const grossa = render(pezzi, {
      library,
      tessellation: { ...tolleranze(pezzi), linearTolerance: tolleranze(pezzi).linearTolerance * 4 },
      cache,
    });
    expect(cache.stato.colpi).toBe(0);
    expect(grossa[0]!.faces.triangles.length).toBeLessThan(fine[0]!.faces.triangles.length);
  });

  it('should free the kernel objects it reads while meshing', () => {
    const pezzi = pezziFibbia(1);
    const opzioni = { library, tessellation: tolleranze(pezzi), collectBrepEdges: true };
    render(pezzi, opzioni);
    const prima = library.memoryUsage().handles;
    render(pezzi, opzioni);
    render(pezzi, opzioni);
    expect(library.memoryUsage().handles).toBe(prima);
  });
});
