// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { meshDaGlb, rendiMappe, TETTI_GLB } from '#lib/foto-campione/mappe-condivise.js';

/** A GLB by hand: the given JSON and float/uint16 arrays packed one after the other as buffer views 0, 1, 2… */
function glbDa(
  json: Record<string, unknown>,
  pezzi: ReadonlyArray<Float32Array | Uint16Array>,
  viste: ReadonlyArray<Record<string, unknown> | undefined> = [],
): Uint8Array<ArrayBuffer> {
  const lunghezze = pezzi.map((pezzo) => pezzo.byteLength);
  const offset = lunghezze.map((_, i) => lunghezze.slice(0, i).reduce((a, b) => a + b, 0));
  const binLength = lunghezze.reduce((a, b) => a + b, 0);
  let testo = JSON.stringify({
    asset: { version: '2.0' },
    ...json,
    bufferViews: pezzi.map((_, i) => ({ buffer: 0, byteOffset: offset[i], byteLength: lunghezze[i], ...viste[i] })),
    buffers: [{ byteLength: binLength }],
  });
  while (testo.length % 4 !== 0) {
    testo += ' ';
  }
  const jsonBytes = new TextEncoder().encode(testo);
  const binPadded = Math.ceil(binLength / 4) * 4;
  const totale = 12 + 8 + jsonBytes.length + 8 + binPadded;
  const uscita = new Uint8Array(totale);
  const vista = new DataView(uscita.buffer);
  vista.setUint32(0, 0x46_54_6c_67, true);
  vista.setUint32(4, 2, true);
  vista.setUint32(8, totale, true);
  vista.setUint32(12, jsonBytes.length, true);
  vista.setUint32(16, 0x4e_4f_53_4a, true);
  uscita.set(jsonBytes, 20);
  const bin = 20 + jsonBytes.length;
  vista.setUint32(bin, binPadded, true);
  vista.setUint32(bin + 4, 0x00_4e_49_42, true);
  for (const [i, pezzo] of pezzi.entries()) {
    uscita.set(new Uint8Array(pezzo.buffer), bin + 8 + offset[i]!);
  }
  return uscita;
}

/** One triangle with normals and one edge, under one node 10 mm up (glTF Y). */
function glb(): Uint8Array<ArrayBuffer> {
  return glbDa(
    {
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, translation: [0, 0.01, 0] }],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 },
            { attributes: { POSITION: 3 }, mode: 1 },
          ],
        },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
        { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' },
      ],
    },
    [
      new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.02, 0]),
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Uint16Array([0, 1, 2, 0]),
      new Float32Array([0, 0, 0, 0, 0, -0.005]),
    ],
  );
}

/** A mesh of `vertici` vertices drawing one indexed triangle, and the given nodes over it. */
function istanze(vertici: number, nodes: Array<Record<string, unknown>>, scene?: number[]): Uint8Array<ArrayBuffer> {
  const posizioni = new Float32Array(vertici * 3).map((_, i) => (i === 3 || i === 7 ? 0.01 : 0));
  return glbDa(
    {
      ...(scene ? { scene: 0, scenes: [{ nodes: scene }] } : {}),
      nodes,
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: vertici, type: 'VEC3' },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    },
    [posizioni, new Uint16Array([0, 1, 2, 0])],
  );
}

describe('GLB → mesh of the sample photo', () => {
  it('should bring glTF metres, Y up, into the Tau root frame in millimetres, Z up, with node transforms', () => {
    const mesh = meshDaGlb(glb());
    // (x, y, z) m → (x, −z, y) mm, plus the node's 10 mm along glTF Y = root Z.
    expect([...mesh.triangoli].map((v) => Math.round(v * 1000) / 1000)).toStrictEqual([0, 0, 10, 10, 0, 10, 0, 0, 30]);
    // The glTF front (+Z) is the root front (−Y), the camera side of «fronte».
    expect([...mesh.normali].map((v) => Math.round(v * 1000) / 1000 + 0)).toStrictEqual([0, -1, 0, 0, -1, 0, 0, -1, 0]);
    expect([...mesh.segmenti].map((v) => Math.round(v * 1000) / 1000 + 0)).toStrictEqual([0, 0, 10, 0, 5, 10]);
  });

  it('should take as roots the nodes no node has as child when the GLB has no scene', () => {
    const mesh = meshDaGlb(istanze(3, [{ children: [1] }, { mesh: 0 }]));
    expect(mesh.triangoli.length).toBe(9);
  });

  it('should refuse a cyclic node graph and a node reached twice, instead of looping or multiplying the work', () => {
    expect(() =>
      meshDaGlb(
        istanze(
          3,
          [
            { mesh: 0, children: [1] },
            { mesh: 0, children: [0] },
          ],
          [0],
        ),
      ),
    ).toThrow(/ciclici/u);
    expect(() => meshDaGlb(istanze(3, [{ mesh: 0 }], [0, 0]))).toThrow(/ciclici/u);
    expect(() => meshDaGlb(istanze(3, [{ children: [2] }, { children: [2] }, { mesh: 0 }], [0, 1]))).toThrow(
      /ciclici/u,
    );
  });

  it('should refuse a GLB beyond the ceilings: nodes, and vertices read through many instances of one mesh', () => {
    expect(() =>
      meshDaGlb(
        istanze(
          3,
          Array.from({ length: TETTI_GLB.nodi + 1 }, () => ({})),
          [0],
        ),
      ),
    ).toThrow(/troppi nodi/u);
    // 3 000 nodes over one mesh of 999 vertices: 3 M vertices read, over the 2 M ceiling, with a 12 kB buffer.
    const nodi = Array.from({ length: 3000 }, () => ({ mesh: 0 }));
    expect(() =>
      meshDaGlb(
        istanze(
          999,
          nodi,
          nodi.map((_, i) => i),
        ),
      ),
    ).toThrow(/troppi vertici/u);
  });

  it('should still render a model with many edges within its drawing budget', () => {
    const mesh = meshDaGlb(glb());
    const molti = { ...mesh, segmenti: new Float32Array(6 * 20_000).map((_, i) => (i % 6 < 3 ? -20 : 20)) };
    expect(rendiMappe(molti, 'fronte', 64).lato).toBe(64);
  });

  it('should refuse hostile accessors before allocating: huge or fractional count, bad stride, offset out of its view, odd normals', () => {
    const triangolo = (
      accessors: Array<Record<string, unknown>>,
      viste: Array<Record<string, unknown> | undefined> = [],
      normali = false,
    ): Uint8Array<ArrayBuffer> =>
      glbDa(
        {
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0, ...(normali ? { NORMAL: 1 } : {}) }, mode: 4 }] }],
          accessors,
        },
        // Two views: 3 vertices (36 bytes) and 3 normals followed by 12 spare bytes (48 bytes).
        [new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.02, 0]), new Float32Array(12)],
        viste,
      );
    const posizioni = (sovrascrivi: Record<string, unknown> = {}) => ({
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      ...sovrascrivi,
    });
    // The honest one reads.
    expect(meshDaGlb(triangolo([posizioni()])).triangoli.length).toBe(9);
    // Count: enormous, fractional, negative.
    expect(() => meshDaGlb(triangolo([posizioni({ count: 1e12 })]))).toThrow(/fuori dal suo bufferView/u);
    expect(() => meshDaGlb(triangolo([posizioni({ count: 2.5 })]))).toThrow(/accessor non valido/u);
    expect(() => meshDaGlb(triangolo([posizioni({ count: -3 })]))).toThrow(/accessor non valido/u);
    // Stride: not a multiple of 4, shorter than the element, beyond 252.
    for (const byteStride of [14, 8, 256]) {
      expect(() => meshDaGlb(triangolo([posizioni({ count: 1 })], [{ byteStride }]))).toThrow(/byteStride/u);
    }
    // The accessor fits the whole BIN (84 bytes) but not ITS view (36 bytes).
    expect(() => meshDaGlb(triangolo([posizioni({ byteOffset: 12 })]))).toThrow(/fuori dal suo bufferView/u);
    // A view that claims more than the BIN.
    expect(() => meshDaGlb(triangolo([posizioni()], [{ byteLength: 4096 }]))).toThrow(/fuori dal buffer/u);
    // Normals of another length than the positions.
    const normali = { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' };
    expect(() => meshDaGlb(triangolo([posizioni(), normali], [], true))).toThrow(/lunghezza diversa/u);
    expect(meshDaGlb(triangolo([posizioni(), { ...normali, count: 3 }], [], true)).normali.length).toBe(9);
  });
});
