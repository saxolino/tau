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

/** Closed profile in the local coordinates of a placed principal plane. @public */
export const manualProfileSchema = z
  .object({
    kind: z.enum(['polygon', 'spline']),
    points: z.array(point).min(3).max(256),
    plane,
    origin: vector,
  })
  .strict()
  .superRefine((profile, context) => {
    if (new Set(profile.points.map((value) => value.id)).size !== profile.points.length) {
      context.addIssue({ code: 'custom', message: 'Profile point ids must be unique.', path: ['points'] });
    }
    for (let index = 0; index < profile.points.length; index++) {
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
/** Editable points remain canonical; the kernel rebuilds the closed curve. @public */
export type ManualProfile = z.infer<typeof manualProfileSchema>;

/** A profile-local point in millimetres. @public */
export type ManualProfilePoint = Pick<ManualProfile['points'][number], 'x' | 'y'>;

/** Cubic Bézier controls shared by the editable preview and native geometry. @public */
export type ManualProfileSegment = {
  start: ManualProfilePoint;
  control1: ManualProfilePoint;
  control2: ManualProfilePoint;
  end: ManualProfilePoint;
};

/**
 * Build a closed, uniform Catmull-Rom curve as exact cubic Bézier segments.
 * @param profile - Validated local profile points in their authored order.
 * @returns One segment per point; the last segment closes on the first point.
 * @public
 */
export function manualProfileSegments(profile: ManualProfile): ManualProfileSegment[] {
  const { points } = profile;
  return points.map((point, index) => {
    const before = points[(index + points.length - 1) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    const after = points[(index + 2) % points.length]!;
    return {
      start: { x: point.x, y: point.y },
      control1: { x: point.x + (next.x - before.x) / 6, y: point.y + (next.y - before.y) / 6 },
      control2: { x: next.x - (after.x - point.x) / 6, y: next.y - (after.y - point.y) / 6 },
      end: { x: next.x, y: next.y },
    };
  });
}

/** Semantic selections survive compatible edits; indices require an unchanged geometry witness. @public */
export const manualEdgeSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('parallel'), axis: direction }).strict(),
  z
    .object({
      kind: z.literal('indices'),
      indices: z.array(z.number().int().min(0).max(100_000)).min(1).max(512),
      bodySignature: identifier,
    })
    .strict(),
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

const base = { id: identifier, enabled: z.boolean().optional() };
const booleanMode = z.enum(['new', 'add', 'cut']);
const creation = { mode: booleanMode, name: authoredName.optional(), target: target.optional() };

/** Serializable, ordered native operations; no executable code is accepted. @public */
export const manualOperationSchema = z
  .discriminatedUnion('type', [
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
    if (operation.type !== 'extrude') {
      return;
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
