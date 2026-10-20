/**
 * Boundary-local comparison for crop requalification; exact deltas remain visible in the receipt.
 * @param candidate - Candidate RGBA code values.
 * @param reference - Matched reference RGBA code values.
 * @param width - Width in device pixels.
 * @returns Spatial diagnostics; the caller applies its predeclared acceptance contract.
 */
export function measureEmphasisPixels(
  candidate: ArrayLike<number>,
  reference: ArrayLike<number>,
  width: number,
): {
  changedChannels: number;
  maxDelta: number;
  interiorChanges: number;
  maxLocalMean: number;
} {
  if (candidate.length !== reference.length || reference.length % (width * 4) !== 0) {
    throw new Error('Pixel buffers must have matching complete RGBA rows');
  }
  const height = reference.length / (width * 4);
  let changedChannels = 0;
  let maxDelta = 0;
  let interiorChanges = 0;
  const localSums = new Map<number, number>();
  for (let index = 0; index < reference.length; index++) {
    const delta = candidate[index]! - reference[index]!;
    if (delta === 0) {
      continue;
    }
    maxDelta = Math.max(maxDelta, Math.abs(delta));
    const pixel = Math.floor(index / 4);
    const channel = index % 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    let boundary = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        const neighbour = (ny * width + nx) * 4 + channel;
        if (Math.abs(reference[neighbour]! - reference[index]!) > 2) {
          boundary = true;
        }
        localSums.set(neighbour, (localSums.get(neighbour) ?? 0) + delta);
      }
    }
    if (Math.abs(delta) > 1) {
      changedChannels++;
      if (!boundary) {
        interiorChanges++;
      }
    }
  }
  let maxLocalMean = 0;
  for (const sum of localSums.values()) {
    maxLocalMean = Math.max(maxLocalMean, Math.abs(sum) / 9);
  }
  return { changedChannels, maxDelta, interiorChanges, maxLocalMean };
}
