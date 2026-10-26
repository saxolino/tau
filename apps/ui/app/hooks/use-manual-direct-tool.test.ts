import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import type { ManualEdits } from '#hooks/use-manual-edits.js';
import { useManualDirectTool } from '#hooks/use-manual-direct-tool.js';

vi.mock('#i18n/translate.js', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
function fixture(mode: 'translate' | 'fillet' = 'translate') {
  const commit = vi.fn<(next: ManualDocument) => Promise<boolean>>(async () => true);
  const edits: ManualEdits = {
    document: { version: 1, operations: [] },
    contentDigest: 'missing',
    commit,
    loading: false,
    saving: false,
    error: undefined,
    canUndo: false,
    canRedo: false,
    undo: async () => false,
    redo: async () => false,
  };
  const capabilities = {
    canHide: true,
    canIsolate: true,
    canFocus: true,
    canAdjustOpacity: true,
    hasDrawings: false,
    hasPreciseTopology: true,
    exports: [],
  };
  const edge = (edgeId: number, index: number, offset: number) => ({
    edgeId,
    index,
    geometry: {
      kind: 'line',
      start: [0, offset, 0],
      end: [10, offset, 0],
      length: 10,
      bounds: { min: [0, offset, 0], max: [10, offset, 0] },
      adjacentFaceCount: 2,
      seam: false,
      closed: false,
    },
  });
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
      manualBounds: { min: [0, 0, 0], max: [10, 10, 10] },
      manualEdges: [edge(3, 10, 0), edge(7, 20, 10)],
    },
  };
  const manifest: GeometryComponentManifest = {
    schemaVersion: 1,
    rootId: 'body',
    nodeOrder: ['body'],
    nodesById: { body: node },
    capabilities,
  };
  const options = {
    edits,
    manifest,
    runtimeDocument: {},
    renderStamp: 'render-a',
    artifactKey: 'mesh-a',
    ready: true,
    open: true,
  };
  const hook = renderHook(({ ready }) => useManualDirectTool({ ...options, ready }), { initialProps: { ready: true } });
  act(() => {
    hook.result.current.controls.onModeChange(mode);
  });
  act(() => {
    hook.result.current.tool?.onPick({
      componentId: 'body',
      point: [0, 0, 0],
      artifactKey: 'mesh-a',
      edgeId: mode === 'fillet' ? 3 : undefined,
    });
  });
  return { ...hook, commit };
}
afterEach(cleanup);

describe('useManualDirectTool', () => {
  it('should preview without writes and append one transform on pointer release', async () => {
    const { result, commit } = fixture();
    const tool = result.current.tool!;
    act(() => {
      tool.onPreview({ type: 'translate', delta: [0.01, 0, 0] });
    });
    expect(result.current.controls.preview).toBe('manualEdit.directMovePreview');
    expect(commit).not.toHaveBeenCalled();
    await act(async () => {
      tool.onCommit({ type: 'translate', delta: [0.01, 0, 0] });
      tool.onCommit({ type: 'translate', delta: [0.02, 0, 0] });
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0].operations[0]).toMatchObject({ type: 'translate', delta: [10, 0, 0] });
  });
  it('should ignore an old viewer cancellation after another body selection', () => {
    const { result, commit } = fixture();
    const oldTool = result.current.tool!;
    act(() => {
      oldTool.onPick({ componentId: 'body', point: [0.001, 0, 0], artifactKey: 'mesh-a' });
    });
    const selection = result.current.tool?.selection;
    act(() => {
      oldTool.onCancel();
    });
    expect(result.current.tool?.selection).toBe(selection);
    expect(commit).not.toHaveBeenCalled();
  });
  it('should cancel selection on newer evaluation and refuse frozen transform completion', async () => {
    const { result, rerender, commit } = fixture();
    const tool = result.current.tool!;
    rerender({ ready: false });
    expect(result.current.tool).toBeUndefined();
    expect(result.current.controls.selected).toBeUndefined();
    await act(async () => {
      tool.onCommit({ type: 'translate', delta: [0.01, 0, 0] });
      await Promise.resolve();
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.controls.error).toBe('manualEdit.directStale');
  });
  it('should select multiple edges without writes and apply their chosen radius explicitly', async () => {
    const { result, commit } = fixture('fillet');
    act(() => {
      result.current.tool?.onPick({ componentId: 'body', point: [0, 0.01, 0], artifactKey: 'mesh-a', edgeId: 7 });
    });
    expect(result.current.tool?.selection?.edgeIds).toEqual([3, 7]);
    expect(commit).not.toHaveBeenCalled();
    act(() => {
      result.current.controls.onSizeChange(0.5);
    });
    await act(async () => {
      result.current.controls.onApply();
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0].operations[0]).toMatchObject({
      type: 'fillet',
      size: 0.5,
      edges: { kind: 'indices', indices: [10, 20] },
    });
  });
});
