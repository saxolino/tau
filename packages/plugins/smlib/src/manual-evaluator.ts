/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
import type { Axis, Part, Shell, Sketch, Edge, Face, Wire } from '@classcad/smlibwasm';
import { isManualProfileClosed, manualProfileSegments } from '#manual-operations.js';
import type {
  ManualDocument,
  ManualOperation,
  ManualProfile,
  ManualTarget,
  ManualEdgeSelection,
  ManualVector,
  ManualFaceSelection,
  ManualFaceGeometry,
} from '#manual-operations.js';
import { resolveManualEdges } from '#manual-edge.js';
import { manualReplayWitness } from '#manual-replay.js';
import type { NamedInputShape, SmlibLibrary } from '#utils/render-output.js';

/** Exact state of a named piece after the manual history prefix. */
export type ManualShapeInfo = {
  targetName: string;
  bodySignature: string;
  operationIds: string[];
  replayWitness?: string;
};

const placedPlane = (library: SmlibLibrary, plane: ManualProfile['plane'], origin: ManualVector) => {
  const base = plane === 'xy' ? library.Plane.XY : plane === 'xz' ? library.Plane.XZ : library.Plane.YZ;
  return base.at(origin);
};

/** The plane a profile is drawn on: its sketch frame on a picked face, else its principal plane. */
const profilePlane = (library: SmlibLibrary, profile: ManualProfile) =>
  profile.frame
    ? new library.Plane(profile.origin, profile.frame.xDir, profile.frame.normal)
    : placedPlane(library, profile.plane, profile.origin);

const local3 = ({ x, y }: { x: number; y: number }): ManualVector => [x, y, 0];

/** One exact native edge of a sketched outline, from the end of the previous one. */
function pathEdge(
  library: SmlibLibrary,
  start: { x: number; y: number },
  segment: Extract<ManualProfile, { kind: 'path' }>['segments'][number],
): Edge {
  switch (segment.kind) {
    case 'line': {
      return library.Line(local3(start), local3(segment.to));
    }
    case 'arc': {
      return library.ThreePointArc(local3(start), local3(segment.through), local3(segment.to));
    }
    case 'spline': {
      return library.Spline([start, ...segment.through, segment.to].map((point) => local3(point)));
    }
  }
}

/** Exact native edges of a sketched outline, in its local plane. */
function pathEdges(library: SmlibLibrary, profile: Extract<ManualProfile, { kind: 'path' }>): Edge[] {
  let from = profile.start;
  return profile.segments.map((segment) => {
    const edge = pathEdge(library, from, segment);
    from = segment.to;
    return edge;
  });
}

/**
 * Reconstruct an editable planar curve using exact native lines, Béziers or circular arcs.
 * @param library - Initialized SMLib module.
 * @param profile - Canonical point coordinates in millimetres.
 * @returns Native wire positioned in world coordinates, preserving authored closure.
 */
export function buildManualProfileWire(library: SmlibLibrary, profile: ManualProfile): Wire {
  let local: Wire;
  switch (profile.kind) {
    case 'circle':
    case 'arc': {
      local = new library.Wire(
        library.CenterArc(
          [profile.center.x, profile.center.y, 0],
          profile.radius,
          profile.kind === 'circle' ? 0 : profile.startAngle,
          profile.kind === 'circle' ? 360 : profile.sweepAngle,
        ),
      );
      break;
    }
    case 'path': {
      local = new library.Wire(pathEdges(library, profile));
      break;
    }
    case 'polygon': {
      local = library.Polyline(
        profile.points.map(({ x, y }): ManualVector => [x, y, 0]),
        { close: isManualProfileClosed(profile) },
      );
      break;
    }
    case 'spline': {
      local = new library.Wire(
        manualProfileSegments(profile).map((segment) =>
          library.Bezier(
            [segment.start, segment.control1, segment.control2, segment.end].map(({ x, y }): ManualVector => [x, y, 0]),
          ),
        ),
      );
      break;
    }
  }
  if (!Number.isFinite(local.length) || local.length <= 1e-9 || local.isClosed !== isManualProfileClosed(profile)) {
    throw new Error('The profile did not produce the intended nonempty native curve.');
  }
  return profilePlane(library, profile).mul(local);
}

/**
 * Reconstruct a closed region using the native kernel; open curves cannot become solids.
 * @param library - Initialized SMLib module.
 * @param profile - Canonical local profile geometry in millimetres.
 * @returns Native planar sketch positioned in world coordinates.
 */
export function buildManualProfile(library: SmlibLibrary, profile: ManualProfile): Sketch {
  if (!isManualProfileClosed(profile) || profile.kind === 'arc') {
    throw new Error('Extrusion requires a closed profile. Close the profile first.');
  }
  // Retain the historical constructors and ordering for saved polygon/spline replay witnesses.
  const local =
    profile.kind === 'circle'
      ? library.Circle(profile.radius).translate([profile.center.x, profile.center.y, 0])
      : profile.kind === 'path'
        ? library.makeFace(new library.Wire(pathEdges(library, profile)))
        : profile.kind === 'polygon'
          ? library.Polygon(profile.points.map(({ x, y }): ManualVector => [x, y, 0]))
          : library.makeFace(
              new library.Wire(
                manualProfileSegments(profile).map((segment) =>
                  library.Bezier(
                    [segment.start, segment.control1, segment.control2, segment.end].map(
                      ({ x, y }): ManualVector => [x, y, 0],
                    ),
                  ),
                ),
              ),
            );
  if (!Number.isFinite(local.area) || local.area <= 1e-9) {
    throw new Error('The profile must enclose a nonzero area.');
  }
  return profilePlane(library, profile).mul(local);
}

/**
 * The world axis of a revolution, given in the profile's own millimetres.
 * @param library - Initialized SMLib module.
 * @param profile - The revolved profile, whose plane carries the axis.
 * @param axis - Two distinct profile-local points.
 * @returns The native axis in world coordinates.
 */
export function manualRevolveAxis(
  library: SmlibLibrary,
  profile: ManualProfile,
  axis: { start: { x: number; y: number }; end: { x: number; y: number } },
): Axis {
  const plane = profilePlane(library, profile);
  const start = plane.fromLocal(local3(axis.start));
  const end = plane.fromLocal(local3(axis.end));
  return new library.Axis([start.x, start.y, start.z], [end.x - start.x, end.y - start.y, end.z - start.z]);
}

/** The solid a closed profile makes on its own: extruded, revolved or swept. */
function profileSolid(
  library: SmlibLibrary,
  entries: NamedInputShape[],
  operation: Extract<ManualOperation, { type: 'extrude' | 'revolve' | 'sweep' }>,
): Part {
  const sketch = buildManualProfile(library, operation.profile);
  let solid: Part;
  if (operation.type === 'extrude') {
    solid =
      operation.taper === undefined
        ? sketch.extrude(operation.distance)
        : sketch.extrude(operation.distance, { taper: operation.taper });
  } else if (operation.type === 'revolve') {
    solid = sketch.revolve(manualRevolveAxis(library, operation.profile, operation.axis), operation.angle);
  } else {
    const { path } = operation;
    const rail =
      path.kind === 'sketch'
        ? buildManualProfileWire(library, path.profile)
        : resolveManualEdges(requirePart(library, findTarget(entries, path.piece)), [path.geometry])[0]!;
    solid = sketch.sweep(rail);
  }
  assertValidBody(library, solid);
  return solid;
}

/**
 * Hash exact B-rep bytes to bind an index selection to the geometry it was picked on.
 * @param library - Initialized SMLib module.
 * @param shape - Native body before the selected operation.
 * @returns SHA-256 witness; it is not a persistent topological name.
 */
export async function manualBodySignature(library: SmlibLibrary, shape: Part | Shell): Promise<string> {
  const bytes = new Uint8Array(library.toSmb(shape));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function findTarget(entries: NamedInputShape[], target: ManualTarget): NamedInputShape {
  const matches = entries.filter((entry) => entry.manualTargetName === target.name);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Piece "${target.name}" is missing or has no explicit name. Re-select the intended piece.`
        : `Piece name "${target.name}" is ambiguous. Give each source piece a unique name.`,
    );
  }
  return matches[0]!;
}

function requireBody(library: SmlibLibrary, entry: NamedInputShape): Part | Shell {
  if (!(entry.shape instanceof library.Part || entry.shape instanceof library.Shell)) {
    throw new Error(`Piece "${entry.name}" is not an exact body. Mesh and drawing edits are unsupported.`);
  }
  return entry.shape;
}

function requirePart(library: SmlibLibrary, entry: NamedInputShape): Part {
  if (!(entry.shape instanceof library.Part)) {
    throw new Error(`Piece "${entry.name}" must be a solid for this operation.`);
  }
  return entry.shape;
}

function assertValidBody(library: SmlibLibrary, shape: Part | Shell): void {
  if (shape instanceof library.Part && (!shape.isValid() || !Number.isFinite(shape.volume) || shape.volume <= 1e-9)) {
    throw new Error('The operation did not produce a valid, nonempty solid.');
  }
  if (shape instanceof library.Shell && (!Number.isFinite(shape.area) || shape.area <= 1e-9)) {
    throw new Error('The operation did not produce a nonempty surface.');
  }
}

async function selectEdges(
  library: SmlibLibrary,
  part: Part,
  input: { selection: ManualEdgeSelection; replayWitness?: string },
): Promise<Edge[]> {
  const { selection } = input;
  const edges = part.edges();
  if (selection.kind === 'all') {
    return [...edges];
  }
  if (selection.kind === 'parallel') {
    const selected = [...edges.parallelTo(new library.Axis([0, 0, 0], selection.axis))];
    if (selected.length === 0) {
      throw new Error('No edges match the selected direction.');
    }
    return selected;
  }
  if (selection.replayWitness !== undefined) {
    if (!input.replayWitness || input.replayWitness !== selection.replayWitness || !selection.geometries) {
      throw new Error('The selected edges belong to an older source or manual history. Re-select them.');
    }
    return resolveManualEdges(part, selection.geometries);
  }
  if ((await manualBodySignature(library, part)) !== selection.bodySignature) {
    throw new Error('The selected edges belong to an older geometry. Re-select them before applying this operation.');
  }
  return [...new Set(selection.indices)].map((index) => {
    const edge = edges[index];
    if (!edge) {
      throw new Error(`Selected edge ${index} no longer exists.`);
    }
    return edge;
  });
}

/**
 * Exact native face measurements used to identify its whole trimmed region on fresh replay.
 * @param face - A planar native face.
 * @returns Its millimetre-space extent, orientation and boundary topology.
 */
export function manualFaceGeometry(face: Face): ManualFaceGeometry {
  const center = face.center();
  const normal = face.normalAt(face.interiorPoint());
  const bounds = face.bbox();
  return {
    center: [center.x, center.y, center.z],
    normal: [normal.x, normal.y, normal.z],
    area: face.area,
    bounds: { min: [bounds.min.x, bounds.min.y, bounds.min.z], max: [bounds.max.x, bounds.max.y, bounds.max.z] },
    edgeCount: face.edges().length,
    innerWireCount: face.innerWires().length,
  };
}

const facePickTolerance = 1e-3;
const containsInteriorPick = (face: Face, point: ManualVector): boolean =>
  face.distanceTo(point) <= facePickTolerance &&
  !face.edges().some((edge) => edge.distanceTo(point) <= facePickTolerance);
const matchesFaceGeometry = (face: Face, expected: ManualFaceGeometry): boolean => {
  const actual = manualFaceGeometry(face);
  const closeVector = (a: ManualVector, b: ManualVector): boolean =>
    a.every((value, index) => Math.abs(value - b[index]!) <= facePickTolerance);
  const normalDot =
    (actual.normal[0] * expected.normal[0] +
      actual.normal[1] * expected.normal[1] +
      actual.normal[2] * expected.normal[2]) /
    Math.hypot(...expected.normal);
  return (
    normalDot >= 1 - 1e-10 &&
    closeVector(actual.center, expected.center) &&
    closeVector(actual.bounds.min, expected.bounds.min) &&
    closeVector(actual.bounds.max, expected.bounds.max) &&
    Math.abs(actual.area - expected.area) <= Math.max(1e-6, expected.area * 1e-8) &&
    actual.edgeCount === expected.edgeCount &&
    actual.innerWireCount === expected.innerWireCount
  );
};

async function extrudeSelectedFace(
  library: SmlibLibrary,
  part: Part,
  input: { face: ManualFaceSelection; distance: number; replayWitness?: string },
): Promise<Part> {
  let face: Face | undefined;
  if (input.face.replayWitness === undefined) {
    if ((await manualBodySignature(library, part)) !== input.face.bodySignature) {
      throw new Error('The selected face belongs to an older geometry. Re-select it before applying this operation.');
    }
    face = part.faces()[input.face.index];
    if (!face) {
      throw new Error('The selected native face no longer exists.');
    }
    if (!face.isPlanar) {
      throw new Error('Face extrusion requires a planar face.');
    }
    if (face.distanceTo(input.face.point) > facePickTolerance) {
      throw new Error('The picked point is outside the selected native face. Re-select the face.');
    }
    if (!containsInteriorPick(face, input.face.point)) {
      throw new Error('Pick inside the planar face, away from its boundary.');
    }
  } else {
    if (!input.replayWitness || input.face.replayWitness !== input.replayWitness || !input.face.geometry) {
      throw new Error('The selected face belongs to an older source or manual history. Re-select it.');
    }
    const { geometry } = input.face;
    const matches = part
      .faces()
      .filter(
        (candidate) =>
          candidate.isPlanar &&
          containsInteriorPick(candidate, input.face.point) &&
          matchesFaceGeometry(candidate, geometry),
      );
    if (matches.length !== 1) {
      throw new Error('The selected planar face cannot be matched uniquely on replay. Re-select it.');
    }
    [face] = matches;
  }
  if (!face) {
    throw new Error('The selected native face is unavailable.');
  }
  const tool = face.extrude(input.distance);
  const result = input.distance > 0 ? part.fuse(tool) : part.cut(tool);
  assertValidBody(library, result);
  assertBooleanChange(part, result, input.distance > 0 ? 'add' : 'cut');
  if (result.solids().length !== part.solids().length) {
    throw new Error('Face extrusion must preserve the selected solid’s connected pieces.');
  }
  return result;
}

const withOperation = (
  entry: NamedInputShape,
  shape: Part | Shell | Wire | Edge,
  operation: ManualOperation,
): NamedInputShape => ({
  ...entry,
  shape,
  manual: {
    targetName: entry.manualTargetName!,
    bodySignature: '',
    operationIds: [...(entry.manual?.operationIds ?? []), operation.id],
  },
});

async function applyOperation(
  library: SmlibLibrary,
  entries: NamedInputShape[],
  input: { operation: ManualOperation; replayWitness?: string },
): Promise<NamedInputShape[]> {
  const { operation } = input;
  const isProfileSolid = operation.type === 'extrude' || operation.type === 'revolve' || operation.type === 'sweep';
  if (operation.type === 'sketch' || (isProfileSolid && operation.mode === 'new')) {
    const name = operation.name!;
    if (entries.some((entry) => entry.name === name || entry.manualTargetName === name)) {
      throw new Error(`A piece named "${name}" already exists. Choose a unique name.`);
    }
    const shape =
      operation.type === 'sketch'
        ? buildManualProfileWire(library, operation.profile)
        : profileSolid(library, entries, operation);
    if (shape instanceof library.Part) {
      assertValidBody(library, shape);
    }
    return [
      ...entries,
      withOperation(
        {
          shape,
          name,
          manualTargetName: name,
          ...(operation.type === 'sketch' ? { manualDrawingPlane: operation.profile.plane } : {}),
        },
        shape,
        operation,
      ),
    ];
  }
  const { target } = operation;
  if (!target) {
    throw new Error('This operation requires a target piece.');
  }
  const entry = findTarget(entries, target);
  const original = requireBody(library, entry);
  let result: Part | Shell;
  switch (operation.type) {
    case 'faceExtrude': {
      result = await extrudeSelectedFace(library, requirePart(library, entry), {
        ...operation,
        replayWitness: input.replayWitness,
      });
      break;
    }
    case 'translate': {
      result = original.translate(operation.delta);
      break;
    }
    case 'rotate': {
      result = original.rotate(new library.Axis(operation.origin, operation.axis), operation.angle);
      break;
    }
    case 'scale': {
      result = original.scale(operation.factor, operation.origin);
      break;
    }
    case 'mirror': {
      result = original.mirror(placedPlane(library, operation.plane, operation.origin));
      break;
    }
    case 'extrude':
    case 'revolve':
    case 'sweep': {
      const part = requirePart(library, entry);
      const tool = profileSolid(library, entries, operation);
      result = operation.mode === 'add' ? part.fuse(tool) : part.cut(tool);
      assertBooleanChange(part, result, operation.mode);
      break;
    }
    case 'hole': {
      const part = requirePart(library, entry);
      const profile = new library.Plane(operation.center, undefined, operation.axis).mul(
        library.Circle(operation.diameter / 2),
      );
      result = part.cut(profile.extrude(operation.depth));
      assertBooleanChange(part, result, 'cut');
      break;
    }
    case 'fillet':
    case 'chamfer': {
      const part = requirePart(library, entry);
      const edges = await selectEdges(library, part, {
        selection: operation.edges,
        replayWitness: input.replayWitness,
      });
      result = operation.type === 'fillet' ? part.fillet(edges, operation.size) : part.chamfer(edges, operation.size);
      break;
    }
  }
  assertValidBody(library, result);
  return entries.map((candidate) => (candidate === entry ? withOperation(entry, result, operation) : candidate));
}

function assertBooleanChange(before: Part, after: Part, mode: string): void {
  const tolerance = Math.max(1e-7, Math.abs(before.volume) * 1e-9);
  const delta = after.volume - before.volume;
  if ((mode === 'cut' && delta >= -tolerance) || (mode === 'add' && delta <= tolerance)) {
    throw new Error(`The ${mode} does not change the selected solid. Check the profile position and depth.`);
  }
  if (mode === 'add' && after.solids().length !== before.solids().length) {
    throw new Error('The added profile must join the selected solid. Use New piece for a disconnected result.');
  }
}

/**
 * Replay manual history on fresh source bodies before meshing, snapshots and export.
 * @param input - Native library, normalized source shapes and validated manual history.
 * @returns Rebuilt shapes with per-piece replay and selection evidence.
 */
export async function applyManualOperations(input: {
  library: SmlibLibrary;
  entries: NamedInputShape[];
  document: ManualDocument;
  replaySource?: string;
}): Promise<NamedInputShape[]> {
  const { library, document } = input;
  let { entries } = input;
  const prefix: ManualOperation[] = [];
  for (const operation of document.operations) {
    if (operation.enabled === false) {
      prefix.push(operation);
      continue;
    }
    try {
      let replayWitness: string | undefined;
      if (input.replaySource && 'target' in operation && operation.target) {
        // oxlint-disable-next-line no-await-in-loop -- a face's provenance binds precisely this ordered prefix.
        replayWitness = await manualReplayWitness(input.replaySource, prefix, operation.target.name);
      }
      // oxlint-disable-next-line no-await-in-loop -- each operation consumes the preceding native result.
      entries = await applyOperation(library, entries, { operation, replayWitness });
      prefix.push(operation);
    } catch (error) {
      throw new Error(
        `Manual operation "${operation.id}" (${operation.type}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return Promise.all(
    entries.map(async (entry) => {
      if (!entry.manualTargetName || !(entry.shape instanceof library.Part || entry.shape instanceof library.Shell)) {
        return entry;
      }
      return {
        ...entry,
        manual: {
          targetName: entry.manualTargetName,
          bodySignature: await manualBodySignature(library, entry.shape),
          operationIds: entry.manual?.operationIds ?? [],
          ...(input.replaySource
            ? {
                replayWitness: await manualReplayWitness(
                  input.replaySource,
                  document.operations,
                  entry.manualTargetName,
                ),
              }
            : {}),
        },
      };
    }),
  );
}
