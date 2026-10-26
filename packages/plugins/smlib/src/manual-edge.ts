import type { Edge, Part, Vector } from '@classcad/smlibwasm';
import { manualEdgeGeometrySchema } from '#manual-operations.js';
import type { ManualEdgeGeometry, ManualVector } from '#manual-operations.js';

const vector = (value: Vector): ManualVector => [value.x, value.y, value.z];
// Native millimetre descriptors tolerate 1e-5 mm numerical noise, not display tessellation error.
const positionTolerance = 1e-5;
const closeNumber = (a: number, b: number): boolean => Math.abs(a - b) <= positionTolerance;
const closeVector = (a: ManualVector, b: ManualVector): boolean =>
  a.every((value, index) => closeNumber(value, b[index]!));

/**
 * Describe the whole exact native curve, its extent and adjacency for guarded edge replay.
 * @param edge - An edge belonging to the selected native solid.
 * @returns Its descriptor, or undefined when the native curve cannot be represented safely.
 */
export function manualEdgeGeometry(edge: Edge): ManualEdgeGeometry | undefined {
  try {
    const bounds = edge.bbox();
    const base = {
      length: edge.length,
      bounds: { min: vector(bounds.min), max: vector(bounds.max) },
      adjacentFaceCount: edge.faces().length,
      seam: edge.isSeam,
      closed: edge.isClosed,
    };
    let geometry: unknown;
    if (edge.geomType === 'line') {
      geometry = { ...base, kind: 'line', start: vector(edge.start), end: vector(edge.end) };
    } else if (edge.geomType === 'circle') {
      geometry = {
        ...base,
        kind: 'circle',
        start: vector(edge.start),
        end: vector(edge.end),
        center: vector(edge.arcCenter),
        normal: vector(edge.normal),
        radius: edge.radius,
      };
    } else if (edge.geomType === 'bspline') {
      const nurbs = edge.nurbs();
      geometry = {
        ...base,
        kind: 'nurbs',
        degree: nurbs.degree,
        knots: nurbs.knots,
        points: nurbs.points.map((point) => vector(point)),
        weights: nurbs.weights,
      };
    } else {
      // The native API approximates other curve types during NURBS conversion; do not publish those as exact identities.
      return undefined;
    }
    const parsed = manualEdgeGeometrySchema.safeParse(geometry);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const sameEndpoints = (
  a: { start: ManualVector; end: ManualVector },
  b: { start: ManualVector; end: ManualVector },
): boolean =>
  (closeVector(a.start, b.start) && closeVector(a.end, b.end)) ||
  (closeVector(a.start, b.end) && closeVector(a.end, b.start));
const normalizedKnots = (knots: number[]): number[] => {
  const start = knots[0]!;
  const range = knots.at(-1)! - start;
  return knots.map((value) => (value - start) / range);
};
const normalizedWeights = (geometry: Extract<ManualEdgeGeometry, { kind: 'nurbs' }>): number[] => {
  const weights = geometry.weights ?? geometry.points.map(() => 1);
  const scale = weights.find((weight) => Math.abs(weight) > 1e-12) ?? 1;
  return weights.map((weight) => weight / scale);
};
const closeScalars = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((value, index) => Math.abs(value - b[index]!) <= 1e-8);
const sameNurbs = (
  actual: Extract<ManualEdgeGeometry, { kind: 'nurbs' }>,
  expected: Extract<ManualEdgeGeometry, { kind: 'nurbs' }>,
): boolean => {
  if (actual.degree !== expected.degree || actual.points.length !== expected.points.length) {
    return false;
  }
  const aKnots = normalizedKnots(actual.knots);
  const bKnots = normalizedKnots(expected.knots);
  const aWeights = normalizedWeights(actual);
  const bWeights = normalizedWeights(expected);
  const forward =
    actual.points.every((point, index) => closeVector(point, expected.points[index]!)) &&
    closeScalars(aKnots, bKnots) &&
    closeScalars(aWeights, bWeights);
  const reversedWeights = bWeights.toReversed();
  const reverseScale = reversedWeights.find((weight) => Math.abs(weight) > 1e-12) ?? 1;
  const reversed =
    actual.points.every((point, index) => closeVector(point, expected.points[expected.points.length - 1 - index]!)) &&
    closeScalars(
      aKnots,
      bKnots.toReversed().map((value) => 1 - value),
    ) &&
    closeScalars(
      aWeights,
      reversedWeights.map((weight) => weight / reverseScale),
    );
  return forward || reversed;
};

const matchesGeometry = (actual: ManualEdgeGeometry, expected: ManualEdgeGeometry): boolean => {
  if (
    actual.kind !== expected.kind ||
    actual.closed !== expected.closed ||
    actual.seam !== expected.seam ||
    actual.adjacentFaceCount !== expected.adjacentFaceCount ||
    !closeNumber(actual.length, expected.length) ||
    !closeVector(actual.bounds.min, expected.bounds.min) ||
    !closeVector(actual.bounds.max, expected.bounds.max)
  ) {
    return false;
  }
  if (actual.kind === 'line' && expected.kind === 'line') {
    return sameEndpoints(actual, expected);
  }
  if (actual.kind === 'circle' && expected.kind === 'circle') {
    const dot =
      actual.normal[0] * expected.normal[0] +
      actual.normal[1] * expected.normal[1] +
      actual.normal[2] * expected.normal[2];
    const parallel = Math.abs(dot / Math.hypot(...expected.normal)) >= 1 - 1e-10;
    return (
      parallel &&
      closeNumber(actual.radius, expected.radius) &&
      closeVector(actual.center, expected.center) &&
      (actual.closed || sameEndpoints(actual, expected))
    );
  }
  return actual.kind === 'nurbs' && expected.kind === 'nurbs' && sameNurbs(actual, expected);
};

/**
 * Resolve each selected exact curve uniquely; native enumeration indices are only display hints.
 * @param part - Rebuilt native solid at the guarded replay prefix.
 * @param geometries - Stored complete curve descriptors in selection order.
 * @returns One distinct native edge per descriptor, refusing ambiguity or changed geometry.
 */
export function resolveManualEdges(part: Part, geometries: readonly ManualEdgeGeometry[]): Edge[] {
  const edges = [...part.edges()];
  const described = edges.map((edge) => manualEdgeGeometry(edge));
  const selected = new Set<number>();
  return geometries.map((geometry) => {
    const matches = described.flatMap((descriptor, index) =>
      descriptor && matchesGeometry(descriptor, geometry) ? [index] : [],
    );
    if (matches.length !== 1) {
      throw new Error('The selected edge cannot be matched uniquely on replay. Re-select it.');
    }
    const index = matches[0]!;
    if (selected.has(index)) {
      throw new Error('Each picked edge must resolve to a distinct native curve.');
    }
    selected.add(index);
    return edges[index]!;
  });
}
