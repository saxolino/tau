import { expect, it } from 'vitest';
import { measureEmphasisPixels } from '#graphics/three/materials/model-emphasis-pixels.test-utils.js';

it('should distinguish sparse boundary coverage from missing strokes, shifts and interior corruption', () => {
  const width = 32;
  const reference = new Uint8Array(width * width * 4);
  for (let y = 4; y < 28; y++) {
    reference[(y * width + 12) * 4] = 255;
  }
  expect(measureEmphasisPixels(reference, reference, width).maxDelta).toBe(0);
  const coverage = new Uint8Array(reference);
  coverage[(16 * width + 12) * 4] = 191; // One of four coverage samples changes at one boundary pixel.
  const sparse = measureEmphasisPixels(coverage, reference, width);
  expect(sparse.maxDelta).toBe(64);
  expect(sparse.interiorChanges).toBe(0);
  expect(sparse.maxLocalMean).toBeLessThanOrEqual(16);
  const missing = new Uint8Array(reference.length);
  expect(measureEmphasisPixels(missing, reference, width).maxLocalMean).toBeGreaterThan(16);
  const shifted = new Uint8Array(reference.length);
  for (let y = 4; y < 28; y++) {
    shifted[(y * width + 13) * 4] = 255;
  }
  expect(measureEmphasisPixels(shifted, reference, width).maxLocalMean).toBeGreaterThan(16);
  const interior = new Uint8Array(reference);
  interior[(16 * width + 24) * 4] = 64;
  expect(measureEmphasisPixels(interior, reference, width).interiorChanges).toBe(1);
});
