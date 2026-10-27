/**
 * A soft contact shadow computed on the CPU from the model's triangles, once per geometry: no extra render pass, no
 * backend-specific shader, so WebGL and WebGPU draw the same texture on one quad.
 *
 * The triangles are projected onto the ground (the plane through the model's lowest point, normal to the up axis)
 * in height bands. Each band is rasterised into a coverage mask, blurred more the higher it sits and weighted less,
 * then the bands are combined as independent occluders: near the ground the shadow is dark and crisp, higher parts
 * only darken the floor softly.
 */

/** Index of a world axis: 0 = x, 1 = y, 2 = z. */
export type AxisIndex = 0 | 1 | 2;

/**
 * Inputs to {@link computeContactShadow}.
 *
 * @public
 */
export type ContactShadowInput = Readonly<{
  /** Triangle corners, nine numbers per triangle, in the frame the bounds are in. */
  triangles: Float32Array;
  /** The model's bounds in the same frame. */
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  /** The up axis; the ground is normal to it. */
  up: AxisIndex;
  /** Texels per side. */
  resolution?: number;
}>;

/**
 * The shadow texture and where it lies on the ground.
 *
 * @public
 */
export type ContactShadow = Readonly<{
  /** Shadow strength 0–1 per texel, row-major, `resolution × resolution`. Row 0 is the low end of the second axis. */
  alpha: Float32Array;
  resolution: number;
  /** The two ground axes, in order, and the ground's height on the up axis. */
  axes: readonly [AxisIndex, AxisIndex];
  groundHeight: number;
  /** The square of the ground the texture covers, on the two ground axes. */
  origin: readonly [number, number];
  size: number;
}>;

const bandCount = 4;

/** The two axes of the ground for an up axis, keeping a right-handed order. */
export function groundAxes(up: AxisIndex): readonly [AxisIndex, AxisIndex] {
  return up === 2 ? [0, 1] : up === 1 ? [2, 0] : [1, 2];
}

/** Fill one triangle's coverage into a mask by testing texel centres against its edges. */
function rasterizeTriangle(
  mask: Uint8Array<ArrayBuffer>,
  resolution: number,
  /** The three corners in texel units: ax, ay, bx, by, cx, cy. */
  corners: Float64Array,
): void {
  const [ax, ay, bx, by, cx, cy] = corners as unknown as [number, number, number, number, number, number];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) {
    return;
  }
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(resolution - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(resolution - 1, Math.ceil(Math.max(ay, by, cy)));
  const sign = area > 0 ? 1 : -1;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * sign;
      const w1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * sign;
      const w2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * sign;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
        mask[y * resolution + x] = 1;
      }
    }
  }
}

type BlurPass = Readonly<{ resolution: number; radius: number; horizontal: boolean }>;

/** One box blur pass along rows or columns, radius in texels; texels beyond the edge count as empty. */
function boxBlurPass(source: Float32Array, target: Float32Array, { resolution, radius, horizontal }: BlurPass): void {
  const width = radius * 2 + 1;
  for (let line = 0; line < resolution; line++) {
    const at = (index: number): number =>
      index < 0 || index >= resolution
        ? 0
        : horizontal
          ? source[line * resolution + index]!
          : source[index * resolution + line]!;
    let sum = 0;
    for (let index = -radius; index <= radius; index++) {
      sum += at(index);
    }
    for (let index = 0; index < resolution; index++) {
      target[horizontal ? line * resolution + index : index * resolution + line] = sum / width;
      sum += at(index + radius + 1) - at(index - radius);
    }
  }
}

/** Three box passes in each direction approximate a Gaussian of the same footprint. */
function blur(mask: Float32Array, resolution: number, radius: number): Float32Array {
  if (radius < 1) {
    return mask;
  }
  let current: Float32Array = mask;
  let scratch: Float32Array = new Float32Array(mask.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurPass(current, scratch, { resolution, radius, horizontal: true });
    [current, scratch] = [scratch, current];
    boxBlurPass(current, scratch, { resolution, radius, horizontal: false });
    [current, scratch] = [scratch, current];
  }
  return current;
}

/**
 * Compute the contact shadow of a model.
 *
 * @param input - The model's triangles, bounds and up axis.
 * @returns The shadow, or `undefined` for a model without area on the ground.
 * @public
 */
export function computeContactShadow({
  triangles,
  min,
  max,
  up,
  resolution = 256,
}: ContactShadowInput): ContactShadow | undefined {
  const axes = groundAxes(up);
  const [a, b] = axes;
  const spanA = max[a] - min[a];
  const spanB = max[b] - min[b];
  const footprint = Math.max(spanA, spanB);
  const height = max[up] - min[up];
  if (!(footprint > 0) || triangles.length < 9) {
    return undefined;
  }
  // The texture overhangs the footprint so the softest band can fade out inside it.
  const size = footprint * 1.6;
  const origin: [number, number] = [(min[a] + max[a]) / 2 - size / 2, (min[b] + max[b]) / 2 - size / 2];
  const scale = resolution / size;
  // Parts higher than this barely darken the floor; a flat piece casts its whole outline.
  const reach = Math.max(height, footprint * 0.05) * 0.75 + footprint * 0.02;
  const masks = Array.from({ length: bandCount }, () => new Uint8Array(new ArrayBuffer(resolution * resolution)));
  const corners = new Float64Array(6);
  const bandHeight = reach / bandCount;
  let covered = false;
  for (let index = 0; index + 8 < triangles.length; index += 9) {
    const lowest = Math.min(triangles[index + up]!, triangles[index + 3 + up]!, triangles[index + 6 + up]!) - min[up];
    const band = Math.floor(lowest / bandHeight);
    if (band >= bandCount) {
      continue;
    }
    covered = true;
    for (let corner = 0; corner < 3; corner++) {
      corners[corner * 2] = (triangles[index + corner * 3 + a]! - origin[0]) * scale;
      corners[corner * 2 + 1] = (triangles[index + corner * 3 + b]! - origin[1]) * scale;
    }
    rasterizeTriangle(masks[Math.max(0, band)]!, resolution, corners);
  }
  if (!covered) {
    return undefined;
  }
  const light = new Float32Array(resolution * resolution).fill(1);
  const texelsPerFootprint = footprint * scale;
  for (const [band, mask] of masks.entries()) {
    const floatMask = Float32Array.from(mask);
    // Crisp at the ground, a fifth of the footprint wide at the top band.
    const radius = Math.round(texelsPerFootprint * (0.018 + 0.045 * band));
    const blurred = blur(floatMask, resolution, radius);
    const weight = 0.92 * (1 - band / bandCount) ** 1.5;
    for (const [texel, covered] of blurred.entries()) {
      light[texel]! *= 1 - weight * covered;
    }
  }
  // A wide, faint penumbra under the whole piece grounds it even where the bands leave gaps.
  const union = new Float32Array(light.length);
  for (const mask of masks) {
    for (let texel = 0; texel < union.length; texel++) {
      union[texel] = Math.max(union[texel]!, mask[texel]!);
    }
  }
  const ambient = blur(union, resolution, Math.round(texelsPerFootprint * 0.09));
  const alpha = light.map((value, texel) => 1 - value * (1 - 0.75 * ambient[texel]!));
  return { alpha, resolution, axes, groundHeight: min[up], origin, size };
}
