import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three';
import type { RenderFrame } from '@taucad/spatial';
import { toRenderPoint } from '@taucad/spatial';
import type { SketchFrame, SketchVec2 } from '#graphics/three/react/sketch-geometry.js';
import type { SketchGhost } from '#graphics/three/react/sketch-tool.js';

/**
 * The matrix from a sketch's own millimetres (x, y on the plane, z up its normal) to the viewer's render space.
 * @param frame - The sketch plane in model millimetres.
 * @param renderFrame - The floating render frame.
 * @returns An affine placement for every sketch overlay.
 * @internal
 */
export function sketchToRenderMatrix(frame: SketchFrame, renderFrame: RenderFrame): Matrix4 {
  const toRender = (millimetres: readonly [number, number, number]): Vector3 =>
    new Vector3(
      ...toRenderPoint({
        renderFrame,
        point: [millimetres[0] / 1000, millimetres[1] / 1000, millimetres[2] / 1000],
      }),
    );
  const origin = toRender(frame.origin);
  const axis = (direction: readonly [number, number, number]): Vector3 =>
    toRender([frame.origin[0] + direction[0], frame.origin[1] + direction[1], frame.origin[2] + direction[2]]).sub(
      origin,
    );
  return new Matrix4().makeBasis(axis(frame.xDir), axis(frame.yDir), axis(frame.normal)).setPosition(origin);
}

const signedArea = (polygon: readonly SketchVec2[]): number => {
  let sum = 0;
  for (const [index, point] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]!;
    sum += point.x * next.y - point.y * next.x;
  }
  return sum / 2;
};

/** Triangles of a simple polygon, as index triples into it. */
const triangulate = (polygon: readonly SketchVec2[]): number[][] =>
  ShapeUtils.triangulateShape(
    polygon.map(({ x, y }) => new Vector2(x, y)),
    [],
  );

/**
 * A polygon moved inward by `inset` (outward when negative), corner by corner along the bisectors: the top of a
 * drafted extrusion. A ghost only; the kernel computes the real draft.
 */
function insetPolygon(polygon: readonly SketchVec2[], inset: number): SketchVec2[] {
  const sign = signedArea(polygon) >= 0 ? 1 : -1;
  return polygon.map((point, index) => {
    const before = polygon[(index + polygon.length - 1) % polygon.length]!;
    const after = polygon[(index + 1) % polygon.length]!;
    const inward = (from: SketchVec2, to: SketchVec2): SketchVec2 => {
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: (-(to.y - from.y) / length) * sign, y: ((to.x - from.x) / length) * sign };
    };
    const first = inward(before, point);
    const second = inward(point, after);
    const bisector = { x: first.x + second.x, y: first.y + second.y };
    const length = Math.hypot(bisector.x, bisector.y);
    if (length < 1e-9) {
      return point;
    }
    const cosine = Math.max(0.2, (bisector.x * first.x + bisector.y * first.y) / length);
    const scale = inset / cosine / length;
    return { x: point.x + bisector.x * scale, y: point.y + bisector.y * scale };
  });
}

/** Side walls between two rings of the same polygon, plus caps when asked. */
function loftRings(
  rings: ReadonlyArray<readonly Vector3[]>,
  options: Readonly<{ closedPath: boolean; caps?: readonly [number[][], number[][]] }>,
): BufferGeometry {
  const positions: number[] = [];
  const push = (...points: Vector3[]): void => {
    for (const point of points) {
      positions.push(point.x, point.y, point.z);
    }
  };
  const ringCount = options.closedPath ? rings.length : rings.length - 1;
  for (let ring = 0; ring < ringCount; ring++) {
    const current = rings[ring]!;
    const next = rings[(ring + 1) % rings.length]!;
    for (let index = 0; index < current.length; index++) {
      const following = (index + 1) % current.length;
      push(current[index]!, current[following]!, next[following]!);
      push(current[index]!, next[following]!, next[index]!);
    }
  }
  if (options.caps && !options.closedPath) {
    const [first, last] = [rings[0]!, rings.at(-1)!];
    for (const triangle of options.caps[0]) {
      push(first[triangle[0]!]!, first[triangle[2]!]!, first[triangle[1]!]!);
    }
    for (const triangle of options.caps[1]) {
      push(last[triangle[0]!]!, last[triangle[1]!]!, last[triangle[2]!]!);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Rotate a point about an axis through `origin` along unit `direction` (Rodrigues). */
const rotateAbout = (
  point: Vector3,
  { origin, direction, angle }: Readonly<{ origin: Vector3; direction: Vector3; angle: number }>,
): Vector3 => {
  const relative = point.clone().sub(origin);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotated = relative
    .clone()
    .multiplyScalar(cosine)
    .add(direction.clone().cross(relative).multiplyScalar(sine))
    .add(direction.clone().multiplyScalar(direction.dot(relative) * (1 - cosine)));
  return rotated.add(origin);
};

/**
 * The ghost of an operation on a closed profile, in sketch millimetres (place it with {@link sketchToRenderMatrix}).
 * @param ghost - What the host previews.
 * @param pathToSketch - Turns a model-space path point into sketch millimetres (x, y and the height on the normal).
 * @returns Triangles of the previewed solid, or nothing for a degenerate profile.
 * @internal
 */
export function sketchGhostGeometry(
  ghost: SketchGhost,
  pathToSketch: (point: readonly [number, number, number]) => Vector3,
): BufferGeometry | undefined {
  const { polygon } = ghost;
  if (polygon.length < 3 || Math.abs(signedArea(polygon)) < 1e-9) {
    return undefined;
  }
  const cap = triangulate(polygon);
  switch (ghost.kind) {
    case 'extrude': {
      if (Math.abs(ghost.distance) < 1e-9) {
        return undefined;
      }
      const top = ghost.taper
        ? insetPolygon(polygon, Math.abs(ghost.distance) * Math.tan((ghost.taper * Math.PI) / 180))
        : polygon;
      const bottomRing = polygon.map(({ x, y }) => new Vector3(x, y, 0));
      const topRing = top.map(({ x, y }) => new Vector3(x, y, ghost.distance));
      return loftRings([bottomRing, topRing], { closedPath: false, caps: [cap, cap] });
    }
    case 'revolve': {
      const origin = new Vector3(ghost.axis.start.x, ghost.axis.start.y, 0);
      const direction = new Vector3(ghost.axis.end.x - ghost.axis.start.x, ghost.axis.end.y - ghost.axis.start.y, 0);
      if (direction.lengthSq() < 1e-12 || Math.abs(ghost.angle) < 1e-6) {
        return undefined;
      }
      direction.normalize();
      const full = Math.abs(ghost.angle) >= 360 - 1e-6;
      const steps = Math.max(8, Math.ceil(Math.abs(ghost.angle) / 6));
      const base = polygon.map(({ x, y }) => new Vector3(x, y, 0));
      const rings = Array.from({ length: full ? steps : steps + 1 }, (_, step) =>
        base.map((point) =>
          rotateAbout(point, { origin, direction, angle: ((ghost.angle * Math.PI) / 180) * (step / steps) }),
        ),
      );
      return loftRings(rings, { closedPath: full, caps: [cap, cap] });
    }
    case 'sweep': {
      const path = ghost.path.map((point) => pathToSketch(point));
      if (path.length < 2) {
        return undefined;
      }
      const closedPath = path.length > 2 && path[0]!.distanceTo(path.at(-1)!) < 1e-6;
      const points = closedPath ? path.slice(0, -1) : path;
      // The profile's box center goes to the start of the path, turned to face along it (the kernel's anchor).
      const minX = Math.min(...polygon.map(({ x }) => x));
      const maxX = Math.max(...polygon.map(({ x }) => x));
      const minY = Math.min(...polygon.map(({ y }) => y));
      const maxY = Math.max(...polygon.map(({ y }) => y));
      const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0);
      const local = polygon.map(({ x, y }) => new Vector3(x, y, 0).sub(center));
      const tangentAt = (index: number): Vector3 => {
        const before = points[closedPath ? (index + points.length - 1) % points.length : Math.max(0, index - 1)]!;
        const after = points[closedPath ? (index + 1) % points.length : Math.min(points.length - 1, index + 1)]!;
        return after.clone().sub(before).normalize();
      };
      // Rotation-minimizing frames: the profile normal (+Z) turns onto the first tangent, then follows the path.
      let direction = new Vector3(0, 0, 1);
      const attitude = new Quaternion();
      const rings: Vector3[][] = [];
      for (const [index, center] of points.entries()) {
        const tangent = tangentAt(index);
        attitude.premultiply(new Quaternion().setFromUnitVectors(direction, tangent));
        direction = tangent;
        rings.push(local.map((point) => point.clone().applyQuaternion(attitude).add(center)));
      }
      return loftRings(rings, { closedPath, caps: [cap, cap] });
    }
  }
}
