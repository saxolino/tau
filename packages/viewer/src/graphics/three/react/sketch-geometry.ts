/**
 * Plane geometry of a sketch drawn on the model: entities in the sketch's own millimetres, the snaps a pointer lands
 * on, the model's edges laid onto the sketch plane, and the closed loops a profile is made of. Pure functions only, so
 * the viewer (which draws and snaps) and the host (which turns a loop into a native profile) share one geometry.
 */

/** A point in the sketch plane, in millimetres along its local X and Y. @public */
export type SketchVec2 = Readonly<{ x: number; y: number }>;

/** A point in model millimetres (Tau Z-up). @public */
export type SketchVec3 = readonly [number, number, number];

/**
 * The plane a sketch lies on, in model millimetres: local X along `xDir`, local Y along `yDir`, `normal` out of the
 * face (towards the camera that looks at the sketch). The three directions are unit and orthogonal. @public
 */
export type SketchFrame = Readonly<{ origin: SketchVec3; xDir: SketchVec3; yDir: SketchVec3; normal: SketchVec3 }>;

/**
 * One drawn entity. Arcs keep the three points they were drawn through (a tangent arc is stored the same way), so
 * every entity maps to an exact native curve: a line, a circular arc, a circle or a spline through points. @public
 */
export type SketchEntity =
  | Readonly<{ kind: 'line'; id: string; start: SketchVec2; end: SketchVec2 }>
  | Readonly<{ kind: 'arc'; id: string; start: SketchVec2; through: SketchVec2; end: SketchVec2 }>
  | Readonly<{ kind: 'circle'; id: string; center: SketchVec2; radius: number }>
  | Readonly<{ kind: 'spline'; id: string; points: readonly SketchVec2[] }>;

/** What a pointer snapped to, in priority order of the snap search. @public */
export type SketchSnapKind =
  | 'endpoint'
  | 'center'
  | 'midpoint'
  | 'modelVertex'
  | 'modelEdge'
  | 'horizontal'
  | 'vertical'
  | 'grid'
  | 'free';

/** A snapped pointer position; `guide` is the alignment line drawn for a horizontal or vertical snap. @public */
export type SketchSnap = Readonly<{
  point: SketchVec2;
  kind: SketchSnapKind;
  guide?: Readonly<{ from: SketchVec2; to: SketchVec2 }>;
}>;

/** A point a pointer can snap to. @public */
export type SketchSnapPoint = Readonly<{ point: SketchVec2; kind: 'endpoint' | 'center' | 'midpoint' | 'modelVertex' }>;

/** A model edge laid onto the sketch plane: a 2D segment. @public */
export type SketchSegment = Readonly<{ a: SketchVec2; b: SketchVec2 }>;

/** One entity of a loop, traversed forwards or backwards. @public */
export type SketchLoopPart = Readonly<{ entity: SketchEntity; reversed: boolean }>;

/** A closed chain of entities (or one circle), in traversal order. @public */
export type SketchLoop = Readonly<{ parts: readonly SketchLoopPart[] }>;

/** Two sketch points closer than this many millimetres are the same point. @public */
export const sketchPointTolerance = 1e-6;

const sub = (a: SketchVec2, b: SketchVec2): SketchVec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: SketchVec2, b: SketchVec2): number => a.x * b.x + a.y * b.y;
const cross = (a: SketchVec2, b: SketchVec2): number => a.x * b.y - a.y * b.x;
const distance = (a: SketchVec2, b: SketchVec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: SketchVec2, b: SketchVec2, t: number): SketchVec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * Whether two sketch points coincide.
 * @param a - First point.
 * @param b - Second point.
 * @param tolerance - Millimetres.
 * @returns True within the tolerance.
 * @public
 */
export function sameSketchPoint(a: SketchVec2, b: SketchVec2, tolerance = sketchPointTolerance): boolean {
  return distance(a, b) <= tolerance;
}

/**
 * The circle through three points.
 * @param a - First point.
 * @param b - Second point.
 * @param c - Third point.
 * @returns Its center and radius, or nothing when the points are on one line.
 * @public
 */
export function circleThroughThreePoints(
  a: SketchVec2,
  b: SketchVec2,
  c: SketchVec2,
): Readonly<{ center: SketchVec2; radius: number }> | undefined {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const scale = Math.max(distance(a, b), distance(b, c), distance(a, c), 1e-9);
  if (Math.abs(d) <= 1e-9 * scale * scale) {
    return undefined;
  }
  const a2 = a.x ** 2 + a.y ** 2;
  const b2 = b.x ** 2 + b.y ** 2;
  const c2 = c.x ** 2 + c.y ** 2;
  const center = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
  return { center, radius: distance(center, a) };
}

/** The signed sweep, in radians, of the arc from `start` through `through` to `end` around `center`. */
function arcSweep(
  center: SketchVec2,
  { start, through, end }: Readonly<{ start: SketchVec2; through: SketchVec2; end: SketchVec2 }>,
): number {
  const angle = (point: SketchVec2): number => Math.atan2(point.y - center.y, point.x - center.x);
  const turn = (from: number, to: number): number => {
    const value = (to - from) % (2 * Math.PI);
    return value < 0 ? value + 2 * Math.PI : value;
  };
  const counterclockwise = cross(sub(through, start), sub(end, through)) > 0;
  const total = turn(angle(start), angle(end));
  return counterclockwise ? total : total - 2 * Math.PI;
}

/**
 * The through point of the arc that leaves `start` along `tangent` and ends at `end`: a tangent arc, stored as a
 * three-point arc like any other.
 * @param start - Where the arc starts.
 * @param tangent - The direction it leaves in (any length).
 * @param end - Where it ends.
 * @returns The arc's middle point, or nothing when `end` lies on the tangent line.
 * @public
 */
export function tangentArcThrough(start: SketchVec2, tangent: SketchVec2, end: SketchVec2): SketchVec2 | undefined {
  const length = Math.hypot(tangent.x, tangent.y);
  if (length <= 1e-12) {
    return undefined;
  }
  const t = { x: tangent.x / length, y: tangent.y / length };
  const normal = { x: -t.y, y: t.x };
  const chord = sub(end, start);
  const along = dot(chord, normal);
  if (Math.abs(along) <= 1e-9 * Math.max(Math.hypot(chord.x, chord.y), 1)) {
    return undefined;
  }
  const k = dot(chord, chord) / (2 * along);
  const center = { x: start.x + normal.x * k, y: start.y + normal.y * k };
  const radius = Math.abs(k);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  // Turning left (center on the left) runs counterclockwise.
  let sweep = endAngle - startAngle;
  if (k > 0) {
    sweep = sweep <= 0 ? sweep + 2 * Math.PI : sweep;
  } else {
    sweep = sweep >= 0 ? sweep - 2 * Math.PI : sweep;
  }
  const middle = startAngle + sweep / 2;
  return { x: center.x + radius * Math.cos(middle), y: center.y + radius * Math.sin(middle) };
}

/**
 * The direction an entity runs in at one of its ends, pointing along its traversal.
 * @param entity - A line, arc or spline.
 * @param at - Which end.
 * @returns A unit direction, or nothing for a circle.
 * @public
 */
export function sketchEndTangent(entity: SketchEntity, at: 'start' | 'end'): SketchVec2 | undefined {
  const unit = (value: SketchVec2): SketchVec2 | undefined => {
    const length = Math.hypot(value.x, value.y);
    return length > 1e-12 ? { x: value.x / length, y: value.y / length } : undefined;
  };
  switch (entity.kind) {
    case 'line': {
      return unit(sub(entity.end, entity.start));
    }
    case 'arc': {
      const circle = circleThroughThreePoints(entity.start, entity.through, entity.end);
      if (!circle) {
        return undefined;
      }
      const sweep = arcSweep(circle.center, entity);
      const point = at === 'start' ? entity.start : entity.end;
      const radial = sub(point, circle.center);
      // Counterclockwise travel turns the radius a quarter left.
      return unit(sweep > 0 ? { x: -radial.y, y: radial.x } : { x: radial.y, y: -radial.x });
    }
    case 'spline': {
      const points = sketchEntitySamples(entity, 32);
      return at === 'start' ? unit(sub(points[1]!, points[0]!)) : unit(sub(points.at(-1)!, points.at(-2)!));
    }
    case 'circle': {
      return undefined;
    }
  }
}

/** Catmull-Rom samples through the points: the preview of a spline (the native curve is the kernel's own). */
function splineSamples(points: readonly SketchVec2[], perSpan: number): SketchVec2[] {
  if (points.length < 3) {
    return [...points];
  }
  const result: SketchVec2[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    for (let step = 0; step < perSpan; step++) {
      const t = step / perSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  result.push(points.at(-1)!);
  return result;
}

/**
 * Points along an entity for drawing it: a polyline from its start to its end (a circle is closed, its first point
 * repeated last).
 * @param entity - Any entity.
 * @param segments - Samples on a full circle; arcs and splines scale it.
 * @returns The polyline in sketch millimetres.
 * @public
 */
export function sketchEntitySamples(entity: SketchEntity, segments = 64): SketchVec2[] {
  switch (entity.kind) {
    case 'line': {
      return [entity.start, entity.end];
    }
    case 'circle': {
      return Array.from({ length: segments + 1 }, (_, index) => {
        const angle = (index / segments) * 2 * Math.PI;
        return {
          x: entity.center.x + entity.radius * Math.cos(angle),
          y: entity.center.y + entity.radius * Math.sin(angle),
        };
      });
    }
    case 'arc': {
      const circle = circleThroughThreePoints(entity.start, entity.through, entity.end);
      if (!circle) {
        return [entity.start, entity.through, entity.end];
      }
      const sweep = arcSweep(circle.center, entity);
      const count = Math.max(4, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * segments));
      const startAngle = Math.atan2(entity.start.y - circle.center.y, entity.start.x - circle.center.x);
      return Array.from({ length: count + 1 }, (_, index) => {
        if (index === count) {
          return entity.end;
        }
        const angle = startAngle + (sweep * index) / count;
        return {
          x: circle.center.x + circle.radius * Math.cos(angle),
          y: circle.center.y + circle.radius * Math.sin(angle),
        };
      });
    }
    case 'spline': {
      return splineSamples(entity.points, Math.max(4, Math.round(segments / 8)));
    }
  }
}

/**
 * Where an open entity starts and ends.
 * @param entity - Any entity.
 * @returns Its two ends, or nothing for a circle.
 * @public
 */
export function sketchEntityEnds(entity: SketchEntity): readonly [SketchVec2, SketchVec2] | undefined {
  switch (entity.kind) {
    case 'line':
    case 'arc': {
      return [entity.start, entity.end];
    }
    case 'spline': {
      return [entity.points[0]!, entity.points.at(-1)!];
    }
    case 'circle': {
      return undefined;
    }
  }
}

/**
 * The points of the drawn entities a pointer snaps to: ends, middles of lines and arcs, centers of arcs and circles.
 * @param entities - The sketch so far.
 * @returns Snap points, ends first.
 * @public
 */
export function sketchSnapPoints(entities: readonly SketchEntity[]): SketchSnapPoint[] {
  const ends: SketchSnapPoint[] = [];
  const others: SketchSnapPoint[] = [];
  for (const entity of entities) {
    const pair = sketchEntityEnds(entity);
    if (pair) {
      ends.push({ point: pair[0], kind: 'endpoint' }, { point: pair[1], kind: 'endpoint' });
    }
    switch (entity.kind) {
      case 'line': {
        others.push({ point: lerp(entity.start, entity.end, 0.5), kind: 'midpoint' });
        break;
      }
      case 'arc': {
        others.push({ point: entity.through, kind: 'midpoint' });
        const circle = circleThroughThreePoints(entity.start, entity.through, entity.end);
        if (circle) {
          others.push({ point: circle.center, kind: 'center' });
        }
        break;
      }
      case 'circle': {
        others.push({ point: entity.center, kind: 'center' });
        break;
      }
      case 'spline': {
        break;
      }
    }
  }
  return [...ends, ...others];
}

/**
 * A model point in the sketch's own millimetres.
 * @param point - Model millimetres.
 * @param frame - The sketch plane.
 * @returns Local X and Y, and the signed height above the plane.
 * @public
 */
export function toSketchPoint(point: SketchVec3, frame: SketchFrame): SketchVec2 & { height: number } {
  const relative = [point[0] - frame.origin[0], point[1] - frame.origin[1], point[2] - frame.origin[2]] as const;
  const along = (axis: SketchVec3): number => relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
  return { x: along(frame.xDir), y: along(frame.yDir), height: along(frame.normal) };
}

/**
 * A sketch point in model millimetres.
 * @param point - Local millimetres.
 * @param frame - The sketch plane.
 * @returns The model point.
 * @public
 */
export function fromSketchPoint(point: SketchVec2, frame: SketchFrame): SketchVec3 {
  return [0, 1, 2].map(
    (axis) => frame.origin[axis]! + point.x * frame.xDir[axis]! + point.y * frame.yDir[axis]!,
  ) as unknown as SketchVec3;
}

/**
 * Lay the model's edges onto the sketch plane, as a draftsman projects them before drawing on a face: each edge
 * segment becomes a 2D segment, an edge seen end-on becomes a point.
 * @param segments - Model edge segments in millimetres.
 * @param frame - The sketch plane.
 * @returns Projected segments and their end points (deduplicated), for snapping.
 * @public
 */
export function projectModelEdges(
  segments: ReadonlyArray<readonly [SketchVec3, SketchVec3]>,
  frame: SketchFrame,
): Readonly<{ segments: SketchSegment[]; points: SketchSnapPoint[] }> {
  const projected: SketchSegment[] = [];
  const points: SketchSnapPoint[] = [];
  const seen = new Set<string>();
  const addPoint = (point: SketchVec2): void => {
    const key = `${Math.round(point.x * 1e4)}:${Math.round(point.y * 1e4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push({ point: { x: point.x, y: point.y }, kind: 'modelVertex' });
    }
  };
  for (const [first, second] of segments) {
    const a = toSketchPoint(first, frame);
    const b = toSketchPoint(second, frame);
    const flatA = { x: a.x, y: a.y };
    const flatB = { x: b.x, y: b.y };
    if (distance(flatA, flatB) > 1e-6) {
      projected.push({ a: flatA, b: flatB });
    }
  }
  // Vertices are the ends of polylines: points shared by fewer than two segments, or corners between them.
  const ends = new Map<string, { point: SketchVec2; directions: SketchVec2[] }>();
  for (const segment of projected) {
    for (const [point, other] of [
      [segment.a, segment.b],
      [segment.b, segment.a],
    ] as const) {
      const key = `${Math.round(point.x * 1e4)}:${Math.round(point.y * 1e4)}`;
      const length = distance(point, other);
      const entry = ends.get(key) ?? { point, directions: [] };
      entry.directions.push({ x: (other.x - point.x) / length, y: (other.y - point.y) / length });
      ends.set(key, entry);
    }
  }
  for (const { point, directions } of ends.values()) {
    // A point where a polyline only continues straight is a tessellation sample, not a vertex.
    const isStraightThrough = directions.length === 2 && dot(directions[0]!, directions[1]!) < -0.999;
    const isSmoothThrough = directions.length === 2 && dot(directions[0]!, directions[1]!) < -0.97;
    if (!isStraightThrough && !isSmoothThrough) {
      addPoint(point);
    }
  }
  return { segments: projected, points };
}

/**
 * The closest point of a segment.
 * @param point - Any point.
 * @param segment - The segment.
 * @returns The nearest point on it.
 * @public
 */
export function closestOnSketchSegment(point: SketchVec2, segment: SketchSegment): SketchVec2 {
  const ab = sub(segment.b, segment.a);
  const lengthSquared = dot(ab, ab);
  if (lengthSquared <= 1e-18) {
    return segment.a;
  }
  const t = Math.min(1, Math.max(0, dot(sub(point, segment.a), ab) / lengthSquared));
  return lerp(segment.a, segment.b, t);
}

const pointPriority: Record<SketchSnapPoint['kind'], number> = { endpoint: 0, center: 1, midpoint: 2, modelVertex: 3 };

/**
 * Snap a pointer position: to a drawn point (an end, a center, a middle), a model vertex, a model edge laid on the
 * plane, the horizontal or vertical of the previous point, or the grid, in that order.
 * @param input - The raw position, the tolerance in millimetres (a few pixels at the current zoom), the candidates.
 * @returns Where the point lands and why.
 * @public
 */
export function snapSketchPoint(
  input: Readonly<{
    raw: SketchVec2;
    tolerance: number;
    points?: readonly SketchSnapPoint[];
    segments?: readonly SketchSegment[];
    /** The previous point of the gesture, for horizontal and vertical. */
    reference?: SketchVec2;
    /** Grid step in millimetres; zero or absent leaves the free position. */
    grid?: number;
  }>,
): SketchSnap {
  const { raw, tolerance } = input;
  let best: SketchSnapPoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of input.points ?? []) {
    const gap = distance(raw, candidate.point);
    if (gap > tolerance) {
      continue;
    }
    // Within the tolerance a drawn end beats a middle, then the nearest wins.
    if (
      !best ||
      pointPriority[candidate.kind] < pointPriority[best.kind] ||
      (pointPriority[candidate.kind] === pointPriority[best.kind] && gap < bestDistance)
    ) {
      best = candidate;
      bestDistance = gap;
    }
  }
  if (best) {
    return { point: best.point, kind: best.kind };
  }
  let edgePoint: SketchVec2 | undefined;
  let edgeDistance = tolerance;
  for (const segment of input.segments ?? []) {
    const closest = closestOnSketchSegment(raw, segment);
    const gap = distance(raw, closest);
    if (gap <= edgeDistance) {
      edgePoint = closest;
      edgeDistance = gap;
    }
  }
  if (edgePoint) {
    return { point: edgePoint, kind: 'modelEdge' };
  }
  const grid = input.grid && input.grid > 0 ? input.grid : undefined;
  const onGrid = (value: number): number => (grid ? Math.round(value / grid) * grid : value);
  const { reference } = input;
  if (reference) {
    const dx = Math.abs(raw.x - reference.x);
    const dy = Math.abs(raw.y - reference.y);
    if (dy <= tolerance && dx > tolerance) {
      const point = { x: onGrid(raw.x), y: reference.y };
      return { point, kind: 'horizontal', guide: { from: reference, to: point } };
    }
    if (dx <= tolerance && dy > tolerance) {
      const point = { x: reference.x, y: onGrid(raw.y) };
      return { point, kind: 'vertical', guide: { from: reference, to: point } };
    }
  }
  if (grid) {
    return { point: { x: onGrid(raw.x), y: onGrid(raw.y) }, kind: 'grid' };
  }
  return { point: raw, kind: 'free' };
}

/**
 * The closed loops of a sketch: each circle on its own, and every chain of lines, arcs and splines whose ends meet
 * and come back to where they started. Entities that close no loop (an axis, a path) are left out.
 * @param entities - The sketch.
 * @param tolerance - Millimetres within which two ends meet.
 * @returns The loops, in drawing order of their first entity.
 * @public
 */
export function sketchLoops(entities: readonly SketchEntity[], tolerance = 1e-4): SketchLoop[] {
  const loops: SketchLoop[] = [];
  const open = entities.filter((entity) => entity.kind !== 'circle');
  const used = new Set<string>();
  for (const entity of entities) {
    if (entity.kind === 'circle') {
      loops.push({ parts: [{ entity, reversed: false }] });
    }
  }
  for (const first of open) {
    if (used.has(first.id)) {
      continue;
    }
    // Walk forwards from the first entity's end until the chain returns to its start or stops.
    const firstEnds = sketchEntityEnds(first)!;
    const parts: SketchLoopPart[] = [{ entity: first, reversed: false }];
    const taken = new Set([first.id]);
    let tip = firstEnds[1];
    let closed = sameSketchPoint(firstEnds[0], tip, tolerance) && first.kind === 'spline';
    const continuing = (point: SketchVec2): SketchEntity | undefined =>
      open.find((candidate) => {
        if (taken.has(candidate.id) || used.has(candidate.id)) {
          return false;
        }
        const ends = sketchEntityEnds(candidate)!;
        return sameSketchPoint(ends[0], point, tolerance) || sameSketchPoint(ends[1], point, tolerance);
      });
    while (!closed) {
      const next = continuing(tip);
      if (!next) {
        break;
      }
      const ends = sketchEntityEnds(next)!;
      const reversed = !sameSketchPoint(ends[0], tip, tolerance);
      parts.push({ entity: next, reversed });
      taken.add(next.id);
      tip = reversed ? ends[0] : ends[1];
      closed = sameSketchPoint(tip, firstEnds[0], tolerance);
    }
    if (closed) {
      for (const id of taken) {
        used.add(id);
      }
      loops.push({ parts });
    }
  }
  return loops;
}

/**
 * A loop as one closed polygon, for its veil, its area and the operation ghosts.
 * @param loop - A closed loop.
 * @param segments - Samples on a full circle.
 * @returns The polygon without its closing point repeated.
 * @public
 */
export function sketchLoopPolygon(loop: SketchLoop, segments = 64): SketchVec2[] {
  const polygon: SketchVec2[] = [];
  for (const { entity, reversed } of loop.parts) {
    const samples = sketchEntitySamples(entity, segments);
    const ordered = reversed ? samples.toReversed() : samples;
    polygon.push(...ordered.slice(0, -1));
  }
  return polygon;
}

/**
 * The signed area of a polygon: positive counterclockwise.
 * @param polygon - Its vertices in order.
 * @returns Square millimetres.
 * @public
 */
export function sketchPolygonArea(polygon: readonly SketchVec2[]): number {
  return polygon.reduce((sum, point, index) => sum + cross(point, polygon[(index + 1) % polygon.length]!), 0) / 2;
}

/**
 * A rectangle between two opposite corners, its corners optionally rounded with tangent arcs.
 * @param input - Corners, a corner radius (clamped to half the shorter side) and an id factory.
 * @returns Four lines, with four arcs between them when rounded; nothing for a degenerate rectangle.
 * @public
 */
export function sketchRectangle(
  input: Readonly<{ first: SketchVec2; second: SketchVec2; radius?: number; id: () => string }>,
): SketchEntity[] {
  const minX = Math.min(input.first.x, input.second.x);
  const maxX = Math.max(input.first.x, input.second.x);
  const minY = Math.min(input.first.y, input.second.y);
  const maxY = Math.max(input.first.y, input.second.y);
  if (maxX - minX <= 1e-6 || maxY - minY <= 1e-6) {
    return [];
  }
  const radius = Math.min(Math.max(input.radius ?? 0, 0), (maxX - minX) / 2, (maxY - minY) / 2);
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  if (radius <= 1e-6) {
    return corners.map((corner, index) => ({
      kind: 'line',
      id: input.id(),
      start: corner,
      end: corners[(index + 1) % 4]!,
    }));
  }
  const entities: SketchEntity[] = [];
  // Counterclockwise: along each side, then round the next corner.
  const inset = (corner: SketchVec2, toward: SketchVec2): SketchVec2 => {
    const length = distance(corner, toward);
    return lerp(corner, toward, radius / length);
  };
  for (let index = 0; index < 4; index++) {
    const corner = corners[index]!;
    const next = corners[(index + 1) % 4]!;
    const after = corners[(index + 2) % 4]!;
    const lineStart = inset(corner, next);
    const lineEnd = inset(next, corner);
    entities.push({ kind: 'line', id: input.id(), start: lineStart, end: lineEnd });
    const arcEnd = inset(next, after);
    const center = { x: lineEnd.x + arcEnd.x - next.x, y: lineEnd.y + arcEnd.y - next.y };
    const bisector = sub(next, center);
    const length = Math.hypot(bisector.x, bisector.y);
    const through = { x: center.x + (bisector.x / length) * radius, y: center.y + (bisector.y / length) * radius };
    entities.push({ kind: 'arc', id: input.id(), start: lineEnd, through, end: arcEnd });
  }
  return entities;
}

/**
 * The default local X of a sketch plane, as the native kernel picks it: a vertical plane keeps its local Y up
 * (world +Z), any other plane takes world X projected on it (world Y when the normal is close to X).
 * @param normal - Unit normal of the plane.
 * @returns The plane's frame directions.
 * @public
 */
export function sketchAxesForNormal(normal: SketchVec3): Readonly<{ xDir: SketchVec3; yDir: SketchVec3 }> {
  const length = Math.hypot(...normal);
  const n = normal.map((value) => value / length) as unknown as SketchVec3;
  const crossProduct = (a: SketchVec3, b: SketchVec3): SketchVec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalize = (value: SketchVec3): SketchVec3 => {
    const size = Math.hypot(...value);
    return value.map((entry) => entry / size) as unknown as SketchVec3;
  };
  let localX: SketchVec3;
  if (Math.abs(n[2]) < 1e-9) {
    // Vertical: local Y is world up, so X = up × normal turned to lie in the plane.
    localX = normalize(crossProduct([0, 0, 1], n));
  } else {
    const reference: SketchVec3 = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const along = reference[0] * n[0] + reference[1] * n[1] + reference[2] * n[2];
    localX = normalize([reference[0] - along * n[0], reference[1] - along * n[1], reference[2] - along * n[2]]);
  }
  return { xDir: localX, yDir: normalize(crossProduct(n, localX)) };
}
