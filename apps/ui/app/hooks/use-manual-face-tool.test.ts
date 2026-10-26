import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import type { ManualEdits } from '#hooks/use-manual-edits.js';
import { useManualFaceTool } from '#hooks/use-manual-face-tool.js';

vi.mock('#i18n/translate.js', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function fixture() {
  const commit = vi.fn<(next: ManualDocument) => Promise<boolean>>(async () => true);
  const edits = mock<ManualEdits>({
    document: { version: 1, operations: [] },
    commit,
    loading: false,
    saving: false,
    canUndo: false,
    canRedo: false,
    error: undefined,
  });
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
      manualFaces: [{ faceId: 23, index: 7, isPlanar: true, center: [10, 20, 30], normal: [0, 0, 1] }],
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
    renderStamp: 'evaluation-a',
    artifactKey: 'mesh-a',
    ready: true,
    open: true,
  };
  const hook = renderHook(({ ready }) => useManualFaceTool({ ...options, ready }), { initialProps: { ready: true } });
  act(() => {
    hook.result.current.controls.onEnableChange(true);
  });
  act(() => {
    hook.result.current.tool?.onPick({
      componentId: 'body',
      faceId: 23,
      point: [0.01, 0.02, 0.03],
      artifactKey: 'mesh-a',
    });
  });
  return { ...hook, commit };
}

afterEach(cleanup);

describe('useManualFaceTool', () => {
  it('should hold a released drag as a preview and append one native millimetre operation only on Applica', async () => {
    const { result, commit } = fixture();
    expect(result.current.controls.selected).toMatchObject({ name: 'Body', faceIndex: 7, componentId: 'body' });
    // A picked face starts with nothing held: no ghost, nothing to apply.
    expect(result.current.controls.distance).toBe(0);
    expect(result.current.tool?.distance).toBe(0);
    const tool = result.current.tool!;
    act(() => {
      tool.onPreview(0.02 + 4e-6);
    });
    expect(result.current.controls.distance).toBe(20);
    expect(result.current.controls.isDragging).toBe(true);
    act(() => {
      tool.onCommit(0.02);
    });
    // The release holds the distance for the viewer's ghost and the next drag; nothing is written yet.
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.controls.isDragging).toBe(false);
    expect(result.current.tool?.distance).toBeCloseTo(0.02);
    expect(result.current.controls.selected).toBeDefined();
    await act(async () => {
      result.current.controls.onApply();
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]?.[0].operations[0]).toMatchObject({
      type: 'faceExtrude',
      distance: 20,
      face: { point: [10, 20, 30] },
    });
    expect(result.current.controls.selected).toBeUndefined();
  });

  it('should discard the held preview with the first Esc and drop the face with the second', () => {
    const { result, commit } = fixture();
    act(() => {
      result.current.controls.onDistanceChange(-1.5);
    });
    expect(result.current.tool?.distance).toBeCloseTo(-0.0015);
    act(() => {
      result.current.controls.onCancel();
    });
    expect(result.current.controls.distance).toBe(0);
    expect(result.current.controls.selected).toBeDefined();
    act(() => {
      result.current.controls.onCancel();
    });
    expect(result.current.controls.selected).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });

  it('should preview a hole at the picked point and append the existing hole operation along the inward normal', async () => {
    const { result, commit } = fixture();
    act(() => {
      result.current.controls.onActionChange?.('hole');
    });
    act(() => {
      result.current.controls.onHoleChange?.({ diameter: 1.5, depth: 3, through: false });
    });
    expect(result.current.tool?.hole).toEqual({ radius: 7.5e-4, depth: 0.003 });
    expect(result.current.tool?.distance).toBeUndefined();
    await act(async () => {
      result.current.controls.onApply();
      await Promise.resolve();
    });
    expect(commit).toHaveBeenCalledOnce();
    const hole = commit.mock.calls[0]?.[0].operations[0];
    expect(hole).toMatchObject({ type: 'hole', target: { name: 'Body' }, diameter: 1.5, axis: [-0, -0, -1] });
    // It starts just outside the face so the cut always opens it, and reaches the asked depth below it.
    expect(hole?.type === 'hole' ? hole.center : undefined).toEqual([10, 20, 30.2]);
    expect(hole?.type === 'hole' ? hole.depth : undefined).toBeCloseTo(3.2);
  });

  it('should refuse a frozen completion callback after a newer evaluation starts', async () => {
    const { result, rerender, commit } = fixture();
    const tool = result.current.tool!;
    rerender({ ready: false });
    expect(result.current.tool).toBeUndefined();
    expect(result.current.controls.selected).toBeUndefined();
    await act(async () => {
      tool.onCommit(0.01);
      await Promise.resolve();
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.controls.error).toBe('manualEdit.faceStale');
  });

  it('should keep a newer selection when the old viewer gesture is cancelled', () => {
    const { result, commit } = fixture();
    const oldTool = result.current.tool!;
    act(() => {
      oldTool.onPick({ componentId: 'body', faceId: 23, point: [0.02, 0.02, 0.03], artifactKey: 'mesh-a' });
    });
    const newerSelection = result.current.tool?.selection;
    act(() => {
      oldTool.onCancel();
    });
    expect(result.current.tool?.selection).toBe(newerSelection);
    expect(commit).not.toHaveBeenCalled();
  });
});
