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
  it('should preview metres without writes and submit one native millimetre append at pointer completion', async () => {
    const { result, commit } = fixture();
    expect(result.current.controls.selected).toEqual({ name: 'Body', faceIndex: 7 });
    const tool = result.current.tool!;
    act(() => {
      tool.onPreview(0.02);
    });
    expect(result.current.controls.distance).toBe(20);
    expect(commit).not.toHaveBeenCalled();
    await act(async () => {
      tool.onCommit(0.02);
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
