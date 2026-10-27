import { z } from 'zod';

const scalar = z.number().min(-1_000_000).max(1_000_000);
const positive = scalar.positive();
const identifier = z.string().trim().min(1).max(200);
// Authored names are exact identities: whitespace must never select another source piece.
const authoredName = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, 'A piece name must not be blank.');
const vector = z.tuple([scalar, scalar, scalar]);
const direction = vector.refine((value) => Math.hypot(...value) > 1e-9, 'An axis must have a nonzero direction.');
const plane = z.enum(['xy', 'xz', 'yz']);
const target = z.object({ name: authoredName }).strict();
const point = z.object({ id: identifier, x: scalar, y: scalar }).strict();

/** A world-space vector in model millimetres. @public */
export type ManualVector = z.infer<typeof vector>;
/** A uniquely named source piece; never a mesh index. @public */
export type ManualTarget = z.infer<typeof target>;

const frameTolerance = 1e-6;
/**
 * The axes of a sketch drawn on a picked planar face: local X along `xDir`, the normal out of the face. Without it a
 * profile lies on its principal plane; with it `plane` names only the nearest principal plane, for 2D drawings.
 */
const profileFrame = z
  .object({ xDir: direction, normal: direction })
  .strict()
  .refine(
    ({ xDir, normal }) =>
      Math.abs(xDir[0] * normal[0] + xDir[1] * normal[1] + xDir[2] * normal[2]) <=
      frameTolerance * Math.hypot(...xDir) * Math.hypot(...normal),
    'A sketch frame needs an X direction lying in its plane.',
  );
const profilePlacement = { plane, origin: vector, frame: profileFrame.optional() };
const profileCenter = z.object({ x: scalar, y: scalar }).strict();
const profilePoint = z.object({ x: scalar, y: scalar }).strict();
/** One piece of a sketched outline: a line, a circular arc through a point, or a spline through points. */
const pathSegment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), to: profilePoint }).strict(),
  z.object({ kind: z.literal('arc'), through: profilePoint, to: profilePoint }).strict(),
  z.object({ kind: z.literal('spline'), through: z.array(profilePoint).min(1).max(254), to: profilePoint }).strict(),
]);
/** A sketched outline segment in profile-local millimetres. @public */
export type ManualPathSegment = z.infer<typeof pathSegment>;

const pathTolerance = 1e-6;
const samePoint = (a: ManualProfilePoint, b: ManualProfilePoint): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) <= pathTolerance;

/** Distinct consecutive points, arcs that bend, and a closure flag that says what the geometry does. */
function refineManualPath(
  profile: Readonly<{ start: ManualProfilePoint; segments: readonly ManualPathSegment[]; closed: boolean }>,
  context: z.RefinementCtx,
): void {
  let from = profile.start;
  for (const [index, segment] of profile.segments.entries()) {
    const through = segment.kind === 'line' ? [] : segment.kind === 'arc' ? [segment.through] : segment.through;
    const points = [from, ...through, segment.to];
    if (points.some((point, at) => at > 0 && samePoint(point, points[at - 1]!))) {
      context.addIssue({
        code: 'custom',
        message: 'Consecutive sketch points must be distinct.',
        path: ['segments', index],
      });
    }
    if (segment.kind === 'arc') {
      const chord = { x: segment.to.x - from.x, y: segment.to.y - from.y };
      const bend = { x: segment.through.x - from.x, y: segment.through.y - from.y };
      if (samePoint(from, segment.to) || Math.abs(chord.x * bend.y - chord.y * bend.x) <= pathTolerance) {
        context.addIssue({
          code: 'custom',
          message: 'An arc needs three distinct points that are not on one line.',
          path: ['segments', index],
        });
      }
    }
    from = segment.to;
  }
  if (samePoint(from, profile.start) !== profile.closed) {
    context.addIssue({
      code: 'custom',
      message: profile.closed
        ? 'A closed sketch must end where it starts.'
        : 'An open sketch must not end where it starts; mark it closed.',
      path: ['closed'],
    });
  }
  if (profile.closed && profile.segments.length === 1 && profile.segments[0]!.kind !== 'spline') {
    context.addIssue({ code: 'custom', message: 'A closed sketch needs at least two segments.', path: ['segments'] });
  }
}

/** Analytic or point-authored profile in the local coordinates of a placed principal plane. @public */
export const manualProfileSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        ...profilePlacement,
        kind: z.literal('polygon'),
        points: z.array(point).min(2).max(256),
        closed: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        ...profilePlacement,
        kind: z.literal('spline'),
        points: z.array(point).min(2).max(256),
        closed: z.boolean().optional(),
      })
      .strict(),
    z.object({ ...profilePlacement, kind: z.literal('circle'), center: profileCenter, radius: positive }).strict(),
    z
      .object({
        ...profilePlacement,
        kind: z.literal('arc'),
        center: profileCenter,
        radius: positive,
        startAngle: scalar,
        sweepAngle: z
          .number()
          .min(-360)
          .max(360)
          .refine(
            (value) => Math.abs(value) > 1e-6 && Math.abs(value) < 360,
            'An arc needs a nonzero sweep smaller than 360 degrees.',
          ),
      })
      .strict(),
    z
      .object({
        ...profilePlacement,
        kind: z.literal('path'),
        start: profilePoint,
        segments: z.array(pathSegment).min(1).max(256),
        closed: z.boolean(),
      })
      .strict(),
  ])
  .superRefine((profile, context) => {
    if (profile.kind === 'circle' || profile.kind === 'arc') {
      return;
    }
    if (profile.kind === 'path') {
      refineManualPath(profile, context);
      return;
    }
    if (profile.closed !== false && profile.points.length < 3) {
      context.addIssue({ code: 'custom', message: 'A closed profile needs at least three points.', path: ['points'] });
    }
    if (new Set(profile.points.map((value) => value.id)).size !== profile.points.length) {
      context.addIssue({ code: 'custom', message: 'Profile point ids must be unique.', path: ['points'] });
    }
    const segmentCount = profile.closed === false ? profile.points.length - 1 : profile.points.length;
    for (let index = 0; index < segmentCount; index++) {
      const current = profile.points[index]!;
      const next = profile.points[(index + 1) % profile.points.length]!;
      if (Math.hypot(current.x - next.x, current.y - next.y) < 1e-6) {
        context.addIssue({
          code: 'custom',
          message: 'Consecutive profile points must be distinct.',
          path: ['points', index],
        });
      }
    }
  });
/** Editable points or analytic parameters remain canonical when the kernel rebuilds the curve. @public */
export type ManualProfile = z.infer<typeof manualProfileSchema>;
/** An editable polyline or interpolated spline with stable point identities. @public */
export type ManualPointProfile = Extract<ManualProfile, { kind: 'polygon' | 'spline' }>;

/** A profile-local point in millimetres. @public */
export type ManualProfilePoint = { x: number; y: number };

/**
 * Test whether a profile bounds a region; omitted legacy closure remains closed.
 * @param profile - Canonical profile.
 * @returns True for a circle or a closed point profile.
 * @public
 */
export function isManualProfileClosed(profile: ManualProfile): boolean {
  return profile.kind === 'circle' || (profile.kind !== 'arc' && profile.closed !== false);
}

/** Cubic Bézier controls shared by the editable preview and native geometry. @public */
export type ManualProfileSegment = {
  start: ManualProfilePoint;
  control1: ManualProfilePoint;
  control2: ManualProfilePoint;
  end: ManualProfilePoint;
};

/**
 * Build a uniform Catmull-Rom curve as exact cubic Bézier segments.
 * @param profile - Validated local profile points in their authored order.
 * @returns Closed segments, or open segments with clamped endpoint tangents.
 * @public
 */
export function manualProfileSegments(profile: ManualPointProfile): ManualProfileSegment[] {
  const { points } = profile;
  const closed = isManualProfileClosed(profile);
  return points.slice(0, closed ? points.length : -1).map((point, index) => {
    const before = points[closed ? (index + points.length - 1) % points.length : Math.max(0, index - 1)]!;
    const next = points[(index + 1) % points.length]!;
    const after = points[closed ? (index + 2) % points.length : Math.min(points.length - 1, index + 2)]!;
    return {
      start: { x: point.x, y: point.y },
      control1: { x: point.x + (next.x - before.x) / 6, y: point.y + (next.y - before.y) / 6 },
      control2: { x: next.x - (after.x - point.x) / 6, y: next.y - (after.y - point.y) / 6 },
      end: { x: next.x, y: next.y },
    };
  });
}

const profileTolerance = 1e-6;
const cross2 = (a: ManualProfilePoint, b: ManualProfilePoint): number => a.x * b.y - a.y * b.x;
const subtract2 = (a: ManualProfilePoint, b: ManualProfilePoint): ManualProfilePoint => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
const signedProfileArea = (points: ManualProfilePoint[]): number =>
  points.reduce((sum, point, index) => sum + cross2(point, points[(index + 1) % points.length]!), 0) / 2;

function assertSimplePolyline(points: ManualProfilePoint[], closed: boolean): void {
  const count = closed ? points.length : points.length - 1;
  for (let first = 0; first < count; first++) {
    const a = points[first]!;
    const b = points[(first + 1) % points.length]!;
    const ab = subtract2(b, a);
    for (let second = first + 2; second < count; second++) {
      if (closed && first === 0 && second === count - 1) {
        continue;
      }
      const c = points[second]!;
      const d = points[(second + 1) % points.length]!;
      const cd = subtract2(d, c);
      const ac = subtract2(c, a);
      const determinant = cross2(ab, cd);
      if (Math.abs(determinant) <= profileTolerance) {
        if (Math.abs(cross2(ac, ab)) > profileTolerance) {
          continue;
        }
        const lengthSquared = ab.x ** 2 + ab.y ** 2;
        const start = (ac.x * ab.x + ac.y * ab.y) / lengthSquared;
        const ad = subtract2(d, a);
        const end = (ad.x * ab.x + ad.y * ab.y) / lengthSquared;
        if (Math.max(Math.min(start, end), 0) > Math.min(Math.max(start, end), 1) + profileTolerance) {
          continue;
        }
      } else {
        const alongFirst = cross2(ac, cd) / determinant;
        const alongSecond = cross2(ac, ab) / determinant;
        if (
          alongFirst < -profileTolerance ||
          alongFirst > 1 + profileTolerance ||
          alongSecond < -profileTolerance ||
          alongSecond > 1 + profileTolerance
        ) {
          continue;
        }
      }
      throw new Error('The profile intersects or overlaps itself. Correct the points before offsetting.');
    }
  }
}

/**
 * Offset canonical analytic curves or a line polyline without tessellation.
 * Closed positive distances grow outward; open positive distances go left along the authored direction.
 * Polygon corners use line mitres; intersections, collapsed segments and mitres beyond 20 times the distance fail closed.
 * @param profile - Canonical source geometry; splines are unsupported.
 * @param distance - Signed offset in millimetres.
 * @returns Editable geometry with the same point identities, placement and analytic curve kind.
 * @public
 */
export function offsetManualProfile(profile: ManualProfile, distance: number): ManualProfile {
  manualProfileSchema.parse(profile);
  if (!Number.isFinite(distance) || Math.abs(distance) <= profileTolerance || Math.abs(distance) > 1_000_000) {
    throw new Error('Offset distance must be finite, nonzero and within the model limits.');
  }
  if (profile.kind === 'spline' || profile.kind === 'path') {
    throw new Error('Spline offset is unsupported. Use a line profile, circle or circular arc.');
  }
  if (profile.kind === 'circle' || profile.kind === 'arc') {
    const radius = profile.radius + (profile.kind === 'circle' ? distance : -Math.sign(profile.sweepAngle) * distance);
    if (radius <= profileTolerance) {
      throw new Error('The offset collapses the circular profile. Reduce the distance.');
    }
    return manualProfileSchema.parse({ ...profile, radius });
  }
  const closed = isManualProfileClosed(profile);
  const { points } = profile;
  assertSimplePolyline(points, closed);
  const area = closed ? signedProfileArea(points) : 0;
  if (closed && Math.abs(area) <= profileTolerance) {
    throw new Error('The profile must enclose a nonzero area before offsetting.');
  }
  const leftDistance = closed && area > 0 ? -distance : distance;
  const count = closed ? points.length : points.length - 1;
  const directions = Array.from({ length: count }, (_, index) => {
    const delta = subtract2(points[(index + 1) % points.length]!, points[index]!);
    const length = Math.hypot(delta.x, delta.y);
    return { x: delta.x / length, y: delta.y / length };
  });
  const shifted = (index: number, direction: ManualProfilePoint): ManualProfilePoint => ({
    x: points[index]!.x - direction.y * leftDistance,
    y: points[index]!.y + direction.x * leftDistance,
  });
  const offsetPoints = points.map((point, index) => {
    const before = directions[(index + count - 1) % count]!;
    const after = directions[index % count]!;
    if (!closed && (index === 0 || index === points.length - 1)) {
      return { ...point, ...shifted(index, index === 0 ? after : before) };
    }
    const start = shifted(index, before);
    const end = shifted(index, after);
    const determinant = cross2(before, after);
    let result = end;
    if (Math.abs(determinant) <= 1e-10) {
      if (before.x * after.x + before.y * after.y < 0) {
        throw new Error('The profile reverses direction at a corner. Correct it before offsetting.');
      }
    } else {
      const along = cross2(subtract2(end, start), after) / determinant;
      result = { x: start.x + before.x * along, y: start.y + before.y * along };
    }
    if (Math.hypot(result.x - point.x, result.y - point.y) > Math.abs(distance) * 20 + profileTolerance) {
      throw new Error('The offset creates an excessive mitre. Reduce the distance or open the corner angle.');
    }
    return { ...point, ...result };
  });
  for (let index = 0; index < count; index++) {
    const delta = subtract2(offsetPoints[(index + 1) % points.length]!, offsetPoints[index]!);
    const direction = directions[index]!;
    if (delta.x * direction.x + delta.y * direction.y <= profileTolerance) {
      throw new Error('The offset collapses or reverses a segment. Reduce the distance.');
    }
  }
  assertSimplePolyline(offsetPoints, closed);
  if (closed && signedProfileArea(offsetPoints) * area <= 0) {
    throw new Error('The offset collapses the closed profile. Reduce the distance.');
  }
  return manualProfileSchema.parse({ ...profile, points: offsetPoints });
}

/** Native Z-up millimetre bounds, also used to choose a piece-local transform pivot. @public */
export const manualBoundsSchema = z
  .object({ min: vector, max: vector })
  .strict()
  .refine(
    ({ min, max }) => min.every((value, index) => value <= max[index]!),
    'Bounds must have ordered minima and maxima.',
  );
/** Exact native piece or curve bounds in millimetres. @public */
export type ManualBounds = z.infer<typeof manualBoundsSchema>;

const edgeGeometryBase = {
  length: positive,
  bounds: manualBoundsSchema,
  adjacentFaceCount: z.number().int().min(1).max(1000),
  seam: z.boolean(),
  closed: z.boolean(),
};
/** Whole native edge geometry; no mesh sampling or mutable native identifier is a replay witness. @public */
export const manualEdgeGeometrySchema = z
  .discriminatedUnion('kind', [
    z.object({ ...edgeGeometryBase, kind: z.literal('line'), start: vector, end: vector }).strict(),
    z
      .object({
        ...edgeGeometryBase,
        kind: z.literal('circle'),
        start: vector,
        end: vector,
        center: vector,
        normal: direction,
        radius: positive,
      })
      .strict(),
    z
      .object({
        ...edgeGeometryBase,
        kind: z.literal('nurbs'),
        degree: z.number().int().min(1).max(32),
        knots: z.array(z.number()).min(4).max(8192),
        points: z.array(vector).min(2).max(4096),
        weights: z.array(z.number()).min(2).max(4096).nullable(),
      })
      .strict(),
  ])
  .superRefine((geometry, context) => {
    if (
      geometry.kind === 'nurbs' &&
      (geometry.knots.length !== geometry.points.length + geometry.degree + 1 ||
        (geometry.weights !== null && geometry.weights.length !== geometry.points.length))
    ) {
      context.addIssue({ code: 'custom', message: 'NURBS control points, degree, knots and weights must agree.' });
    }
    if (
      geometry.kind === 'nurbs' &&
      (geometry.degree >= geometry.points.length ||
        !geometry.knots.every((value, index) => index === 0 || value >= geometry.knots[index - 1]!) ||
        geometry.knots.at(-1)! <= geometry.knots[0]! ||
        (geometry.weights !== null && !geometry.weights.some((weight) => Math.abs(weight) > 1e-12)))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'NURBS knots must be ordered with a nonzero span and valid weights.',
      });
    }
  });
/** Analytic or complete NURBS identity of one native edge at a replay step. @public */
export type ManualEdgeGeometry = z.infer<typeof manualEdgeGeometrySchema>;
/** A visible edge occurrence mapped to its native curve descriptor. @public */
export type ManualEdgeInfo = { edgeId: number; index: number; geometry: ManualEdgeGeometry };

/** Semantic selections survive compatible edits; indices require an unchanged geometry witness. @public */
export const manualEdgeSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('parallel'), axis: direction }).strict(),
  z
    .object({
      kind: z.literal('indices'),
      indices: z.array(z.number().int().min(0).max(100_000)).min(1).max(512),
      bodySignature: identifier,
      replayWitness: z
        .string()
        .regex(/^[\da-f]{64}$/)
        .optional(),
      geometries: z.array(manualEdgeGeometrySchema).min(1).max(512).optional(),
    })
    .strict()
    .superRefine((selection, context) => {
      if ((selection.replayWitness === undefined) !== (selection.geometries === undefined)) {
        context.addIssue({
          code: 'custom',
          message: 'Picked edges require both replay provenance and curve descriptors.',
        });
      }
      if (
        selection.geometries &&
        (selection.indices.length !== selection.geometries.length ||
          new Set(selection.indices).size !== selection.indices.length)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Each unique picked edge index must have exactly one curve descriptor.',
        });
      }
    }),
]);
/** Selection of exact B-rep edges at this history step. @public */
export type ManualEdgeSelection = z.infer<typeof manualEdgeSelectionSchema>;

/** Native planar face extent and topology used to verify replay correspondence. @public */
export const manualFaceGeometrySchema = z
  .object({
    normal: direction,
    center: vector,
    area: positive,
    bounds: z.object({ min: vector, max: vector }).strict(),
    edgeCount: z.number().int().min(1),
    innerWireCount: z.number().int().min(0),
  })
  .strict();
/** Millimetre-space native face descriptor; normals are unit directions. @public */
export type ManualFaceGeometry = z.infer<typeof manualFaceGeometrySchema>;

/** Exact-state selection of a planar native face, verified against its picked point. @public */
export const manualFaceSelectionSchema = z
  .object({
    index: z.number().int().min(0).max(100_000),
    bodySignature: z.string().regex(/^[\da-f]{64}$/),
    point: vector,
    replayWitness: z
      .string()
      .regex(/^[\da-f]{64}$/)
      .optional(),
    geometry: manualFaceGeometrySchema.optional(),
  })
  .strict()
  .superRefine((face, context) => {
    if ((face.replayWitness === undefined) !== (face.geometry === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Replay face selections require both provenance and native geometry.',
      });
    }
  });
/** A picked point in native Z-up millimetres on the guarded body's face. @public */
export type ManualFaceSelection = z.infer<typeof manualFaceSelectionSchema>;

/** A visible planar face occurrence mapped to its exact native face index. @public */
export type ManualFaceInfo = {
  faceId: number;
  index: number;
  isPlanar: true;
  center: ManualVector;
  normal: ManualVector;
  geometry: ManualFaceGeometry;
};

/** What a profile is swept along: a sketched curve (open or closed), or an exact edge of a named piece. @public */
export const manualSweepPathSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sketch'), profile: manualProfileSchema }).strict(),
  z.object({ kind: z.literal('edge'), piece: target, geometry: manualEdgeGeometrySchema }).strict(),
]);
/** A sweep path. @public */
export type ManualSweepPath = z.infer<typeof manualSweepPathSchema>;

const base = { id: identifier, enabled: z.boolean().optional() };
const booleanMode = z.enum(['new', 'add', 'cut']);
const creation = { mode: booleanMode, name: authoredName.optional(), target: target.optional() };

/** Serializable, ordered native operations; no executable code is accepted. @public */
export const manualOperationSchema = z
  .discriminatedUnion('type', [
    z.object({ ...base, type: z.literal('sketch'), name: authoredName, profile: manualProfileSchema }).strict(),
    z.object({ ...base, type: z.literal('translate'), target, delta: vector }).strict(),
    z
      .object({
        ...base,
        type: z.literal('faceExtrude'),
        target,
        face: manualFaceSelectionSchema,
        distance: scalar.refine((value) => Math.abs(value) > 1e-6, 'Face extrusion distance must be nonzero.'),
      })
      .strict(),
    z.object({ ...base, type: z.literal('rotate'), target, axis: direction, origin: vector, angle: scalar }).strict(),
    z.object({ ...base, type: z.literal('scale'), target, factor: positive, origin: vector }).strict(),
    z.object({ ...base, type: z.literal('mirror'), target, plane, origin: vector }).strict(),
    z
      .object({
        ...base,
        ...creation,
        type: z.literal('extrude'),
        profile: manualProfileSchema,
        distance: scalar.refine((value) => Math.abs(value) > 1e-6, 'Extrusion distance must be nonzero.'),
        /** Draft in degrees: positive narrows the solid away from the sketch. */
        taper: z
          .number()
          .min(-60)
          .max(60)
          .refine((value) => Math.abs(value) > 1e-6, 'A draft angle must be nonzero.')
          .optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        ...creation,
        type: z.literal('revolve'),
        profile: manualProfileSchema,
        /** The axis, in the profile's own millimetres: a sketch line, or a model edge laid on the sketch plane. */
        axis: z.object({ start: profilePoint, end: profilePoint }).strict(),
        angle: z
          .number()
          .min(-360)
          .max(360)
          .refine((value) => Math.abs(value) > 1e-6, 'A revolution needs a nonzero angle.'),
      })
      .strict(),
    z
      .object({
        ...base,
        ...creation,
        type: z.literal('sweep'),
        profile: manualProfileSchema,
        path: manualSweepPathSchema,
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal('hole'),
        target,
        center: vector,
        axis: direction,
        diameter: positive,
        depth: positive,
      })
      .strict(),
    z.object({ ...base, type: z.literal('fillet'), target, edges: manualEdgeSelectionSchema, size: positive }).strict(),
    z
      .object({ ...base, type: z.literal('chamfer'), target, edges: manualEdgeSelectionSchema, size: positive })
      .strict(),
  ])
  .superRefine((operation, context) => {
    if (operation.type !== 'extrude' && operation.type !== 'revolve' && operation.type !== 'sweep') {
      return;
    }
    if (!isManualProfileClosed(operation.profile)) {
      context.addIssue({
        code: 'custom',
        message: 'Extrusion requires a closed profile. Close the profile first.',
        path: ['profile'],
      });
    }
    if (
      operation.type === 'revolve' &&
      Math.hypot(operation.axis.end.x - operation.axis.start.x, operation.axis.end.y - operation.axis.start.y) <= 1e-6
    ) {
      context.addIssue({ code: 'custom', message: 'A revolution axis needs two distinct points.', path: ['axis'] });
    }
    if (operation.mode === 'new' && (!operation.name || operation.target !== undefined)) {
      context.addIssue({ code: 'custom', message: 'A new piece needs a name and no target.' });
    }
    if (operation.mode !== 'new' && (!operation.target || operation.name !== undefined)) {
      context.addIssue({ code: 'custom', message: 'An add or cut needs a target and no new name.' });
    }
  });
/** One native geometry operation in the manual history. @public */
export type ManualOperation = z.infer<typeof manualOperationSchema>;

/** Versioned sidecar shared by the UI and the SMLib evaluator. @public */
export const manualDocumentSchema = z
  .object({
    version: z.literal(1),
    operations: z.array(manualOperationSchema).max(256),
  })
  .strict()
  .superRefine((document, context) => {
    if (new Set(document.operations.map((operation) => operation.id)).size !== document.operations.length) {
      context.addIssue({ code: 'custom', message: 'Manual operation ids must be unique.', path: ['operations'] });
    }
  });
/** Replayable operations stored alongside a model entry. @public */
export type ManualDocument = z.infer<typeof manualDocumentSchema>;

/**
 * Locate a manual sidecar without replacing the entry's extension.
 * @param entryPath - Canonical project-relative model path.
 * @returns Sidecar path in the same project filesystem.
 * @public
 */
export function manualEntryPath(entryPath: string): string {
  if (
    !entryPath ||
    entryPath.startsWith('/') ||
    entryPath.includes('\\') ||
    entryPath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Manual operations require a canonical project-relative entry path.');
  }
  return `${entryPath}.manual.json`;
}

/**
 * Parse and validate an authored manual sidecar.
 * @param text - JSON contents; malformed data is never ignored.
 * @returns Validated manual history.
 * @public
 */
export function parseManualDocument(text: string): ManualDocument {
  if (text.length > 2_000_000) {
    throw new Error('Manual operations exceed the 2 MB document limit.');
  }
  return manualDocumentSchema.parse(JSON.parse(text));
}

/**
 * Validate and serialize a sidecar for durable storage.
 * @param document - Complete manual history.
 * @returns Readable JSON with a trailing newline.
 * @public
 */
export function serializeManualDocument(document: ManualDocument): string {
  return `${JSON.stringify(manualDocumentSchema.parse(document), undefined, 2)}\n`;
}
