/* eslint-disable @typescript-eslint/naming-convention -- Fake Supabase HTTP rows retain their wire column names. */
import type * as SinopiaCadModule from '#services/sinopia-cad.js';
// @vitest-environment jsdom
import { createProjectFixture } from '#lib/project.fixture.js';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectListItem } from '#types/project-library.types.js';
import { tauCloudIntent } from '#hooks/use-cloud-projects.js';
import type { CloudProject } from '#hooks/use-cloud-projects.js';

/**
 * *Open* on a Tau-Cloud-only library row (W18 DEF-2, charter D20): the project
 * is created under the remote's own id from the one stub materialize on
 * sign-in also uses, and the project-scoped worker connects after navigation.
 */

const held: ProjectListItem = {
  ...createProjectFixture({
    id: 'proj_aaaaaaaaaaaaaaaaaaaaa',
    name: 'Gearbox Alpha',
    description: '',
    tags: [],
    assets: { main: { entryPath: 'main.ts' } },
  }),
  lastActivityAt: 0,
  locator: { backend: 'indexeddb', storageRootKey: 'indexeddb:tau-', relativeDirectory: '/gearbox-alpha' },
  slugs: { workspaceSlug: 'home', projectSlug: 'gearbox-alpha' },
};

/* In this device's Trash: held, so *Open* must not try to create it again. */
const trashed: ProjectListItem = {
  ...held,
  ...createProjectFixture({ ...held, id: 'proj_ccccccccccccccccccccc', name: 'Old Hinge' }),
  slugs: { workspaceSlug: 'home', projectSlug: 'old-hinge' },
  deletedAt: 5,
};

const { mockCreateProject, mockToastInfo, useProjectsOptions, mockGetConfig } = vi.hoisted(() => ({
  mockCreateProject: vi.fn(),
  mockGetConfig: vi.fn(),
  mockToastInfo: vi.fn<(message: string, options: { action: { label: string; onClick: () => void } }) => void>(),
  useProjectsOptions: [] as unknown[],
}));
vi.mock('#filesystem/handle-store.js', () => ({ getProjectFileSystemConfig: mockGetConfig }));
vi.mock('#hooks/use-projects.js', () => ({
  useProjects: (options: unknown) => {
    useProjectsOptions.push(options);
    return { projects: [held, trashed] };
  },
}));
vi.mock('#components/ui/sonner.js', () => ({ toast: { info: mockToastInfo } }));
vi.mock('#hooks/use-project-manager.js', () => ({
  useProjectManager: () => ({ createProject: mockCreateProject, getProjects: async () => [] }),
}));

const remoteTransport = vi.hoisted(() => ({
  download: vi.fn(),
  readLink: vi.fn(),
  admit: vi.fn(async () => undefined),
}));
const whenServicesReady = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('#hooks/use-file-manager.js', () => ({ useFileManager: () => ({ recordFiles: {}, whenServicesReady }) }));
vi.mock('#lib/sinopia-data-client.js', () => ({ requireSinopiaUser: remoteTransport.admit }));
vi.mock('#services/sinopia-cad.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SinopiaCadModule>()),
  importSinopiaCadModel: remoteTransport.download,
  readSinopiaCadLink: remoteTransport.readLink,
}));

const { cloudProjectStub, useOpenCloudProject } = await import('#hooks/use-open-cloud-project.js');

const wrapper = ({ children }: { readonly children: ReactNode }): React.JSX.Element => (
  <MemoryRouter initialEntries={['/projects']}>{children}</MemoryRouter>
);

const renderOpen = () => renderHook(() => ({ open: useOpenCloudProject(), location: useLocation() }), { wrapper });

describe('useOpenCloudProject', () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    remoteTransport.download.mockReset();
    remoteTransport.readLink.mockReset();
    remoteTransport.admit.mockReset();
    remoteTransport.admit.mockResolvedValue(undefined);
    mockGetConfig.mockReset();
    mockToastInfo.mockReset();
    whenServicesReady.mockClear();
    mockCreateProject.mockResolvedValue({
      id: 'proj_bbbbbbbbbbbbbbbbbbbbb',
      slugs: { workspaceSlug: 'home', projectSlug: 'bracket-beta' },
    });
  });

  it('should create the project under the remote’s id from the shared stub and connect after navigation', async () => {
    const entry: CloudProject = { id: 'proj_bbbbbbbbbbbbbbbbbbbbb', name: 'Bracket Beta', role: 'owner' };
    const { result } = renderOpen();

    await act(async () => result.current.open(entry));

    expect(mockCreateProject).toHaveBeenCalledWith(cloudProjectStub(entry));
    expect(result.current.location.pathname).toBe('/w/home/bracket-beta');
    expect(result.current.location.search).toBe('');
    expect(tauCloudIntent.get(entry.id)).toBe('open');
    expect(result.current.location.state).toBeNull();
  });

  it.each(['present', 'unreadable'])('keeps a %s partial stub pending after creation fails', async (state) => {
    const entry: CloudProject = { id: 'partial-project', name: 'Partial', role: 'owner' };
    if (state === 'present') {
      mockGetConfig.mockResolvedValue({ backend: 'indexeddb' });
    } else {
      mockGetConfig.mockRejectedValue(new Error('storage unavailable'));
    }
    mockCreateProject.mockRejectedValue(new Error('quota'));
    const { result } = renderOpen();
    await act(async () => {
      await expect(result.current.open(entry)).rejects.toThrow('quota');
    });
    expect(tauCloudIntent.get(entry.id)).toBe('open');
    expect(result.current.location.pathname).toBe('/projects');
    tauCloudIntent.set(entry.id, undefined);
  });

  it('should navigate to a project this device already holds instead of creating it again', async () => {
    const { result } = renderOpen();

    await act(async () => result.current.open({ id: held.id, name: held.name, role: 'owner' }));

    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(result.current.location.pathname).toBe('/w/home/gearbox-alpha');
  });

  it('downloads a Sinopia model before creating its OPFS project, retaining its exact entry and baseline', async () => {
    const sinopia: SinopiaCadModule.SinopiaCadModel = {
      id: '00000000-0000-4000-8000-000000000001',
      project_id: '00000000-0000-4000-8000-000000000002',
      user_id: '00000000-0000-4000-8000-000000000003',
      name: 'Ring',
      engine: 'smlib',
      head_revision_id: 'a'.repeat(40),
      snapshot_path: 'immutable',
      thumbnail_path: null,
      snapshot_bytes: 1,
      updated_at: '2026-10-23T10:00:00Z',
    };
    const imported = {
      project: { name: 'Ring', description: '', tags: [], assets: { main: { entryPath: 'ring.ts' } } },
      files: { 'ring.ts': { content: new Uint8Array([1]) }, '.tau/sinopia.json': { content: new Uint8Array([2]) } },
    };
    remoteTransport.download.mockResolvedValue(imported);
    const entry: CloudProject = { id: 'proj_ddddddddddddddddddddd', name: 'Ring', role: 'owner', sinopia };
    const { result } = renderOpen();
    await act(async () => result.current.open(entry));
    expect(remoteTransport.download).toHaveBeenCalledWith(sinopia);
    expect(mockCreateProject).toHaveBeenCalledWith({
      id: entry.id,
      chat: false,
      project: imported.project,
      files: imported.files,
      location: { kind: 'home' },
    });
    expect(tauCloudIntent.get(entry.id)).toBeUndefined();
  });

  it('refuses a held project whose local record names another remote identity', async () => {
    const sinopia: SinopiaCadModule.SinopiaCadModel = {
      id: '00000000-0000-4000-8000-000000000001',
      project_id: '00000000-0000-4000-8000-000000000002',
      user_id: '00000000-0000-4000-8000-000000000003',
      name: 'Ring',
      engine: 'smlib',
      head_revision_id: 'a'.repeat(40),
      snapshot_path: 'immutable',
      thumbnail_path: null,
      snapshot_bytes: 1,
      updated_at: '2026-10-23T10:00:00Z',
    };
    remoteTransport.readLink.mockResolvedValue({ modelId: 'another', userId: sinopia.user_id });
    const { result } = renderOpen();
    await act(async () => {
      await expect(result.current.open({ id: held.id, name: 'Ring', role: 'owner', sinopia })).rejects.toThrow(
        'SINOPIA_MODEL_IDENTITY_MISMATCH',
      );
    });
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(remoteTransport.download).not.toHaveBeenCalled();
    expect(result.current.location.pathname).toBe('/projects');
  });

  it('reads a held model’s link record again once the file services are up before refusing it (a cold tab)', async () => {
    const sinopia: SinopiaCadModule.SinopiaCadModel = {
      id: '00000000-0000-4000-8000-000000000001',
      project_id: '00000000-0000-4000-8000-000000000002',
      user_id: '00000000-0000-4000-8000-000000000003',
      name: 'Ring',
      engine: 'smlib',
      head_revision_id: 'a'.repeat(40),
      snapshot_path: 'immutable',
      thumbnail_path: null,
      snapshot_bytes: 1,
      updated_at: '2026-10-23T10:00:00Z',
    };
    remoteTransport.readLink
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ modelId: sinopia.id, userId: sinopia.user_id });
    const { result } = renderOpen();
    await act(async () => result.current.open({ id: held.id, name: 'Ring', role: 'owner', sinopia }));
    expect(whenServicesReady).toHaveBeenCalledOnce();
    expect(remoteTransport.download).not.toHaveBeenCalled();
    expect(result.current.location.pathname).toBe('/w/home/gearbox-alpha');
  });

  it('should say a project in this device’s Trash is there, offering the Trash, rather than failing', async () => {
    const { result } = renderOpen();

    await act(async () => result.current.open({ id: trashed.id, name: 'Old Hinge', role: 'owner' }));

    expect(useProjectsOptions.at(-1)).toEqual({ includeDeleted: true });
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(result.current.location.pathname).toBe('/projects');
    expect(mockToastInfo).toHaveBeenCalledOnce();
    const [message, options] = mockToastInfo.mock.calls[0] ?? [];
    expect(message).toBe('Old Hinge is in Trash on this device');
    expect(options?.action.label).toBe('Show Trash');
    act(() => {
      mockToastInfo.mock.calls[0]?.[1].action.onClick();
    });

    expect(result.current.location.search).toBe('?trash=1');
  });
});

describe('cloudProjectStub', () => {
  it('should carry the remote’s id and name, no chat and no files', () => {
    expect(cloudProjectStub({ id: 'proj_bbbbbbbbbbbbbbbbbbbbb', name: 'Bracket Beta', role: 'owner' })).toEqual({
      id: 'proj_bbbbbbbbbbbbbbbbbbbbb',
      chat: false,
      deferInitialView: true,
      project: { name: 'Bracket Beta', description: '', tags: [], assets: { main: { entryPath: 'main.scad' } } },
      files: {},
    });
  });
});
