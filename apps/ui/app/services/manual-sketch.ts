import { randomUuid } from '@taucad/utils/id';
import {
  circleThroughThreePoints,
  fromSketchPoint,
  sameSketchPoint,
  sketchAxesForNormal,
  sketchEndTangent,
  sketchEntityEnds,
  sketchEntitySamples,
  sketchLoopPolygon,
  sketchLoops,
  sketchRectangle,
  tangentArcThrough,
  toSketchPoint,
} from '@taucad/viewer/cad/sketch-geometry';
import type {
  SketchEntity,
  SketchFrame,
  SketchLoop,
  SketchLoopPart,
  SketchSnap,
  SketchVec2,
  SketchVec3,
} from '@taucad/viewer/cad/sketch-geometry';
import type { SketchGhost } from '@taucad/viewer/cad/sketch-tool';
import { manualDocumentSchema } from '@taucad/smlib/manual-operations';
import type {
  ManualDocument,
  ManualEdgeGeometry,
  ManualOperation,
  ManualPathSegment,
  ManualProfile,
} from '@taucad/smlib/manual-operations';

// =============================================================================
// Planes
// =============================================================================

/** Where a sketch lies: a picked planar face of a piece, or one of the three base planes. */
export type SketchPlane = Readonly<{
  frame: SketchFrame;
  /** The face direction (`top`, `left`, …) or the base plane (`xy`, `xz`, `yz`). */
  label: string;
  /** The piece whose face it is. */
  piece?: string;
  /** Half the side of the plane square drawn and framed, in millimetres. */
  extent: number;
  /** Changes with the plane, so the camera aligns once per plane. */
  key: string;
}>;

/** The base planes, as the native kernel orients them: XZ looks from the front (−Y) with Z up. */
const basePlaneAxes = {
  xy: { xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] },
  xz: { xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] },
  yz: { xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] },
} as const satisfies Record<string, Omit<SketchFrame, 'origin'>>;

/** A base plane through the origin. */
export function sketchBasePlane(plane: keyof typeof basePlaneAxes, extent: number): SketchPlane {
  return {
    frame: { origin: [0, 0, 0], ...basePlaneAxes[plane] },
    label: plane,
    extent: Math.max(extent, 5),
    key: `base:${plane}`,
  };
}

/**
 * A picked planar face as a sketch plane: its center as origin, its outward normal, local Y up on a vertical face.
 * @param face - Exact face descriptor in model millimetres.
 * @param label - The face's direction in words.
 * @param piece - The piece's authored name.
 * @returns The plane, sized to the face.
 */
export function sketchFacePlane(
  face: Readonly<{ center: SketchVec3; normal: SketchVec3; bounds?: Readonly<{ min: SketchVec3; max: SketchVec3 }> }>,
  label: string,
  piece: string,
): SketchPlane {
  const length = Math.hypot(...face.normal);
  const normal = face.normal.map((value) => value / length) as unknown as SketchVec3;
  const { xDir, yDir } = sketchAxesForNormal(normal);
  const diagonal = face.bounds
    ? Math.hypot(...face.bounds.max.map((value, index) => value - face.bounds!.min[index]!))
    : 20;
  return {
    frame: { origin: [...face.center], xDir, yDir, normal },
    label,
    piece,
    extent: Math.max(diagonal * 0.65, 5),
    key: `face:${piece}:${face.center.join(',')}:${normal.join(',')}`,
  };
}

/** The principal plane nearest a normal, named for 2D drawings of the profile. */
const nearestPrincipalPlane = (normal: SketchVec3): ManualProfile['plane'] => {
  const [x, y, z] = normal.map((value) => Math.abs(value));
  return z! >= x! && z! >= y! ? 'xy' : y! >= x! ? 'xz' : 'yz';
};

const placementOf = (frame: SketchFrame): Pick<ManualProfile, 'plane' | 'origin' | 'frame'> => ({
  plane: nearestPrincipalPlane(frame.normal),
  origin: [...frame.origin],
  frame: { xDir: [...frame.xDir], normal: [...frame.normal] },
});

/** The frame of a stored profile: its own, or its principal plane's. */
export function sketchFrameOfProfile(profile: ManualProfile): SketchFrame {
  if (!profile.frame) {
    return { origin: [...profile.origin], ...basePlaneAxes[profile.plane] };
  }
  const { xDir, normal } = profile.frame;
  const unit = (value: readonly number[]): SketchVec3 => {
    const size = Math.hypot(...value);
    return value.map((entry) => entry / size) as unknown as SketchVec3;
  };
  const x = unit(xDir);
  const n = unit(normal);
  return {
    origin: [...profile.origin],
    xDir: x,
    normal: n,
    yDir: [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]],
  };
}

// =============================================================================
// Drawing
// =============================================================================

/** The drawing tools: L, A (three points; again for tangent), C, R, S. */
export type SketchToolKind = 'line' | 'arc' | 'tangentArc' | 'circle' | 'rectangle' | 'spline';

/** Why a click or a typed quota was refused; the status bar says it. */
export type SketchNotice = 'tangentStart' | 'quotaInvalid' | 'arcStraight';

/** A sketch being drawn: its entities and the gesture under way. */
export type SketchDrawing = Readonly<{
  tool: SketchToolKind;
  entities: readonly SketchEntity[];
  /** Points placed in the gesture under way; for a line or a tangent arc, the first is the chain's tip. */
  clicks: readonly SketchVec2[];
  /** Where a line chain started: clicking it again closes the outline. */
  chainStart?: SketchVec2;
  /** The direction the chain leaves its tip in, for a tangent arc. */
  tangent?: SketchVec2;
  hover?: SketchSnap;
  /** Corner radius of the next rectangle, in millimetres. */
  cornerRadius: number;
  notice?: SketchNotice;
}>;

/** A fresh drawing. */
export const emptySketchDrawing = (
  tool: SketchToolKind = 'line',
  entities: readonly SketchEntity[] = [],
): SketchDrawing => ({ tool, entities, clicks: [], cornerRadius: 0 });

/** What happens to a drawing. */
export type SketchDrawEvent =
  | Readonly<{ type: 'tool'; tool: SketchToolKind }>
  | Readonly<{ type: 'move' | 'click' | 'doubleClick'; snap: SketchSnap }>
  /** A typed length (line), radius (arc, circle) or width × height (rectangle; one number is a square). */
  | Readonly<{ type: 'quota'; values: readonly number[] }>
  /** Enter: end the chain or the spline. */
  | Readonly<{ type: 'finish' }>
  /** Esc: drop the gesture under way. */
  | Readonly<{ type: 'cancel' }>
  /** Backspace: take back the last entity. */
  | Readonly<{ type: 'undo' }>
  | Readonly<{ type: 'cornerRadius'; radius: number }>;

const minimumLength = 1e-3;
const sub = (a: SketchVec2, b: SketchVec2): SketchVec2 => ({ x: a.x - b.x, y: a.y - b.y });
const length2 = (value: SketchVec2): number => Math.hypot(value.x, value.y);

/** The tangent at an existing entity's end that `point` sits on, pointing away along the entity's continuation. */
function tangentAtEnd(entities: readonly SketchEntity[], point: SketchVec2): SketchVec2 | undefined {
  for (const entity of entities.toReversed()) {
    const ends = sketchEntityEnds(entity);
    if (!ends) {
      continue;
    }
    if (sameSketchPoint(ends[1], point, 1e-6)) {
      return sketchEndTangent(entity, 'end');
    }
    if (sameSketchPoint(ends[0], point, 1e-6)) {
      const start = sketchEndTangent(entity, 'start');
      return start ? { x: 0 - start.x, y: 0 - start.y } : undefined;
    }
  }
  return undefined;
}

/** The arc from `start` to `end` of `radius`, bulging to the side of `toward`; nothing when it cannot span them. */
function arcOfRadius(
  { start, end }: Readonly<{ start: SketchVec2; end: SketchVec2 }>,
  radius: number,
  toward: SketchVec2,
): SketchVec2 | undefined {
  const chord = sub(end, start);
  const half = length2(chord) / 2;
  if (!(radius >= half - 1e-9) || half < minimumLength) {
    return undefined;
  }
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const normal = { x: -chord.y / (2 * half), y: chord.x / (2 * half) };
  const side = Math.sign((toward.x - middle.x) * normal.x + (toward.y - middle.y) * normal.y) || 1;
  // The minor arc: its sagitta on the side of the pointer.
  const sagitta = radius - Math.sqrt(Math.max(radius ** 2 - half ** 2, 0));
  return { x: middle.x + normal.x * sagitta * side, y: middle.y + normal.y * sagitta * side };
}

const commitEntities = (
  state: SketchDrawing,
  added: readonly SketchEntity[],
  next: Partial<SketchDrawing>,
): SketchDrawing => ({
  ...state,
  entities: [...state.entities, ...added],
  notice: undefined,
  ...next,
});

/** A point placed by a click or by a typed quota: the whole gesture logic of every tool. */
function placePoint(state: SketchDrawing, point: SketchVec2, id: () => string): SketchDrawing {
  const { clicks } = state;
  switch (state.tool) {
    case 'line': {
      if (clicks.length === 0) {
        return { ...state, clicks: [point], chainStart: point, tangent: undefined, notice: undefined };
      }
      const start = clicks[0]!;
      if (length2(sub(point, start)) < minimumLength) {
        return state;
      }
      const line: SketchEntity = { kind: 'line', id: id(), start, end: point };
      const closes = state.chainStart !== undefined && sameSketchPoint(point, state.chainStart, 1e-6);
      return commitEntities(state, [line], {
        clicks: closes ? [] : [point],
        chainStart: closes ? undefined : state.chainStart,
        tangent: closes ? undefined : sketchEndTangent(line, 'end'),
      });
    }
    case 'tangentArc': {
      if (clicks.length === 0 || state.tangent === undefined) {
        const tangent = tangentAtEnd(state.entities, point);
        return tangent
          ? { ...state, clicks: [point], chainStart: state.chainStart ?? point, tangent, notice: undefined }
          : { ...state, notice: 'tangentStart' };
      }
      const start = clicks[0]!;
      const through = tangentArcThrough(start, state.tangent, point);
      if (!through) {
        return { ...state, notice: 'arcStraight' };
      }
      const arc: SketchEntity = { kind: 'arc', id: id(), start, through, end: point };
      const closes = state.chainStart !== undefined && sameSketchPoint(point, state.chainStart, 1e-6);
      return commitEntities(state, [arc], {
        clicks: closes ? [] : [point],
        chainStart: closes ? undefined : state.chainStart,
        tangent: closes ? undefined : sketchEndTangent(arc, 'end'),
      });
    }
    case 'arc': {
      if (clicks.length < 2) {
        if (clicks.length === 1 && length2(sub(point, clicks[0]!)) < minimumLength) {
          return state;
        }
        return { ...state, clicks: [...clicks, point], notice: undefined };
      }
      const [start, end] = clicks as [SketchVec2, SketchVec2];
      if (!circleThroughThreePoints(start, point, end)) {
        return { ...state, notice: 'arcStraight' };
      }
      const arc: SketchEntity = { kind: 'arc', id: id(), start, through: point, end };
      return commitEntities(state, [arc], { clicks: [], tangent: undefined });
    }
    case 'circle': {
      if (clicks.length === 0) {
        return { ...state, clicks: [point], notice: undefined };
      }
      const radius = length2(sub(point, clicks[0]!));
      if (radius < minimumLength) {
        return state;
      }
      return commitEntities(state, [{ kind: 'circle', id: id(), center: clicks[0]!, radius }], { clicks: [] });
    }
    case 'rectangle': {
      if (clicks.length === 0) {
        return { ...state, clicks: [point], notice: undefined };
      }
      const entities = sketchRectangle({ first: clicks[0]!, second: point, radius: state.cornerRadius, id });
      return entities.length === 0 ? state : commitEntities(state, entities, { clicks: [] });
    }
    case 'spline': {
      if (clicks.length >= 3 && sameSketchPoint(point, clicks[0]!, 1e-6)) {
        return commitEntities(state, [{ kind: 'spline', id: id(), points: [...clicks, clicks[0]!] }], { clicks: [] });
      }
      if (clicks.length > 0 && length2(sub(point, clicks.at(-1)!)) < minimumLength) {
        return state;
      }
      return { ...state, clicks: [...clicks, point], notice: undefined };
    }
  }
}

/** End an open spline or a line chain where it stands. */
function finishGesture(state: SketchDrawing, id: () => string): SketchDrawing {
  if (state.tool === 'spline' && state.clicks.length >= 2) {
    const points = state.clicks;
    const entity: SketchEntity =
      points.length === 2
        ? { kind: 'line', id: id(), start: points[0]!, end: points[1]! }
        : { kind: 'spline', id: id(), points };
    return commitEntities(state, [entity], { clicks: [] });
  }
  return { ...state, clicks: [], chainStart: undefined, tangent: undefined, notice: undefined };
}

/** A typed quota turned into the point it means, along the pointer's direction. */
function quotaPoint(state: SketchDrawing, values: readonly number[]): SketchVec2 | undefined {
  const anchor = state.clicks[0];
  const hover = state.hover?.point;
  const [first, second = first] = values;
  if (!anchor || first === undefined || !Number.isFinite(first) || first <= 0 || !(second! > 0)) {
    return undefined;
  }
  const toward = hover && length2(sub(hover, anchor)) > minimumLength ? sub(hover, anchor) : { x: 1, y: 0 };
  switch (state.tool) {
    case 'line':
    case 'circle': {
      const size = length2(toward);
      return { x: anchor.x + (toward.x / size) * first, y: anchor.y + (toward.y / size) * first };
    }
    case 'rectangle': {
      return {
        x: anchor.x + (toward.x < 0 ? -first : first),
        y: anchor.y + (toward.y < 0 ? -second! : second!),
      };
    }
    case 'arc':
    case 'tangentArc':
    case 'spline': {
      return undefined;
    }
  }
}

/**
 * The drawing after one event: every tool's gesture, the typed quotas, Enter, Esc and Backspace.
 * @param state - The drawing.
 * @param event - What happened.
 * @param id - Entity id factory.
 * @returns The next drawing.
 */
export function reduceSketchDrawing(
  state: SketchDrawing,
  event: SketchDrawEvent,
  id: () => string = randomUuid,
): SketchDrawing {
  switch (event.type) {
    case 'tool': {
      // A line chain continues into a tangent arc and back, from its tip; other tools start afresh.
      const keepsChain =
        (event.tool === 'line' || event.tool === 'tangentArc') &&
        (state.tool === 'line' || state.tool === 'tangentArc') &&
        state.clicks.length === 1;
      return {
        ...state,
        tool: event.tool,
        clicks: keepsChain ? state.clicks : [],
        chainStart: keepsChain ? state.chainStart : undefined,
        tangent: keepsChain ? state.tangent : undefined,
        notice: undefined,
      };
    }
    case 'move': {
      return { ...state, hover: event.snap };
    }
    case 'click': {
      return placePoint({ ...state, hover: event.snap }, event.snap.point, id);
    }
    case 'doubleClick': {
      // The first click of the pair has placed its point already; the second ends the chain or the spline.
      const last = state.clicks.at(-1);
      const placed =
        last && sameSketchPoint(last, event.snap.point, 1e-6) ? state : placePoint(state, event.snap.point, id);
      return finishGesture(placed, id);
    }
    case 'quota': {
      if (state.tool === 'arc' && state.clicks.length === 2) {
        const [start, end] = state.clicks as [SketchVec2, SketchVec2];
        const through = arcOfRadius({ start, end }, event.values[0] ?? 0, state.hover?.point ?? end);
        return through
          ? commitEntities(state, [{ kind: 'arc', id: id(), start, through, end }], { clicks: [] })
          : { ...state, notice: 'quotaInvalid' };
      }
      if (state.tool === 'circle' && state.clicks.length === 1 && (event.values[0] ?? 0) > 0) {
        return commitEntities(
          state,
          [{ kind: 'circle', id: id(), center: state.clicks[0]!, radius: event.values[0]! }],
          { clicks: [] },
        );
      }
      const point = quotaPoint(state, event.values);
      return point ? placePoint(state, point, id) : { ...state, notice: 'quotaInvalid' };
    }
    case 'finish': {
      return finishGesture(state, id);
    }
    case 'cancel': {
      return { ...state, clicks: [], chainStart: undefined, tangent: undefined, notice: undefined };
    }
    case 'undo': {
      return { ...state, entities: state.entities.slice(0, -1), clicks: [], chainStart: undefined, tangent: undefined };
    }
    case 'cornerRadius': {
      return { ...state, cornerRadius: Math.max(0, event.radius) };
    }
  }
}

/**
 * The entity being drawn, following the pointer: the rubber band of the gesture under way.
 * @param state - The drawing.
 * @returns Preview entities (not yet part of the sketch).
 */
export function sketchPendingEntities(state: SketchDrawing): SketchEntity[] {
  const hover = state.hover?.point;
  const { clicks } = state;
  if (!hover || clicks.length === 0) {
    return [];
  }
  const first = clicks[0]!;
  switch (state.tool) {
    case 'line': {
      return length2(sub(hover, first)) > minimumLength
        ? [{ kind: 'line', id: 'pending', start: first, end: hover }]
        : [];
    }
    case 'tangentArc': {
      const through = state.tangent ? tangentArcThrough(first, state.tangent, hover) : undefined;
      return through ? [{ kind: 'arc', id: 'pending', start: first, through, end: hover }] : [];
    }
    case 'arc': {
      if (clicks.length === 1) {
        return [{ kind: 'line', id: 'pending', start: first, end: hover }];
      }
      return circleThroughThreePoints(first, hover, clicks[1]!)
        ? [{ kind: 'arc', id: 'pending', start: first, through: hover, end: clicks[1]! }]
        : [];
    }
    case 'circle': {
      const radius = length2(sub(hover, first));
      return radius > minimumLength ? [{ kind: 'circle', id: 'pending', center: first, radius }] : [];
    }
    case 'rectangle': {
      return sketchRectangle({ first, second: hover, radius: state.cornerRadius, id: () => 'pending' });
    }
    case 'spline': {
      return [{ kind: 'spline', id: 'pending', points: [...clicks, hover] }];
    }
  }
}

/** The quota the floating label shows while drawing: a length, a radius, or a width × height. */
export type SketchQuota = Readonly<{ kind: 'length' | 'radius' | 'size'; values: readonly number[] }>;

/**
 * What the gesture measures now.
 * @param state - The drawing.
 * @returns The live quota, or nothing between gestures.
 */
export function sketchLiveQuota(state: SketchDrawing): SketchQuota | undefined {
  const hover = state.hover?.point;
  const first = state.clicks[0];
  if (!hover || !first) {
    return undefined;
  }
  switch (state.tool) {
    case 'line':
    case 'spline': {
      return { kind: 'length', values: [length2(sub(hover, state.clicks.at(-1)!))] };
    }
    case 'circle': {
      return { kind: 'radius', values: [length2(sub(hover, first))] };
    }
    case 'arc': {
      if (state.clicks.length === 1) {
        return { kind: 'length', values: [length2(sub(hover, first))] };
      }
      const circle = circleThroughThreePoints(first, hover, state.clicks[1]!);
      return circle ? { kind: 'radius', values: [circle.radius] } : undefined;
    }
    case 'tangentArc': {
      const through = state.tangent ? tangentArcThrough(first, state.tangent, hover) : undefined;
      const circle = through ? circleThroughThreePoints(first, through, hover) : undefined;
      return circle ? { kind: 'radius', values: [circle.radius] } : undefined;
    }
    case 'rectangle': {
      return { kind: 'size', values: [Math.abs(hover.x - first.x), Math.abs(hover.y - first.y)] };
    }
  }
}

/**
 * Read a typed quota: «12,5», «12.5», or «20 x 10» for a rectangle.
 * @param text - What was typed.
 * @returns Positive millimetres, or nothing when the text is no quota.
 */
export function parseSketchQuota(text: string): number[] | undefined {
  const parts = text
    .trim()
    .split(/\s*[x×*;]\s*/iu)
    .map((part) => Number(part.replace(',', '.')));
  return parts.length > 0 && parts.length <= 2 && parts.every((value) => Number.isFinite(value) && value > 0)
    ? parts
    : undefined;
}

// =============================================================================
// Profiles
// =============================================================================

const point2 = ({ x, y }: SketchVec2): { x: number; y: number } => ({ x, y });

/** One loop part as path segments, in traversal order. */
function partSegments(part: SketchLoopPart): ManualPathSegment[] {
  const { entity, reversed } = part;
  switch (entity.kind) {
    case 'line': {
      return [{ kind: 'line', to: point2(reversed ? entity.start : entity.end) }];
    }
    case 'arc': {
      return [{ kind: 'arc', through: point2(entity.through), to: point2(reversed ? entity.start : entity.end) }];
    }
    case 'spline': {
      const points = reversed ? entity.points.toReversed() : [...entity.points];
      const through = points.slice(1, -1).map((point) => point2(point));
      const to = point2(points.at(-1)!);
      return through.length === 0 ? [{ kind: 'line', to }] : [{ kind: 'spline', through, to }];
    }
    case 'circle': {
      return [];
    }
  }
}

const partStart = ({ entity, reversed }: SketchLoopPart): SketchVec2 => {
  const ends = sketchEntityEnds(entity)!;
  return reversed ? ends[1] : ends[0];
};

/** A chain of parts as a native outline: closed chains end exactly where they start. */
function chainProfile(parts: readonly SketchLoopPart[], frame: SketchFrame, closed: boolean): ManualProfile {
  const start = point2(partStart(parts[0]!));
  const segments = parts.flatMap((part) => partSegments(part));
  if (closed) {
    // Ends met within the drawing tolerance; the stored outline closes exactly.
    segments[segments.length - 1] = { ...segments.at(-1)!, to: start };
  }
  return { ...placementOf(frame), kind: 'path', start, segments, closed };
}

/**
 * A closed loop of the sketch as the profile its operation uses.
 * @param loop - A loop from {@link sketchLoops}.
 * @param frame - The sketch plane.
 * @returns A native circle or outline on the sketch's frame.
 */
export function sketchLoopProfile(loop: SketchLoop, frame: SketchFrame): ManualProfile {
  const [only] = loop.parts;
  if (loop.parts.length === 1 && only?.entity.kind === 'circle') {
    return { ...placementOf(frame), kind: 'circle', center: point2(only.entity.center), radius: only.entity.radius };
  }
  return chainProfile(loop.parts, frame, true);
}

/** The entities of an open chain, walked from one free end; nothing when they do not form one chain. */
function openChain(entities: readonly SketchEntity[]): SketchLoopPart[] | undefined {
  const open = entities.filter((entity) => entity.kind !== 'circle');
  if (open.length === 0 || open.length !== entities.length) {
    return undefined;
  }
  const touches = (point: SketchVec2, except: SketchEntity): boolean =>
    open.some((entity) => {
      const ends = sketchEntityEnds(entity)!;
      return entity !== except && (sameSketchPoint(ends[0], point, 1e-4) || sameSketchPoint(ends[1], point, 1e-4));
    });
  const first = open.find((entity) => {
    const ends = sketchEntityEnds(entity)!;
    return !touches(ends[0], entity) || !touches(ends[1], entity);
  });
  if (!first) {
    return undefined;
  }
  const firstEnds = sketchEntityEnds(first)!;
  const parts: SketchLoopPart[] = [{ entity: first, reversed: touches(firstEnds[0], first) }];
  let tip = parts[0]!.reversed ? firstEnds[0] : firstEnds[1];
  const used = new Set([first.id]);
  const continuing = (point: SketchVec2): SketchEntity | undefined =>
    open.find((entity) => {
      const ends = sketchEntityEnds(entity)!;
      return !used.has(entity.id) && (sameSketchPoint(ends[0], point, 1e-4) || sameSketchPoint(ends[1], point, 1e-4));
    });
  for (let next = continuing(tip); next; next = continuing(tip)) {
    const ends = sketchEntityEnds(next)!;
    const reversed = !sameSketchPoint(ends[0], tip, 1e-4);
    parts.push({ entity: next, reversed });
    used.add(next.id);
    tip = reversed ? ends[0] : ends[1];
  }
  return used.size === open.length ? parts : undefined;
}

/**
 * A sweep path drawn in a second sketch: its one closed loop, or its one open chain.
 * @param entities - The path sketch.
 * @param frame - Its plane.
 * @returns The path profile, or nothing when the sketch is not one curve.
 */
export function sketchPathProfile(entities: readonly SketchEntity[], frame: SketchFrame): ManualProfile | undefined {
  const loops = sketchLoops(entities);
  if (loops.length === 1 && loops[0]!.parts.length === entities.length) {
    return sketchLoopProfile(loops[0]!, frame);
  }
  const chain = openChain(entities);
  return chain ? chainProfile(chain, frame, false) : undefined;
}

/** Points along a path drawn in a sketch, in model millimetres: what the sweep's ghost follows. */
export function sketchPathPoints(entities: readonly SketchEntity[], frame: SketchFrame): SketchVec3[] {
  const loops = sketchLoops(entities);
  if (loops.length === 1) {
    const polygon = sketchLoopPolygon(loops[0]!);
    return [...polygon, polygon[0]!].map((point) => fromSketchPoint(point, frame));
  }
  const chain = openChain(entities);
  if (!chain) {
    return [];
  }
  const points: SketchVec2[] = [];
  for (const { entity, reversed } of chain) {
    const samples = sketchEntitySamples(entity, 48);
    points.push(...(reversed ? samples.toReversed() : samples).slice(points.length === 0 ? 0 : 1));
  }
  return points.map((point) => fromSketchPoint(point, frame));
}

/** Points along a model edge, for the ghost of a sweep along it. */
export function edgePathPoints(geometry: ManualEdgeGeometry): SketchVec3[] {
  if (geometry.kind === 'line') {
    return [geometry.start, geometry.end];
  }
  if (geometry.kind === 'nurbs') {
    return geometry.points;
  }
  const { center, radius } = geometry;
  const n = geometry.normal.map((value) => value / Math.hypot(...geometry.normal)) as unknown as SketchVec3;
  const u = geometry.start.map((value, index) => (value - center[index]!) / radius) as unknown as SketchVec3;
  const v: SketchVec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const sweep = geometry.closed ? 2 * Math.PI : Math.max(geometry.length / radius, 1e-6);
  return Array.from({ length: 65 }, (_, index) => {
    const angle = (sweep * index) / 64;
    return [0, 1, 2].map(
      (axis) => center[axis]! + radius * (Math.cos(angle) * u[axis]! + Math.sin(angle) * v[axis]!),
    ) as unknown as SketchVec3;
  });
}

/**
 * A straight model edge as a revolution axis: it must lie on the sketch plane.
 * @param geometry - The picked edge.
 * @param frame - The sketch plane.
 * @returns The axis in sketch millimetres, or nothing for a curved edge or one off the plane.
 */
export function edgeAxisOnPlane(
  geometry: ManualEdgeGeometry,
  frame: SketchFrame,
): Readonly<{ start: SketchVec2; end: SketchVec2 }> | undefined {
  if (geometry.kind !== 'line') {
    return undefined;
  }
  const start = toSketchPoint(geometry.start, frame);
  const end = toSketchPoint(geometry.end, frame);
  if (Math.abs(start.height) > 1e-3 || Math.abs(end.height) > 1e-3) {
    return undefined;
  }
  return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
}

/** Lines of the sketch that close no loop: candidates for the revolution axis. */
export function sketchAxisLines(entities: readonly SketchEntity[]): Array<Extract<SketchEntity, { kind: 'line' }>> {
  const used = new Set(sketchLoops(entities).flatMap((loop) => loop.parts.map(({ entity }) => entity.id)));
  return entities.filter(
    (entity): entity is Extract<SketchEntity, { kind: 'line' }> => entity.kind === 'line' && !used.has(entity.id),
  );
}

/** One stored outline segment as the entity it was drawn as. */
function segmentEntity(start: SketchVec2, segment: ManualPathSegment, id: string): SketchEntity {
  switch (segment.kind) {
    case 'line': {
      return { kind: 'line', id, start, end: segment.to };
    }
    case 'arc': {
      return { kind: 'arc', id, start, through: segment.through, end: segment.to };
    }
    case 'spline': {
      return { kind: 'spline', id, points: [start, ...segment.through, segment.to] };
    }
  }
}

/**
 * The entities a stored profile was drawn as, for editing the sketch again.
 * @param profile - A stored profile.
 * @returns Its entities, or nothing for a profile the sketch cannot draw (a Catmull-Rom curve).
 */
export function sketchEntitiesOfProfile(
  profile: ManualProfile,
  id: () => string = randomUuid,
): SketchEntity[] | undefined {
  switch (profile.kind) {
    case 'circle': {
      return [{ kind: 'circle', id: id(), center: profile.center, radius: profile.radius }];
    }
    case 'path': {
      let from: SketchVec2 = profile.start;
      return profile.segments.map((segment) => {
        const entity = segmentEntity(from, segment, id());
        from = segment.to;
        return entity;
      });
    }
    case 'polygon': {
      const { points } = profile;
      const closed = profile.closed !== false;
      return points.slice(0, closed ? points.length : -1).map((point, index) => ({
        kind: 'line',
        id: id(),
        start: { x: point.x, y: point.y },
        end: { x: points[(index + 1) % points.length]!.x, y: points[(index + 1) % points.length]!.y },
      }));
    }
    case 'spline':
    case 'arc': {
      return undefined;
    }
  }
}

// =============================================================================
// Operations
// =============================================================================

/** What the closed profile becomes. */
export type SketchOperationKind = 'extrude' | 'revolve' | 'sweep';
/** Join the piece, remove from it, or make a new piece. */
export type SketchMode = 'add' | 'cut' | 'new';
/** The revolution axis, in sketch millimetres: a line of the sketch, or a model edge laid on the plane. */
export type SketchAxisChoice = Readonly<{ start: SketchVec2; end: SketchVec2; source: 'line' | 'edge' }>;
/** The sweep path: a curve drawn in a second sketch, or an exact edge of a piece. */
export type SketchPathChoice =
  | Readonly<{ kind: 'sketch'; frame: SketchFrame; entities: readonly SketchEntity[] }>
  | Readonly<{ kind: 'edge'; piece: string; geometry: ManualEdgeGeometry }>;

/** The operation's numbers while the sketch is open. */
export type SketchOperationDraft = Readonly<{
  kind: SketchOperationKind;
  mode: SketchMode;
  /** Extrusion length, positive millimetres; the mode decides the side (a cut goes into the face). */
  distance: number;
  /** Extrude to the other side. */
  reverse: boolean;
  /** Draft angle in degrees; 0 is none. */
  taper: number;
  /** Revolution angle in degrees. */
  angle: number;
  axis?: SketchAxisChoice;
  path?: SketchPathChoice;
}>;

/** A first draft: on a face, a cut keeps the face's piece; without pieces, a new one. */
export const defaultSketchOperation = (mode: SketchMode): SketchOperationDraft => ({
  kind: 'extrude',
  mode,
  distance: mode === 'cut' ? 1 : 2,
  reverse: false,
  taper: 0,
  angle: 360,
});

/** The signed extrusion along the sketch normal. */
export const signedSketchDistance = (draft: SketchOperationDraft): number =>
  (draft.mode === 'cut' ? -1 : 1) * (draft.reverse ? -1 : 1) * draft.distance;

/** Why a sketch cannot be applied yet. */
export type SketchCommitError = 'noProfile' | 'noAxis' | 'noPath' | 'noTarget' | 'invalid';

/**
 * The manual history with the sketch's operation applied: appended, or in place of the operation being edited.
 * @param input - The sketch, its operation and where it goes.
 * @returns The next document, or why not.
 */
export function sketchCommit(
  input: Readonly<{
    document: ManualDocument;
    frame: SketchFrame;
    entities: readonly SketchEntity[];
    loopIndex?: number;
    draft: SketchOperationDraft;
    /** The piece a join or a cut changes. */
    target?: string;
    /** The name of a new piece. */
    name: string;
    /** The operation being edited again, kept at its place in the history. */
    editingId?: string;
    id?: () => string;
  }>,
):
  | Readonly<{ document: ManualDocument; operation: ManualOperation }>
  | Readonly<{ error: SketchCommitError; detail?: string }> {
  const { draft, frame } = input;
  const loops = sketchLoops(input.entities);
  const loop = loops[Math.min(input.loopIndex ?? 0, loops.length - 1)];
  if (!loop) {
    return { error: 'noProfile' };
  }
  if (draft.mode !== 'new' && !input.target) {
    return { error: 'noTarget' };
  }
  const profile = sketchLoopProfile(loop, frame);
  const base = {
    id: input.editingId ?? (input.id ?? randomUuid)(),
    mode: draft.mode,
    ...(draft.mode === 'new' ? { name: input.name } : { target: { name: input.target! } }),
    profile,
  };
  let operation: unknown;
  switch (draft.kind) {
    case 'extrude': {
      operation = {
        ...base,
        type: 'extrude',
        distance: signedSketchDistance(draft),
        ...(Math.abs(draft.taper) > 1e-6 ? { taper: draft.taper } : {}),
      };
      break;
    }
    case 'revolve': {
      if (!draft.axis) {
        return { error: 'noAxis' };
      }
      operation = {
        ...base,
        type: 'revolve',
        axis: { start: point2(draft.axis.start), end: point2(draft.axis.end) },
        angle: draft.angle,
      };
      break;
    }
    case 'sweep': {
      const { path } = draft;
      const pathProfile = path?.kind === 'sketch' ? sketchPathProfile(path.entities, path.frame) : undefined;
      if (!path || (path.kind === 'sketch' && !pathProfile)) {
        return { error: 'noPath' };
      }
      operation = {
        ...base,
        type: 'sweep',
        path:
          path.kind === 'sketch'
            ? { kind: 'sketch', profile: pathProfile }
            : { kind: 'edge', piece: { name: path.piece }, geometry: path.geometry },
      };
      break;
    }
  }
  const operations = input.editingId
    ? input.document.operations.map((entry) => (entry.id === input.editingId ? (operation as ManualOperation) : entry))
    : [...input.document.operations, operation as ManualOperation];
  const parsed = manualDocumentSchema.safeParse({ version: 1, operations });
  if (!parsed.success) {
    return { error: 'invalid', detail: parsed.error.issues.map((issue) => issue.message).join(' ') };
  }
  const saved = parsed.data.operations.find((entry) => entry.id === base.id)!;
  return { document: parsed.data, operation: saved };
}

/** A stored operation reopened as a sketch: its plane, its entities and its numbers. */
export type SketchReopened = Readonly<{
  frame: SketchFrame;
  entities: SketchEntity[];
  draft: SketchOperationDraft;
  target?: string;
  name?: string;
}>;

/**
 * Reopen an extrusion, revolution or sweep as the sketch it was drawn from.
 * @param operation - A stored operation.
 * @returns The sketch, or nothing when the operation is not a profile operation the sketch can draw.
 */
export function reopenSketchOperation(
  operation: ManualOperation,
  id: () => string = randomUuid,
): SketchReopened | undefined {
  if (operation.type !== 'extrude' && operation.type !== 'revolve' && operation.type !== 'sweep') {
    return undefined;
  }
  const entities = sketchEntitiesOfProfile(operation.profile, id);
  if (!entities) {
    return undefined;
  }
  const frame = sketchFrameOfProfile(operation.profile);
  const owner = operation.mode === 'new' ? { name: operation.name } : { target: operation.target?.name };
  const common = { ...defaultSketchOperation(operation.mode), mode: operation.mode };
  switch (operation.type) {
    case 'extrude': {
      const along = operation.mode === 'cut' ? -operation.distance : operation.distance;
      return {
        frame,
        entities,
        ...owner,
        draft: {
          ...common,
          kind: 'extrude',
          distance: Math.abs(operation.distance),
          reverse: along < 0,
          taper: operation.taper ?? 0,
        },
      };
    }
    case 'revolve': {
      // The axis comes back as a line of the sketch, outside the profile, so it can be moved or chosen again.
      const axisLine: SketchEntity = {
        kind: 'line',
        id: id(),
        start: { ...operation.axis.start },
        end: { ...operation.axis.end },
      };
      return {
        frame,
        entities: [...entities, axisLine],
        ...owner,
        draft: { ...common, kind: 'revolve', angle: operation.angle, axis: { ...operation.axis, source: 'line' } },
      };
    }
    case 'sweep': {
      const { path } = operation;
      let choice: SketchPathChoice | undefined;
      if (path.kind === 'edge') {
        choice = { kind: 'edge', piece: path.piece.name, geometry: path.geometry };
      } else {
        const pathEntities = sketchEntitiesOfProfile(path.profile, id);
        choice = pathEntities
          ? { kind: 'sketch', frame: sketchFrameOfProfile(path.profile), entities: pathEntities }
          : undefined;
      }
      return { frame, entities, ...owner, draft: { ...common, kind: 'sweep', path: choice } };
    }
  }
}

/**
 * The ghost of the operation on the chosen loop.
 * @param input - The loop, the operation and the sweep path points.
 * @returns What the viewer previews, or nothing until the operation has what it needs.
 */
export function sketchOperationGhost(
  input: Readonly<{ loop: SketchLoop | undefined; draft: SketchOperationDraft; pathPoints?: readonly SketchVec3[] }>,
): SketchGhost | undefined {
  const { loop, draft } = input;
  if (!loop) {
    return undefined;
  }
  const polygon = sketchLoopPolygon(loop);
  const cut = draft.mode === 'cut';
  switch (draft.kind) {
    case 'extrude': {
      return { kind: 'extrude', polygon, distance: signedSketchDistance(draft), taper: draft.taper || undefined, cut };
    }
    case 'revolve': {
      return draft.axis
        ? { kind: 'revolve', polygon, axis: { start: draft.axis.start, end: draft.axis.end }, angle: draft.angle, cut }
        : undefined;
    }
    case 'sweep': {
      return input.pathPoints && input.pathPoints.length >= 2
        ? { kind: 'sweep', polygon, path: input.pathPoints, cut }
        : undefined;
    }
  }
}
