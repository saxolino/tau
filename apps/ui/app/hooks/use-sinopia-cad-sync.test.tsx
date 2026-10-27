/* eslint-disable @typescript-eslint/naming-convention -- Fake Supabase model rows retain their wire names. */
import type * as SinopiaThumbnailModule from '#services/sinopia-cad-thumbnail.js';
// @vitest-environment jsdom
import type { SinopiaCadModel, SinopiaCadLink } from '#services/sinopia-cad.js';
import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSinopiaCadSync } from '#hooks/use-sinopia-cad-sync.js';

const fake = vi.hoisted(() => {
  const link: SinopiaCadLink = {
    modelId: '00000000-0000-4000-8000-000000000001',
    projectId: '00000000-0000-4000-8000-000000000002',
    userId: '00000000-0000-4000-8000-000000000003',
    baseRevisionId: null,
  };
  const status = {
    headRevisionId: 'a'.repeat(40),
    checkoutId: 'live',
    checkoutRoot: '/projects/proj_aaaaaaaaaaaaaaaaaaaaa',
    dirty: false,
    minting: false,
    attention: 0,
    restore: { busy: false, asking: false },
  };
  return {
    link,
    status,
    session: { status: 'signed-in', user: { id: link.userId } },
    fileManager: { recordFiles: { exists: vi.fn(async () => false) } },
    project: {
      projectId: 'proj_aaaaaaaaaaaaaaaaaaaaa',
      projectRef: { snapshot: { context: { project: { name: 'Ring' } } } },
      geometryUnits: new Map([['main.ts', { snapshot: { context: { activeKernelId: 'smlib' } } }]]),
      mainEntryPath: 'main.ts',
    },
    revision: { snapshot: vi.fn(async () => ({ 'main.ts': 'c2hhcGU=' })), status: () => status },
    persist: vi.fn(async () => undefined),
    stored: link as SinopiaCadLink | undefined,
    linkModel: vi.fn<(input: { localProjectId: string; userId: string; name: string }) => Promise<SinopiaCadLink>>(),
    save: vi.fn(),
    read: vi.fn<() => Promise<SinopiaCadModel | undefined>>(async () => undefined),
    /** The open-time check of the link against the row found by id + user (the model may have moved project). */
    reconcile: vi.fn<(files: unknown, root: string, link: SinopiaCadLink) => Promise<SinopiaCadLink>>(),
  };
});
vi.mock('@xstate/react', () => ({
  useSelector: (actor: { snapshot: unknown } | undefined, selector: (value: unknown) => unknown) =>
    selector(actor?.snapshot),
}));
vi.mock('#hooks/use-project.js', () => ({ useProject: () => fake.project }));
vi.mock('#hooks/use-file-manager.js', () => ({ useFileManager: () => fake.fileManager }));
vi.mock('#hooks/use-revision-status.js', () => ({
  useRevisionClient: () => fake.revision,
  useRevisionStatus: () => fake.status,
}));
vi.mock('#hooks/use-sinopia-session.js', () => ({ useSinopiaSession: () => fake.session }));
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => ({ getState: () => fake.session }) }));
vi.mock('#lib/sinopia-data-client.js', () => ({
  requireSinopiaUser: async () => ({ userId: fake.link.userId, token: 'fake' }),
}));
vi.mock('#services/sinopia-cad.js', () => ({
  readSinopiaCadLink: async () => fake.stored,
  writeSinopiaCadLink: fake.persist,
  linkSinopiaCadModel: fake.linkModel,
  sinopiaCadLocalId: { set: vi.fn() },
  getSinopiaCadModel: fake.read,
  reconcileSinopiaCadLink: fake.reconcile,
  saveSinopiaCadRevision: fake.save,
  patchSinopiaCadThumbnail: fake.save,
  inferSinopiaCadEngine: () => 'smlib',
  archiveSinopiaRevision: async () => new Blob(['zip']),
}));
vi.mock('#services/sinopia-cad-thumbnail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SinopiaThumbnailModule>()),
  readSinopiaCadThumbnail: async () => new Uint8Array([1]),
}));
vi.mock('#services/sinopia-cad-conflicts.js', () => ({ preserveSinopiaConflict: vi.fn() }));
vi.mock('#services/sinopia-cad-restore.js', () => ({ applySinopiaRemoteSnapshot: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  fake.persist.mockClear();
  fake.save.mockReset();
  fake.read.mockReset();
  fake.read.mockResolvedValue(undefined);
  fake.session.status = 'signed-in';
  fake.stored = fake.link;
  fake.linkModel.mockReset();
  fake.reconcile.mockReset();
  fake.reconcile.mockImplementation(async (_files, _root, link) => link);
  fake.link.baseRevisionId = null;
  delete fake.link.localRevisionId;
  fake.save.mockImplementation(async (input: { link: typeof fake.link; revisionId: string }) => ({
    kind: 'saved',
    link: { ...input.link, baseRevisionId: input.revisionId },
    at: 100,
  }));
});
afterEach(() => {
  vi.useRealTimers();
});
const flush = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('mounted Sinopia autosave lifecycle', () => {
  it('survives StrictMode cleanup/replay and does not loop after link cache acknowledgement', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </StrictMode>
    );
    const view = renderHook(() => useSinopiaCadSync(), { wrapper });
    await flush();
    await flush();
    await flush(2000);
    await flush();
    expect(fake.save).toHaveBeenCalledOnce();
    expect(fake.persist).toHaveBeenCalledOnce();
    await flush(10_000);
    expect(fake.save).toHaveBeenCalledOnce();
    expect(view.result.current.state.kind).toBe('saved');
    view.unmount();
    client.clear();
  });
  it('keeps the chosen local overwrite pending across acknowledgement-driven hook recreation', async () => {
    const remote: SinopiaCadModel = {
      id: fake.link.modelId,
      project_id: fake.link.projectId,
      user_id: fake.link.userId,
      name: 'Ring',
      engine: 'smlib',
      head_revision_id: 'b'.repeat(40),
      snapshot_path: 'remote',
      thumbnail_path: null,
      snapshot_bytes: 1,
      updated_at: '2026-10-23T10:00:00Z',
    };
    fake.link.baseRevisionId = fake.status.headRevisionId;
    fake.link.localRevisionId = fake.status.headRevisionId;
    fake.read.mockResolvedValue(remote);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useSinopiaCadSync(), { wrapper });
    await flush();
    await flush();
    expect(view.result.current.state.kind).toBe('conflict');
    await act(async () => {
      await view.result.current.resolve('local');
    });
    expect(fake.persist).not.toHaveBeenCalled();
    expect(view.result.current.state.kind).not.toBe('saved');
    fake.read.mockResolvedValue(undefined);
    await flush(2000);
    await flush();
    expect(fake.save).toHaveBeenCalledOnce();
    await flush(5000);
    expect(fake.save).toHaveBeenCalledOnce();
    view.unmount();
    client.clear();
  });

  it('autosaves under the repaired link when the model now lives in another Sinopia project', async () => {
    const moved = { ...fake.link, projectId: '00000000-0000-4000-8000-000000000009' };
    fake.reconcile.mockResolvedValue(moved);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useSinopiaCadSync(), { wrapper });
    await flush();
    await flush();
    expect(fake.reconcile).toHaveBeenCalledWith(
      fake.fileManager.recordFiles,
      `/projects/${fake.project.projectId}`,
      fake.link,
    );
    expect(view.result.current.link).toEqual(moved);
    await flush(2000);
    await flush();
    expect(fake.save).toHaveBeenCalledOnce();
    expect(fake.save).toHaveBeenCalledWith(expect.objectContaining({ link: moved }));
    expect(view.result.current.link?.projectId).toBe(moved.projectId);
    view.unmount();
    client.clear();
  });

  it('keeps the stored link, and its conflict protection, when the link check itself fails', async () => {
    fake.reconcile.mockRejectedValue(new Error('offline'));
    fake.link.baseRevisionId = fake.status.headRevisionId;
    fake.link.localRevisionId = fake.status.headRevisionId;
    fake.read.mockResolvedValue({
      id: fake.link.modelId,
      project_id: fake.link.projectId,
      user_id: fake.link.userId,
      name: 'Ring',
      engine: 'smlib',
      head_revision_id: 'b'.repeat(40),
      snapshot_path: 'remote',
      thumbnail_path: null,
      snapshot_bytes: 1,
      updated_at: '2026-10-23T10:00:00Z',
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useSinopiaCadSync(), { wrapper });
    await flush();
    await flush();
    expect(view.result.current.link).toEqual(fake.link);
    expect(view.result.current.state.kind).toBe('conflict');
    expect(fake.save).not.toHaveBeenCalled();
    view.unmount();
    client.clear();
  });

  it('disposes the debounce on unmount before the 2-second save', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useSinopiaCadSync(), { wrapper });
    await flush();
    await flush();
    view.unmount();
    await flush(3000);
    expect(fake.save).not.toHaveBeenCalled();
    client.clear();
  });
});

describe('a model made before the Sinopia link existed', () => {
  it('is linked once through StrictMode replay and re-renders, then autosaves under that link', async () => {
    fake.stored = undefined;
    let finish: (link: SinopiaCadLink) => void = () => undefined;
    fake.linkModel.mockImplementation(
      async () =>
        new Promise<SinopiaCadLink>((resolve) => {
          finish = resolve;
        }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </StrictMode>
    );
    const view = renderHook(() => useSinopiaCadSync(), { wrapper });
    await flush();
    await flush();
    expect(view.result.current.state.kind).toBe('linking');
    view.rerender();
    await flush();
    expect(fake.linkModel).toHaveBeenCalledOnce();
    expect(fake.linkModel).toHaveBeenCalledWith(
      expect.objectContaining({ localProjectId: fake.project.projectId, userId: fake.link.userId, name: 'Ring' }),
    );
    await act(async () => {
      finish({ ...fake.link });
    });
    await flush();
    await flush(2000);
    await flush();
    expect(view.result.current.link?.modelId).toBe(fake.link.modelId);
    // The first authored save registers the cad_models row, exactly as for a model created after the link.
    expect(fake.save).toHaveBeenCalledOnce();
    expect(view.result.current.state.kind).toBe('saved');
    expect(fake.linkModel).toHaveBeenCalledOnce();
    view.unmount();
    client.clear();
  });

  it('says in words that the project could not be created and retries only on «Riprova»', async () => {
    fake.stored = undefined;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.linkModel.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...fake.link });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useSinopiaCadSync(), { wrapper });
    await flush();
    await flush();
    expect(view.result.current.state.kind).toBe('linkFailed');
    await flush(60_000);
    expect(fake.linkModel).toHaveBeenCalledOnce();
    act(() => {
      view.result.current.retry();
    });
    await flush();
    await flush();
    expect(fake.linkModel).toHaveBeenCalledTimes(2);
    expect(view.result.current.link?.modelId).toBe(fake.link.modelId);
    expect(view.result.current.state.kind).not.toBe('linkFailed');
    quiet.mockRestore();
    view.unmount();
    client.clear();
  });
});
