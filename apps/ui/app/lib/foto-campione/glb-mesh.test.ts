// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { meshDaGlb } from '#lib/foto-campione/glb-mesh.js';

/** A GLB by hand: one node 10 mm up (glTF Y), one triangle with normals and one edge as a line primitive. */
function glb(): Uint8Array<ArrayBuffer> {
  // Triangle in glTF metres (Y up), facing +Z (towards the glTF front).
  const posizioni = new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.02, 0]);
  const normali = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indici = new Uint16Array([0, 1, 2, 0]);
  const linea = new Float32Array([0, 0, 0, 0, 0, -0.005]);
  const pezzi = [posizioni, normali, indici, linea];
  const lunghezze = pezzi.map((pezzo) => pezzo.byteLength);
  const offset = lunghezze.map((_, i) => lunghezze.slice(0, i).reduce((a, b) => a + b, 0));
  const binLength = lunghezze.reduce((a, b) => a + b, 0);
  const json = {
    asset: { version: '2.0' },
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
    bufferViews: pezzi.map((_, i) => ({ buffer: 0, byteOffset: offset[i], byteLength: lunghezze[i] })),
    buffers: [{ byteLength: binLength }],
  };
  let testo = JSON.stringify(json);
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

describe('GLB → mesh of the sample photo', () => {
  it('should bring glTF metres, Y up, into the Tau root frame in millimetres, Z up, with node transforms', () => {
    const mesh = meshDaGlb(glb());
    // (x, y, z) m → (x, −z, y) mm, plus the node's 10 mm along glTF Y = root Z.
    expect([...mesh.triangoli].map((v) => Math.round(v * 1000) / 1000)).toStrictEqual([0, 0, 10, 10, 0, 10, 0, 0, 30]);
    // The glTF front (+Z) is the root front (−Y), the camera side of «fronte».
    expect([...mesh.normali].map((v) => Math.round(v * 1000) / 1000 + 0)).toStrictEqual([0, -1, 0, 0, -1, 0, 0, -1, 0]);
    expect([...mesh.segmenti].map((v) => Math.round(v * 1000) / 1000 + 0)).toStrictEqual([0, 0, 10, 0, 5, 10]);
  });
});
