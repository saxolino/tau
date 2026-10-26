import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import type { ManualDocument, ManualFaceGeometry } from '@taucad/smlib/manual-operations';
import type { SourceRevision } from '@taucad/runtime';
import type { PlanarFacePick } from '@taucad/viewer/cad/planar-face-tool';
import {
  createManualFaceDraft,
  hasManualPlanarFaces,
  matchesManualSidecarRevision,
} from '#services/manual-face-draft.js';
import type { ManualFaceWitness } from '#services/manual-face-draft.js';

const signature = 'a'.repeat(64);
const replayWitness = 'b'.repeat(64);
const geometry = {
  normal: [0, 0, 1],
  center: [10, -20, 3],
  area: 200,
  bounds: { min: [0, -30, 3], max: [20, -10, 3] },
  edgeCount: 4,
  innerWireCount: 0,
} satisfies ManualFaceGeometry;
const pick: PlanarFacePick = { componentId: 'body', faceId: 23, point: [0.01, -0.02, 0.003], artifactKey: 'mesh-a' };
function fixture() {
  const capabilities = {
    canHide: true,
    canIsolate: true,
    canFocus: true,
    canAdjustOpacity: true,
    hasDrawings: false,
    hasPreciseTopology: true,
    exports: [],
  };
  const node: GeometryComponentNode = {
    id: 'body',
    name: 'Body',
    kind: 'body',
    selector: 'body',
    childIds: [],
    depth: 0,
    path: [],
    meshNodeIndices: [],
    primitiveIndices: [],
    materialIndices: [],
    capabilities,
    extras: {
      manualTargetName: 'Body',
      manualBodySignature: signature,
      manualFaces: [{ faceId: 23, index: 7, isPlanar: true, center: [10, -20, 3], normal: [0, 0, 1] }],
    },
  };
  const manifest: GeometryComponentManifest = {
    schemaVersion: 1,
    rootId: 'body',
    nodeOrder: ['body'],
    nodesById: { body: node },
    capabilities,
  };
  const commit = vi.fn<(next: ManualDocument) => Promise<boolean>>(async () => true);
  const witness: ManualFaceWitness = {
    available: true,
    document: { version: 1, operations: [] },
    commit,
    manifest,
    runtimeDocument: {},
    renderStamp: 'evaluation-a:request-a:mesh-a',
    artifactKey: 'mesh-a',
  };
  return { witness, commit, node };
}

describe('manual planar face bridge', () => {
  it('should freeze and persist paired replay provenance and exact native face geometry', async () => {
    const { witness, node, commit } = fixture();
    const descriptor = structuredClone(geometry);
    node.extras = {
      ...node.extras,
      manualReplayWitness: replayWitness,
      manualFaces: [
        { faceId: 23, index: 7, isPlanar: true, center: [10, -20, 3], normal: [0, 0, 1], geometry: descriptor },
      ],
    };
    const draft = createManualFaceDraft(witness, pick)!;
    descriptor.bounds.min[0] = -999;
    descriptor.normal[2] = -1;
    expect(await draft.apply(5, witness)).toBeUndefined();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0].operations[0]).toMatchObject({
      type: 'faceExtrude',
      face: { index: 7, bodySignature: signature, point: [10, -20, 3], replayWitness, geometry },
    });
  });

  it('should refuse partial or malformed replay metadata instead of degrading its correspondence guard', () => {
    const { witness, node, commit } = fixture();
    node.extras = { ...node.extras, manualReplayWitness: replayWitness };
    expect(createManualFaceDraft(witness, pick)).toBeUndefined();
    node.extras = {
      manualTargetName: 'Body',
      manualBodySignature: signature,
      manualFaces: [{ faceId: 23, index: 7, isPlanar: true, center: [10, -20, 3], normal: [0, 0, 1], geometry }],
    };
    expect(createManualFaceDraft(witness, pick)).toBeUndefined();
    node.extras = { ...node.extras, manualReplayWitness: 'malformed' };
    expect(createManualFaceDraft(witness, pick)).toBeUndefined();
    node.extras = {
      ...node.extras,
      manualReplayWitness: replayWitness,
      manualFaces: [
        {
          faceId: 23,
          index: 7,
          isPlanar: true,
          center: [10, -20, 3],
          normal: [0, 0, 1],
          geometry: { ...geometry, area: -1 },
        },
      ],
    };
    expect(createManualFaceDraft(witness, pick)).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });

  it('should convert model metres to native millimetres and map the occurrence to its native face', async () => {
    const { witness, commit } = fixture();
    const draft = createManualFaceDraft(witness, pick)!;
    expect(draft.selection).toMatchObject({ anchor: [0.01, -0.02, 0.003], normal: [0, 0, 1] });
    expect(commit).not.toHaveBeenCalled();
    expect(await draft.apply(-12, witness)).toBeUndefined();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      version: 1,
      operations: [
        {
          type: 'faceExtrude',
          target: { name: 'Body' },
          face: { index: 7, bodySignature: signature, point: [10, -20, 3] },
          distance: -12,
        },
      ],
    });
  });

  it('should allow only one write when pointer completion repeats while persistence is pending', async () => {
    const { witness, commit } = fixture();
    const pending = Promise.withResolvers<boolean>();
    commit.mockReturnValue(pending.promise);
    const draft = createManualFaceDraft(witness, pick)!;
    const first = draft.apply(10, witness);
    expect(await draft.apply(20, witness)).toBe('faceStale');
    expect(commit).toHaveBeenCalledOnce();
    pending.resolve(true);
    expect(await first).toBeUndefined();
  });

  it('should refuse stale source, sidecar, render, metadata and closed tool witnesses without writing', async () => {
    const { witness, commit } = fixture();
    const changes: Array<Partial<ManualFaceWitness>> = [
      { available: false },
      { document: { version: 1, operations: [] } },
      { runtimeDocument: {} },
      { renderStamp: 'new-evaluation' },
      { artifactKey: 'new-mesh' },
      { manifest: mock<GeometryComponentManifest>() },
      { commit: async () => true },
    ];
    for (const change of changes) {
      const draft = createManualFaceDraft(witness, pick)!;
      // oxlint-disable-next-line no-await-in-loop -- Every stale witness is an independent refusal.
      expect(await draft.apply(10, { ...witness, ...change })).toBe('faceStale');
    }
    expect(commit).not.toHaveBeenCalled();
  });

  it('should refuse unknown or curved faces, invalid normals and picks on an old artifact', () => {
    const { witness, node } = fixture();
    expect(createManualFaceDraft(witness, { ...pick, faceId: 7 })).toBeUndefined();
    expect(createManualFaceDraft(witness, { ...pick, artifactKey: 'old-mesh' })).toBeUndefined();
    node.extras = {
      ...node.extras,
      manualFaces: [{ faceId: 23, index: 7, isPlanar: false, center: [0, 0, 0], normal: [0, 0, 1] }],
    };
    expect(createManualFaceDraft(witness, pick)).toBeUndefined();
    expect(hasManualPlanarFaces(witness.manifest)).toBe(false);
    node.extras = {
      ...node.extras,
      manualFaces: [{ faceId: 23, index: 7, isPlanar: true, center: [0, 0, 0], normal: [0, 0, 0] }],
    };
    expect(createManualFaceDraft(witness, pick)).toBeUndefined();
  });

  it('should reject invalid distances without a write and expose a failed checked append', async () => {
    const { witness, commit } = fixture();
    const draft = createManualFaceDraft(witness, pick)!;
    expect(await draft.apply(0, witness)).toBe('faceInvalid');
    expect(await draft.apply(Number.NaN, witness)).toBe('faceInvalid');
    expect(commit).not.toHaveBeenCalled();
    commit.mockResolvedValue(false);
    expect(await draft.apply(1, witness)).toBe('faceCommitFailed');
    expect(commit).toHaveBeenCalledOnce();
  });

  it('should require exact persisted sidecar provenance before enabling a displayed artifact', () => {
    const revision = mock<SourceRevision>({ entry: 'main.ts', files: {} });
    Object.assign(revision.files, { 'main.ts.manual.json': 'sha256:abc' });
    const { files } = revision;
    expect(matchesManualSidecarRevision('sha256:abc', { entry: 'main.ts', files }, 'main.ts')).toBe(true);
    expect(matchesManualSidecarRevision('sha256:new', { entry: 'main.ts', files }, 'main.ts')).toBe(false);
    expect(matchesManualSidecarRevision('missing', { entry: 'main.ts', files: {} }, 'main.ts')).toBe(true);
    expect(matchesManualSidecarRevision('missing', { entry: 'main.ts', files }, 'main.ts')).toBe(false);
    expect(matchesManualSidecarRevision('missing', undefined, 'main.ts')).toBe(false);
  });
});
