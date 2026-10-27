import type { MeshFoto } from '#lib/foto-campione/mappe-condivise.js';

/**
 * Axis-aligned boxes as the maps' tests need them: twelve triangles each with their face normals, and the twelve edges.
 *
 * @param scatole - Each box as its min and max corner, mm, Z up.
 * @returns The mesh.
 */
export function scatole(
  ...scatole: ReadonlyArray<
    Readonly<{ min: readonly [number, number, number]; max: readonly [number, number, number] }>
  >
): MeshFoto {
  const triangoli: number[] = [];
  const normali: number[] = [];
  const segmenti: number[] = [];
  for (const { min, max } of scatole) {
    const angolo = (i: number): [number, number, number] => [
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2],
    ];
    // Each face: four corners (bits of x, y, z) and its outward normal.
    const facce: Array<[number[], [number, number, number]]> = [
      [
        [0, 2, 6, 4],
        [-1, 0, 0],
      ],
      [
        [1, 5, 7, 3],
        [1, 0, 0],
      ],
      [
        [0, 4, 5, 1],
        [0, -1, 0],
      ],
      [
        [2, 3, 7, 6],
        [0, 1, 0],
      ],
      [
        [0, 1, 3, 2],
        [0, 0, -1],
      ],
      [
        [4, 6, 7, 5],
        [0, 0, 1],
      ],
    ];
    for (const [[a, b, c, d], n] of facce) {
      for (const tri of [
        [a, b, c],
        [a, c, d],
      ]) {
        for (const vertice of tri) {
          triangoli.push(...angolo(vertice!));
          normali.push(...n);
        }
      }
    }
    for (const [a, b] of [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [0, 2],
      [1, 3],
      [4, 6],
      [5, 7],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ] as const) {
      segmenti.push(...angolo(a), ...angolo(b));
    }
  }
  return {
    triangoli: Float32Array.from(triangoli),
    normali: Float32Array.from(normali),
    segmenti: Float32Array.from(segmenti),
  };
}
