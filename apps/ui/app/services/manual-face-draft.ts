import { z } from 'zod';
import { randomUuid } from '@taucad/utils/id';
import type { GeometryComponentManifest } from '@taucad/types';
import type { SourceRevision } from '@taucad/runtime';
import { manualDocumentSchema, manualEntryPath, manualFaceGeometrySchema } from '@taucad/smlib/manual-operations';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import type { PlanarFacePick, PlanarFaceSelection } from '@taucad/viewer/cad/planar-face-tool';

const vector = z.tuple([z.number(), z.number(), z.number()]);
const faceDescriptor = z.object({
  faceId: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  isPlanar: z.literal(true),
  center: vector,
  normal: vector,
  geometry: manualFaceGeometrySchema.optional(),
});
const bodyDescriptor = z.object({
  manualTargetName: z.string().min(1),
  manualBodySignature: z.string().regex(/^[\da-f]{64}$/u),
  manualReplayWitness: z
    .string()
    .regex(/^[\da-f]{64}$/u)
    .optional(),
  manualFaces: z.array(faceDescriptor),
});

/** A pending sidecar write must never authorize another operation against the old displayed body. */
export function matchesManualSidecarRevision(
  digest: string | undefined,
  revision: SourceRevision | undefined,
  entryPath: string,
): boolean {
  if (digest === undefined || revision === undefined || revision.entry !== entryPath) {
    return false;
  }
  const rendered = revision.files[manualEntryPath(entryPath)];
  return digest === 'missing' ? rendered === undefined || rendered === 'missing' : rendered === digest;
}

/** All sources of authority must still be the ones acknowledged at selection. */
export type ManualFaceWitness = Readonly<{
  available: boolean;
  document: ManualDocument | undefined;
  commit: (next: ManualDocument) => Promise<boolean>;
  manifest: GeometryComponentManifest | undefined;
  runtimeDocument: unknown;
  renderStamp: string | undefined;
  artifactKey: string | undefined;
}>;

export type ManualFaceFailure = 'faceInvalid' | 'faceStale' | 'faceCommitFailed';
/** A hole drilled into the piece from the picked point of the face, along its inward normal, in millimetres. */
export type ManualFaceHole = Readonly<{ diameter: number; depth: number }>;
export type ManualFaceDraft = Readonly<{
  name: string;
  faceIndex: number;
  selection: PlanarFaceSelection;
  witness: ManualFaceWitness;
  isCurrent: (current: ManualFaceWitness) => boolean;
  apply: (distanceMillimetres: number, current: ManualFaceWitness) => Promise<ManualFaceFailure | undefined>;
  /** Append the existing `hole` operation, placed where the face was picked; its geometry is the kernel's own. */
  applyHole: (hole: ManualFaceHole, current: ManualFaceWitness) => Promise<ManualFaceFailure | undefined>;
}>;

/** The drill starts this far outside the face so the cut always opens the surface, never leaves a skin. */
const holeLeadMillimetres = 0.2;

/** Admit exact planar metadata only; a face id is an occurrence, never a native index. */
export function createManualFaceDraft(witness: ManualFaceWitness, pick: PlanarFacePick): ManualFaceDraft | undefined {
  if (!witness.available || !witness.document || !witness.renderStamp || pick.artifactKey !== witness.artifactKey) {
    return undefined;
  }
  const { document } = witness;
  const node = witness.manifest?.nodesById[pick.componentId];
  const body = bodyDescriptor.safeParse(node?.extras);
  if (!body.success || !pick.point.every(Number.isFinite)) {
    return undefined;
  }
  const face = body.data.manualFaces.find((candidate) => candidate.faceId === pick.faceId);
  if (!face) {
    return undefined;
  }
  if ((body.data.manualReplayWitness === undefined) !== (face.geometry === undefined)) {
    return undefined;
  }
  const normal = face.geometry?.normal ?? face.normal;
  const length = Math.hypot(...normal);
  if (length < 0.999 || length > 1.001) {
    return undefined;
  }
  const point: [number, number, number] = [pick.point[0] * 1000, pick.point[1] * 1000, pick.point[2] * 1000];
  const selection: PlanarFaceSelection = {
    componentId: pick.componentId,
    faceId: pick.faceId,
    anchor: [...pick.point],
    normal: [...normal],
    revision: witness.renderStamp,
  };
  let submitted = false;
  const isCurrent = (current: ManualFaceWitness): boolean =>
    current.available &&
    current.document === witness.document &&
    current.commit === witness.commit &&
    current.manifest === witness.manifest &&
    current.runtimeDocument === witness.runtimeDocument &&
    current.renderStamp === witness.renderStamp &&
    current.artifactKey === witness.artifactKey;
  const commitOperation = async (operation: unknown): Promise<ManualFaceFailure | undefined> => {
    const next = manualDocumentSchema.safeParse({ ...document, operations: [...document.operations, operation] });
    if (!next.success) {
      return 'faceInvalid';
    }
    submitted = true;
    try {
      return (await witness.commit(next.data)) ? undefined : 'faceCommitFailed';
    } catch {
      return 'faceCommitFailed';
    }
  };
  return {
    name: body.data.manualTargetName,
    faceIndex: face.index,
    selection,
    witness,
    isCurrent,
    applyHole: async ({ diameter, depth }, current) => {
      if (submitted || !isCurrent(current)) {
        return 'faceStale';
      }
      if (!Number.isFinite(diameter) || diameter <= 0 || !Number.isFinite(depth) || depth <= 0) {
        return 'faceInvalid';
      }
      return commitOperation({
        id: randomUuid(),
        type: 'hole',
        target: { name: body.data.manualTargetName },
        center: [
          point[0] + normal[0] * holeLeadMillimetres,
          point[1] + normal[1] * holeLeadMillimetres,
          point[2] + normal[2] * holeLeadMillimetres,
        ],
        axis: [-normal[0], -normal[1], -normal[2]],
        diameter,
        depth: depth + holeLeadMillimetres,
      });
    },
    apply: async (distance, current) => {
      if (submitted || !isCurrent(current)) {
        return 'faceStale';
      }
      if (!Number.isFinite(distance) || distance === 0) {
        return 'faceInvalid';
      }
      const next = manualDocumentSchema.safeParse({
        ...document,
        operations: [
          ...document.operations,
          {
            id: randomUuid(),
            type: 'faceExtrude',
            target: { name: body.data.manualTargetName },
            face: {
              index: face.index,
              bodySignature: body.data.manualBodySignature,
              point,
              ...(body.data.manualReplayWitness && face.geometry
                ? { replayWitness: body.data.manualReplayWitness, geometry: face.geometry }
                : {}),
            },
            distance,
          },
        ],
      });
      if (!next.success) {
        return 'faceInvalid';
      }
      submitted = true;
      try {
        return (await witness.commit(next.data)) ? undefined : 'faceCommitFailed';
      } catch {
        return 'faceCommitFailed';
      }
    },
  };
}

/** Capability is driven by exact planar descriptors, and articulated geometry is not editable here. */
export function hasManualPlanarFaces(manifest: GeometryComponentManifest | undefined): boolean {
  return (
    manifest !== undefined &&
    !manifest.mechanism &&
    Object.values(manifest.nodesById).some((node) => {
      const parsed = bodyDescriptor.safeParse(node.extras);
      return (
        parsed.success &&
        parsed.data.manualFaces.some(
          (face) => (parsed.data.manualReplayWitness === undefined) === (face.geometry === undefined),
        )
      );
    })
  );
}
