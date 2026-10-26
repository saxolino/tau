import { describe, expect, it, vi } from 'vitest';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import type { ManualDocument, ManualEdgeGeometry } from '@taucad/smlib/manual-operations';
import type { DirectEditChange, DirectEditPick } from '@taucad/viewer/cad/direct-edit-tool';
import { createManualDirectDraft } from '#services/manual-direct-draft.js';
import type { ManualDirectWitness } from '#services/manual-direct-draft.js';

const geometry = (offset: number): ManualEdgeGeometry => ({
  kind: 'line',
  start: [0, offset, 0],
  end: [20, offset, 0],
  length: 20,
  bounds: { min: [0, offset, 0], max: [20, offset, 0] },
  adjacentFaceCount: 2,
  seam: false,
  closed: false,
});
const pick: DirectEditPick = { componentId: 'body', point: [0.01, 0.02, 0.003], artifactKey: 'mesh-a' };
function fixture(mode: ManualDirectWitness['mode'] = 'translate') {
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
      manualBodySignature: 'a'.repeat(64),
      manualReplayWitness: 'b'.repeat(64),
      manualBounds: { min: [0, -10, 0], max: [100, 20, 10] },
      manualEdges: [
        { edgeId: 5, index: 77, geometry: geometry(0) },
        { edgeId: 9, index: 88, geometry: geometry(10) },
      ],
    },
  };
  const manifest: GeometryComponentManifest = {
    schemaVersion: 1,
    rootId: 'body',
    nodeOrder: ['body'],
    nodesById: { body: node, other: { ...node, id: 'other' } },
    capabilities,
  };
  const commit = vi.fn<(next: ManualDocument) => Promise<boolean>>(async () => true);
  const witness: ManualDirectWitness = {
    mode,
    available: true,
    document: { version: 1, operations: [] },
    commit,
    manifest,
    runtimeDocument: {},
    renderStamp: 'render-a',
    artifactKey: 'mesh-a',
  };
  return { witness, commit, node };
}

describe('manual direct draft', () => {
  it.each([
    [
      { type: 'translate', delta: [0.01, -0.02, 0.003] },
      { type: 'translate', delta: [10, -20, 3] },
    ],
    [
      { type: 'rotate', axis: [0, 1, 0], origin: [0.01, 0.02, 0.03], angleRadians: Math.PI / 2 },
      { type: 'rotate', axis: [0, 1, 0], origin: [10, 20, 30], angle: 90 },
    ],
    [
      { type: 'scale', factor: 2, origin: [0.01, 0.02, 0.03] },
      { type: 'scale', factor: 2, origin: [10, 20, 30] },
    ],
  ] satisfies Array<[DirectEditChange, Record<string, unknown>]>)(
    'should convert native transform units for %j',
    async (change, expected) => {
      const { witness, commit } = fixture(change.type);
      const draft = createManualDirectDraft(witness, pick)!;
      expect(draft.selection.pivot).toEqual([0.05, 0.005, 0.005]);
      expect(commit).not.toHaveBeenCalled();
      expect(await draft.apply(change, witness)).toBeUndefined();
      expect(commit).toHaveBeenCalledOnce();
      expect(commit.mock.calls[0]?.[0].operations[0]).toMatchObject({ ...expected, target: { name: 'Body' } });
    },
  );

  it('should refuse stale document, render, artifact, source, mode and commit callbacks before writing', async () => {
    const { witness, commit } = fixture();
    const changes: Array<Partial<ManualDirectWitness>> = [
      { available: false },
      { document: { version: 1, operations: [] } },
      { runtimeDocument: {} },
      { renderStamp: 'new' },
      { artifactKey: 'new' },
      { mode: 'rotate' },
      { manifest: undefined },
      { commit: async () => true },
    ];
    for (const change of changes) {
      const draft = createManualDirectDraft(witness, pick)!;
      // oxlint-disable-next-line no-await-in-loop -- Each changed authority witness must independently refuse the gesture.
      expect(await draft.apply({ type: 'translate', delta: [0.01, 0, 0] }, { ...witness, ...change })).toBe(
        'directStale',
      );
    }
    expect(commit).not.toHaveBeenCalled();
  });

  it('should consume a gesture once while its checked append is pending', async () => {
    const { witness, commit } = fixture();
    const pending = Promise.withResolvers<boolean>();
    commit.mockReturnValue(pending.promise);
    const draft = createManualDirectDraft(witness, pick)!;
    const first = draft.apply({ type: 'translate', delta: [0.01, 0, 0] }, witness);
    expect(await draft.apply({ type: 'translate', delta: [0.02, 0, 0] }, witness)).toBe('directStale');
    expect(commit).toHaveBeenCalledOnce();
    pending.resolve(true);
    expect(await first).toBeUndefined();
  });

  it('should toggle occurrence edges in one body and persist matching native indices with immutable geometry', async () => {
    const { witness, commit, node } = fixture('fillet');
    const first = createManualDirectDraft(witness, { ...pick, edgeId: 5 })!;
    const both = createManualDirectDraft(witness, { ...pick, edgeId: 9 }, first)!;
    expect(both.selection.edgeIds).toEqual([5, 9]);
    expect(createManualDirectDraft(witness, { ...pick, componentId: 'other', edgeId: 9 }, both)).toBeUndefined();
    const remaining = createManualDirectDraft(witness, { ...pick, edgeId: 5 }, both)!;
    expect(remaining.selection.edgeIds).toEqual([9]);
    node.extras = {};
    expect(await remaining.apply({ type: 'fillet', size: 0.5 }, witness)).toBeUndefined();
    expect(commit.mock.calls[0]?.[0].operations[0]).toMatchObject({
      type: 'fillet',
      size: 0.5,
      edges: {
        kind: 'indices',
        indices: [88],
        bodySignature: 'a'.repeat(64),
        replayWitness: 'b'.repeat(64),
        geometries: [geometry(10)],
      },
    });
  });

  it('should refuse guessed native indices, missing replay data and invalid operation values', async () => {
    const { witness, node, commit } = fixture('chamfer');
    expect(createManualDirectDraft(witness, { ...pick, edgeId: 77 })).toBeUndefined();
    expect(createManualDirectDraft(witness, pick)).toBeUndefined();
    const draft = createManualDirectDraft(witness, { ...pick, edgeId: 5 })!;
    expect(await draft.apply({ type: 'chamfer', size: -1 }, witness)).toBe('directInvalid');
    expect(await draft.apply({ type: 'scale', factor: 2, origin: [0, 0, 0] }, witness)).toBe('directInvalid');
    node.extras = { ...node.extras, manualReplayWitness: 'invalid' };
    expect(createManualDirectDraft(witness, { ...pick, edgeId: 5 })).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });
});
