import { z } from 'zod';
import { randomUuid } from '@taucad/utils/id';
import type { GeometryComponentManifest } from '@taucad/types';
import { manualBoundsSchema, manualDocumentSchema, manualEdgeGeometrySchema } from '@taucad/smlib/manual-operations';
import type { ManualOperation, ManualEdgeGeometry } from '@taucad/smlib/manual-operations';
import type {
  DirectEditChange,
  DirectEditTool,
  DirectEditPick,
  DirectEditSelection,
} from '@taucad/viewer/cad/direct-edit-tool';
import type { ManualFaceWitness } from '#services/manual-face-draft.js';

type DirectEditMode = DirectEditTool['mode'];

const signature = z.string().regex(/^[\da-f]{64}$/u);
const edgeDescriptor = z.object({
  edgeId: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  geometry: manualEdgeGeometrySchema,
});
const bodyDescriptor = z.object({
  manualTargetName: z.string().min(1),
  manualBodySignature: signature,
  manualReplayWitness: signature.optional(),
  manualBounds: manualBoundsSchema,
  manualEdges: z.array(edgeDescriptor).optional(),
});
export type ManualDirectWitness = ManualFaceWitness & Readonly<{ mode: DirectEditMode | undefined }>;
export type ManualDirectFailure = 'directInvalid' | 'directStale' | 'directCommitFailed' | 'edgeSameBody';
export type ManualEdgeChange = Readonly<{ type: 'fillet' | 'chamfer'; size: number }>;
export type ManualPickedEdge = Readonly<{ edgeId: number; index: number; geometry: ManualEdgeGeometry }>;
export type ManualDirectDraft = Readonly<{
  mode: DirectEditMode;
  name: string;
  selection: DirectEditSelection;
  edges: readonly ManualPickedEdge[];
  witness: ManualDirectWitness;
  isCurrent: (current: ManualDirectWitness) => boolean;
  apply: (
    change: DirectEditChange | ManualEdgeChange,
    current: ManualDirectWitness,
  ) => Promise<ManualDirectFailure | undefined>;
}>;

const millimetres = (value: readonly [number, number, number]): [number, number, number] => [
  value[0] * 1000,
  value[1] * 1000,
  value[2] * 1000,
];
const isEdgeMode = (mode: DirectEditMode | undefined): boolean => mode === 'fillet' || mode === 'chamfer';

/** Exact body metadata is the only source of both pivot and occurrence-to-native edge mapping. */
export function createManualDirectDraft(
  witness: ManualDirectWitness,
  pick: DirectEditPick,
  previous?: ManualDirectDraft,
): ManualDirectDraft | undefined {
  const { document, mode } = witness;
  if (
    !witness.available ||
    !document ||
    !mode ||
    !witness.renderStamp ||
    pick.artifactKey !== witness.artifactKey ||
    !pick.point.every(Number.isFinite)
  ) {
    return undefined;
  }
  const parsed = bodyDescriptor.safeParse(witness.manifest?.nodesById[pick.componentId]?.extras);
  if (!parsed.success) {
    return undefined;
  }
  const body = parsed.data;
  const pivot: [number, number, number] = [
    (body.manualBounds.min[0] + body.manualBounds.max[0]) / 2000,
    (body.manualBounds.min[1] + body.manualBounds.max[1]) / 2000,
    (body.manualBounds.min[2] + body.manualBounds.max[2]) / 2000,
  ];
  let edges: readonly ManualPickedEdge[] = [];
  if (isEdgeMode(mode)) {
    if (pick.edgeId === undefined || !body.manualReplayWitness) {
      return undefined;
    }
    if (previous && (!previous.isCurrent(witness) || previous.selection.componentId !== pick.componentId)) {
      return undefined;
    }
    const matches = body.manualEdges?.filter((edge) => edge.edgeId === pick.edgeId) ?? [];
    const edge = matches.length === 1 ? matches[0] : undefined;
    if (!edge) {
      return undefined;
    }
    const earlier = previous?.edges ?? [];
    edges = earlier.some((selected) => selected.edgeId === edge.edgeId)
      ? earlier.filter((selected) => selected.edgeId !== edge.edgeId)
      : [...earlier, edge];
    if (new Set(edges.map((selected) => selected.index)).size !== edges.length) {
      return undefined;
    }
  }
  const selection: DirectEditSelection = {
    componentId: pick.componentId,
    pivot,
    revision: witness.renderStamp,
    ...(isEdgeMode(mode) ? { edgeIds: edges.map((edge) => edge.edgeId) } : {}),
  };
  let submitted = false;
  const isCurrent = (current: ManualDirectWitness): boolean =>
    current.available &&
    current.mode === mode &&
    current.document === document &&
    current.commit === witness.commit &&
    current.manifest === witness.manifest &&
    current.runtimeDocument === witness.runtimeDocument &&
    current.renderStamp === witness.renderStamp &&
    current.artifactKey === witness.artifactKey;
  return {
    mode,
    name: body.manualTargetName,
    selection,
    edges,
    witness,
    isCurrent,
    apply: async (change, current) => {
      if (submitted || !isCurrent(current)) {
        return 'directStale';
      }
      if (change.type !== mode) {
        return 'directInvalid';
      }
      const base = { id: randomUuid(), target: { name: body.manualTargetName } };
      let operation: ManualOperation;
      switch (change.type) {
        case 'translate': {
          operation = { ...base, type: 'translate', delta: millimetres(change.delta) };
          break;
        }
        case 'rotate': {
          operation = {
            ...base,
            type: 'rotate',
            origin: millimetres(change.origin),
            axis: [...change.axis],
            angle: (change.angleRadians * 180) / Math.PI,
          };
          break;
        }
        case 'scale': {
          operation = { ...base, type: 'scale', origin: millimetres(change.origin), factor: change.factor };
          break;
        }
        case 'fillet':
        case 'chamfer': {
          if (!body.manualReplayWitness || edges.length === 0) {
            return 'directInvalid';
          }
          operation = {
            ...base,
            type: change.type,
            size: change.size,
            edges: {
              kind: 'indices',
              indices: edges.map((edge) => edge.index),
              bodySignature: body.manualBodySignature,
              replayWitness: body.manualReplayWitness,
              geometries: edges.map((edge) => edge.geometry),
            },
          };
          break;
        }
      }
      const next = manualDocumentSchema.safeParse({ ...document, operations: [...document.operations, operation] });
      if (!next.success) {
        return 'directInvalid';
      }
      submitted = true;
      try {
        return (await witness.commit(next.data)) ? undefined : 'directCommitFailed';
      } catch {
        return 'directCommitFailed';
      }
    },
  };
}

/** Articulated models and metadata-free occurrences cannot admit direct geometry edits. */
export function hasManualDirectTargets(
  manifest: GeometryComponentManifest | undefined,
  mode?: DirectEditMode,
): boolean {
  return Boolean(
    manifest &&
    !manifest.mechanism &&
    Object.values(manifest.nodesById).some((node) => {
      const parsed = bodyDescriptor.safeParse(node.extras);
      return (
        parsed.success &&
        (!isEdgeMode(mode) || Boolean(parsed.data.manualReplayWitness && parsed.data.manualEdges?.length))
      );
    }),
  );
}
