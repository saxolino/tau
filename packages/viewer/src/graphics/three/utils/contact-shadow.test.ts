import { describe, expect, it } from 'vitest';
import { computeContactShadow, groundAxes } from '#graphics/three/utils/contact-shadow.js';

/** Two triangles of a horizontal square at height `z`, side `size`, centred on the origin. */
const square = (size: number, z: number): number[] => {
  const h = size / 2;
  return [-h, -h, z, h, -h, z, h, h, z, -h, -h, z, h, h, z, -h, h, z];
};

/** The shadow at a point of its square, `u` and `v` from 0 to 1. */
const at = (
  { alpha, resolution }: { alpha: Float32Array; resolution: number },
  [u, v]: readonly [number, number],
): number => alpha[Math.floor(v * resolution) * resolution + Math.floor(u * resolution)]!;

describe('computeContactShadow', () => {
  it('should darken the ground under a piece and fade to nothing beyond it', () => {
    const triangles = new Float32Array([...square(10, 0), ...square(10, 2)]);
    const shadow = computeContactShadow({ triangles, min: [-5, -5, 0], max: [5, 5, 2], up: 2, resolution: 128 });
    expect(shadow).toBeDefined();
    const { alpha, size, origin, groundHeight, axes } = shadow!;
    expect(axes).toEqual([0, 1]);
    expect(groundHeight).toBe(0);
    expect(size).toBeCloseTo(16, 6);
    expect(origin).toEqual([-8, -8]);
    expect(at(shadow!, [0.5, 0.5])).toBeGreaterThan(0.8);
    expect(at(shadow!, [0.01, 0.01])).toBeLessThan(0.02);
    expect(Math.max(...alpha)).toBeLessThanOrEqual(1);
    expect(Math.min(...alpha)).toBeGreaterThanOrEqual(0);
  });

  it('should cast a fainter shadow from parts high above the ground', () => {
    // A thin foot on the ground and a wide plate high above it.
    const triangles = new Float32Array([...square(1, 0), ...square(10, 20)]);
    const shadow = computeContactShadow({ triangles, min: [-5, -5, 0], max: [5, 5, 20], up: 2, resolution: 128 })!;
    const underFoot = at(shadow, [0.5, 0.5]);
    const underPlateEdge = at(shadow, [0.5 + 4 / 16, 0.5]);
    expect(underFoot).toBeGreaterThan(underPlateEdge);
    expect(underPlateEdge).toBeLessThan(0.3);
  });

  it('should project onto the ground of any up axis', () => {
    expect(groundAxes(2)).toEqual([0, 1]);
    expect(groundAxes(1)).toEqual([2, 0]);
    expect(groundAxes(0)).toEqual([1, 2]);
    // The same square standing on the y = 0 floor, Y up.
    const flat = square(10, 0);
    const swapped = new Float32Array(flat.length);
    for (let index = 0; index < flat.length; index += 3) {
      swapped.set([flat[index]!, flat[index + 2]!, flat[index + 1]!], index);
    }
    const shadow = computeContactShadow({ triangles: swapped, min: [-5, 0, -5], max: [5, 0.5, 5], up: 1 })!;
    expect(shadow.groundHeight).toBe(0);
    expect(at(shadow, [0.5, 0.5])).toBeGreaterThan(0.8);
  });

  it('should give nothing for a model without footprint', () => {
    expect(
      computeContactShadow({ triangles: new Float32Array(), min: [0, 0, 0], max: [0, 0, 0], up: 2 }),
    ).toBeUndefined();
  });

  it('should stay a one-off cost for a dense jewellery mesh', () => {
    // 200 000 small triangles over a 20 mm ring footprint: computed once per geometry, never per frame.
    const count = 200_000;
    const triangles = new Float32Array(count * 9);
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2;
      const x = Math.cos(angle) * 10;
      const y = Math.sin(angle) * 10;
      const z = (index % 7) * 0.3;
      triangles.set([x, y, z, x + 0.2, y, z, x, y + 0.2, z + 0.1], index * 9);
    }
    const started = performance.now();
    const shadow = computeContactShadow({ triangles, min: [-10, -10, 0], max: [10.2, 10.2, 2], up: 2 });
    const elapsed = performance.now() - started;
    expect(shadow).toBeDefined();
    // Generous bound for loaded CI machines; locally it is tens of milliseconds.
    expect(elapsed).toBeLessThan(2000);
  });
});
