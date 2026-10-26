import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { ChangeEventBus, MountTable, ProviderRegistry, ResourceQueue, WorkspaceFileService } from '@taucad/filesystem';
import type { FileContentService } from '@taucad/fs-client/file-content-service';
import { joinPath } from '@taucad/utils/path';
import { serializeManualDocument } from '@taucad/smlib/manual-operations';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import type { ParameterFilesClient, WorkbenchFilesClient, useFileManager } from '#hooks/use-file-manager.js';
import { useManualEdits } from '#hooks/use-manual-edits.js';

const selected = vi.hoisted(() => ({
  root: '/example/project-a',
  manager: vi.fn<() => ReturnType<typeof useFileManager>>(),
}));
vi.mock('#hooks/use-file-manager.js', () => ({ useOptionalFileManager: selected.manager }));
vi.mock('@xstate/react', () => ({ useSelector: () => selected.root }));

const moved = (distance: number): ManualDocument => ({
  version: 1,
  operations: [{ id: 'move-body', type: 'translate', target: { name: 'Body' }, delta: [distance, 0, 0] }],
});

/** Real checked filesystem mutations and exact-path watches behind the hook's app facades. */
async function createFilesystemFixture() {
  // JSDOM has no LockManager. Supply platform exclusion while keeping the
  // filesystem's checked-write comparison, queues and notifications real.
  const lockTails = new Map<string, Promise<void>>();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (name: string, _options: LockOptions, operation: () => Promise<unknown>) => {
        const previous = lockTails.get(name) ?? Promise.resolve();
        const settled = Promise.withResolvers<void>();
        lockTails.set(name, settled.promise);
        await previous;
        try {
          return await operation();
        } finally {
          settled.resolve();
        }
      },
    },
  });
  const registry = new ProviderRegistry();
  const provider = await registry.getProvider({ backend: 'memory', storageRootKey: 'memory:manual-edits' });
  const mounts = new MountTable();
  mounts.mount('/', provider, { class: 'authored', backend: 'memory', storageRootKey: 'memory:manual-edits' });
  const files = new WorkspaceFileService({
    providerRegistry: registry,
    resourceQueue: new ResourceQueue(),
    eventBus: new ChangeEventBus(),
    mountTable: mounts,
  });
  function readFile(path: string, encoding: 'utf8'): Promise<string>;
  function readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  async function readFile(path: string, encoding?: 'utf8'): Promise<string | Uint8Array<ArrayBuffer>> {
    const contents = await files.readFile(path, encoding);
    if (encoding === 'utf8') {
      if (typeof contents !== 'string') {
        throw new TypeError('Expected UTF-8 contents');
      }
      return contents;
    }
    if (typeof contents === 'string') {
      throw new TypeError('Expected binary contents');
    }
    return contents;
  }
  const parameterFiles = mock<ParameterFilesClient>({
    exists: async (path) => files.exists(path),
    readFile,
    writeFileChecked: async (input) => files.writeFileChecked(input),
  });
  const workbenchFiles = mock<WorkbenchFilesClient>({
    deleteFileChecked: async (input) => files.deleteFileChecked(input),
  });
  const disposals = vi.fn();
  const selectProject = (root: string): void => {
    selected.root = root;
    const contentService = mock<FileContentService>({
      watchReady: (request, changed) => {
        const unsubscribe = files.watch(
          { ...request, paths: request.paths.map((path) => joinPath(root, path)) },
          changed,
        );
        return {
          ready: Promise.resolve(),
          closed: Promise.withResolvers<void>().promise,
          dispose: () => {
            disposals();
            unsubscribe();
          },
        };
      },
    });
    selected.manager.mockReturnValue(
      mock<ReturnType<typeof useFileManager>>({
        parameterFiles,
        workbenchFiles,
        contentService,
      }),
    );
  };
  await files.mkdir('/example/project-a', { recursive: true });
  await files.mkdir('/example/project-b', { recursive: true });
  selectProject('/example/project-a');
  return { files, selectProject, disposals };
}

describe('useManualEdits', () => {
  let fixture: Awaited<ReturnType<typeof createFilesystemFixture>>;

  beforeEach(async () => {
    selected.manager.mockReset();
    fixture = await createFilesystemFixture();
  });
  afterEach(() => {
    cleanup();
    fixture.files.dispose();
    vi.unstubAllGlobals();
  });

  it('should leave disabled geometry sources completely unobserved and unwritten', async () => {
    const manager = selected.manager();
    const exists = vi.spyOn(manager.parameterFiles, 'exists');
    const watch = vi.spyOn(manager.contentService!, 'watchReady');
    const { result, unmount } = renderHook(() => useManualEdits('drawing.svg', false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(exists).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    expect(await result.current.commit(moved(1))).toBe(false);
    unmount();
    expect(fixture.disposals).not.toHaveBeenCalled();
  });

  it('should save, undo and redo through checked files while preserving regenerated source', async () => {
    const source = '/example/project-a/main.ts';
    const sidecar = `${source}.manual.json`;
    await fixture.files.writeFile(source, 'original source');
    const { result, rerender, unmount } = renderHook(() => useManualEdits('main.ts'), { wrapper: StrictMode });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(await fixture.files.exists(sidecar)).toBe(false);
    const firstCommit = result.current.commit;
    rerender();
    expect(result.current.commit).toBe(firstCommit);
    let committed = false;
    await act(async () => {
      committed = await result.current.commit(moved(12));
    });
    expect(result.current.error).toBeUndefined();
    expect(committed).toBe(true);
    expect(await fixture.files.readFile(sidecar, 'utf8')).toBe(serializeManualDocument(moved(12)));
    await act(async () => {
      await fixture.files.writeFile(source, 'regenerated source');
    });
    expect(result.current.document).toEqual(moved(12));
    expect(result.current.canUndo).toBe(true);
    await act(async () => {
      expect(await result.current.undo()).toBe(true);
    });
    expect(await fixture.files.exists(sidecar)).toBe(false);
    await act(async () => {
      expect(await result.current.redo()).toBe(true);
    });
    expect(await fixture.files.readFile(source, 'utf8')).toBe('regenerated source');
    const staleCommit = result.current.commit;
    unmount();
    expect(await staleCommit(moved(99))).toBe(false);
    expect(fixture.disposals).toHaveBeenCalledTimes(2);
  });

  it('should observe foreign sidecar writes and refuse the previous render callback', async () => {
    const { result } = renderHook(() => useManualEdits('main.ts'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await result.current.commit(moved(1));
    });
    const staleCommit = result.current.commit;
    await act(async () => {
      await fixture.files.writeFile('/example/project-a/main.ts.manual.json', serializeManualDocument(moved(20)));
    });
    await waitFor(() => {
      expect(result.current.document).toEqual(moved(20));
    });
    expect(result.current.canUndo).toBe(false);
    await act(async () => {
      expect(await staleCommit(moved(3))).toBe(false);
    });
    expect(result.current.error).toContain('partenza è cambiato');
    expect(result.current.document).toEqual(moved(20));
  });

  it('should scope drafts and watches to the selected source and project', async () => {
    const { result, rerender } = renderHook(({ entry }) => useManualEdits(entry), {
      initialProps: { entry: 'main.ts' },
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    const oldProjectCommit = result.current.commit;
    fixture.selectProject('/example/project-b');
    rerender({ entry: 'main.ts' });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(await oldProjectCommit(moved(5))).toBe(false);
    let committed = false;
    await act(async () => {
      committed = await result.current.commit(moved(9));
    });
    expect(result.current.error).toBeUndefined();
    expect(committed).toBe(true);
    expect(await fixture.files.exists('/example/project-a/main.ts.manual.json')).toBe(false);
    expect(await fixture.files.readFile('/example/project-b/main.ts.manual.json', 'utf8')).toBe(
      serializeManualDocument(moved(9)),
    );
    const oldSourceCommit = result.current.commit;
    rerender({ entry: 'other.ts' });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(await oldSourceCommit(moved(7))).toBe(false);
    expect(result.current.document).toEqual({ version: 1, operations: [] });
    expect(result.current.canUndo).toBe(false);
    expect(fixture.disposals).toHaveBeenCalledTimes(2);
  });
});
