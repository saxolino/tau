import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import type { ManualEdits } from '#hooks/use-manual-edits.js';
import { useManualDirectTool } from '#hooks/use-manual-direct-tool.js';

vi.mock('#i18n/translate.js', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
function fixture(
  mode: 'translate' | 'fillet' | 'default' = 'translate',
  onSelectPiece?: (componentId: string) => void,
) {
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
    onSelectPiece,
  };
  const hook = renderHook<ReturnType<typeof useManualDirectTool>, { ready: boolean; open?: boolean }>(
    ({ ready, open = true }: { ready: boolean; open?: boolean }) => useManualDirectTool({ ...options, ready, open }),
    { initialProps: { ready: true } },
  );
  if (mode !== 'default') {
    act(() => {
      hook.result.current.controls.onModeChange(mode);
    });
  }
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
  it('should preview the fillet reach on the picked edges at the typed size, without writing', () => {
    const { result, commit } = fixture('fillet');
    expect(result.current.tool?.edgeSize).toBeCloseTo(0.001);
    act(() => {
      result.current.controls.onSizeChange(0.5);
    });
    expect(result.current.tool?.edgeSize).toBeCloseTo(0.0005);
    act(() => {
      result.current.controls.onCancel();
    });
    // No edge left: no ghost.
    expect(result.current.tool?.edgeSize).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });

  it('should put the body handles on a piece chosen elsewhere and drop them when the selection clears', () => {
    const { result } = fixture('default');
    act(() => {
      result.current.controls.onCancel();
    });
    expect(result.current.tool?.selection).toBeUndefined();
    act(() => {
      result.current.controls.onSelectPiece?.('body');
    });
    expect(result.current.tool?.selection?.componentId).toBe('body');
    expect(result.current.controls.selected?.componentId).toBe('body');
    act(() => {
      result.current.controls.onSelectPiece?.(undefined);
    });
    expect(result.current.tool?.selection).toBeUndefined();
  });

  it('should make a picked piece, or the piece of a picked edge, the shared selection', () => {
    const onSelectPiece = vi.fn<(componentId: string) => void>();
    fixture('default', onSelectPiece);
    fixture('fillet', onSelectPiece);
    expect(onSelectPiece.mock.calls).toEqual([['body'], ['body']]);
  });

  it('should select a body immediately on opening and retain it through rotate and scale', async () => {
    const { result, commit } = fixture('default');
    const move = result.current.tool!;
    expect(move.mode).toBe('translate');
    expect(move.selection?.componentId).toBe('body');
    act(() => {
      result.current.controls.onModeChange('rotate');
    });
    expect(result.current.tool?.mode).toBe('rotate');
    expect(result.current.tool?.selection?.pivot).toEqual(move.selection?.pivot);
    act(() => {
      result.current.controls.onModeChange('scale');
    });
    expect(result.current.controls.selected?.name).toBe('Body');
    await act(async () => {
      move.onCommit({ type: 'translate', delta: [1, 0, 0] });
      await Promise.resolve();
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.controls.selected?.name).toBe('Body');
    await act(async () => {
      result.current.tool?.onCommit({ type: 'scale', origin: [0.005, 0.005, 0.005], factor: 1.5 });
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0].operations[0]).toMatchObject({
      type: 'scale',
      factor: 1.5,
      target: { name: 'Body' },
    });
  });
  it('should preserve selected native edges when switching from fillet to chamfer', async () => {
    const { result, commit } = fixture('fillet');
    act(() => {
      result.current.tool?.onPick({ componentId: 'body', point: [0, 0.01, 0], artifactKey: 'mesh-a', edgeId: 7 });
    });
    act(() => {
      result.current.controls.onModeChange('chamfer');
    });
    expect(result.current.tool?.selection?.edgeIds).toEqual([3, 7]);
    expect(result.current.controls.selected?.edgeCount).toBe(2);
    await act(async () => {
      result.current.controls.onApply();
      await Promise.resolve();
    });
    expect(commit.mock.calls[0]?.[0].operations[0]).toMatchObject({
      type: 'chamfer',
      edges: { kind: 'indices', indices: [10, 20] },
    });
  });
  it('should clear incompatible selections and never revive them after a stale evaluation', () => {
    const { result, rerender, commit } = fixture('default');
    act(() => {
      result.current.controls.onModeChange('fillet');
    });
    expect(result.current.controls.selected).toBeUndefined();
    act(() => {
      result.current.tool?.onPick({ componentId: 'body', point: [0, 0, 0], artifactKey: 'mesh-a' });
    });
    expect(result.current.controls.selected).toBeUndefined();
    act(() => {
      result.current.tool?.onPick({ componentId: 'body', point: [0, 0, 0], artifactKey: 'mesh-a', edgeId: 3 });
    });
    expect(result.current.controls.selected?.edgeCount).toBe(1);
    act(() => {
      result.current.controls.onModeChange('translate');
    });
    expect(result.current.controls.selected).toBeUndefined();
    act(() => {
      result.current.tool?.onPick({ componentId: 'body', point: [0, 0, 0], artifactKey: 'mesh-a' });
    });
    rerender({ ready: false });
    act(() => {
      result.current.controls.onModeChange('rotate');
    });
    rerender({ ready: true });
    expect(result.current.controls.selected).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });
  it('should reopen in body selection mode without reviving the previous selection', () => {
    const { result, rerender, commit } = fixture('fillet');
    rerender({ ready: true, open: false });
    expect(result.current.tool).toBeUndefined();
    rerender({ ready: true, open: true });
    expect(result.current.tool?.mode).toBe('translate');
    expect(result.current.tool?.selection).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });
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
