/* eslint-disable @typescript-eslint/naming-convention -- Fake Supabase HTTP rows retain their wire column names. */
import { z } from 'zod';
// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectToManifest, serializeProjectManifest } from '@taucad/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uint8ArrayToBase64 } from 'uint8array-extras';
import {
  archiveSinopiaRevision,
  patchSinopiaCadThumbnail,
  createSinopiaCadLink,
  inferSinopiaCadEngine,
  linkSinopiaCadModel,
  listSinopiaCadModels,
  sinopiaCadLinkIds,
  saveSinopiaCadRevision,
  sinopiaModelLocalProjectId,
  importSinopiaCadModel,
  ensureSinopiaCadModel,
  findSinopiaCadModelForPart,
  moveSinopiaCadModel,
  sinopiaCadSourceHint,
  withSinopiaCadSource,
  reconcileSinopiaCadLink,
} from '#services/sinopia-cad.js';
import type { SinopiaCadLink, SinopiaCadModel } from '#services/sinopia-cad.js';

const transport = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  client: undefined as SupabaseClient | undefined,
  active: true,
}));
const userId = '00000000-0000-4000-8000-000000000003';
vi.mock('#lib/sinopia-data-client.js', () => ({
  getSinopiaDataClient: async () => {
    if (!transport.active || transport.client === undefined) {
      throw new Error('SESSION');
    }
    return { client: transport.client, userId: '00000000-0000-4000-8000-000000000003' };
  },
  requireSinopiaUser: async (expected?: string) => {
    if (!transport.active || (expected !== undefined && expected !== '00000000-0000-4000-8000-000000000003')) {
      throw new Error('SESSION');
    }
    return { userId: '00000000-0000-4000-8000-000000000003', token: 'fake' };
  },
}));
const first = 'a'.repeat(40);
const second = 'b'.repeat(40);
const link: SinopiaCadLink = {
  modelId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  userId,
  baseRevisionId: null,
};
const model: SinopiaCadModel = {
  id: link.modelId,
  project_id: link.projectId,
  user_id: userId,
  name: 'Ring',
  engine: 'smlib',
  head_revision_id: null,
  snapshot_path: null,
  thumbnail_path: null,
  snapshot_bytes: null,
  updated_at: '2026-10-23T10:00:00Z',
};
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A write PostgREST acknowledges without a body. */
const noContent = (): Response => new Response(null, { status: 204 });
const requests = (): Array<{ url: string; method: string; body: unknown }> =>
  transport.fetch.mock.calls.map(([url, init]) => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    return {
      url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      method: init?.method ?? 'GET',
      body,
    };
  });
const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

beforeEach(() => {
  transport.fetch.mockReset();
  transport.active = true;
  // This client has no auth store and its HTTP transport is entirely fake. No request can leave the test.
  transport.client = createClient('https://sinopia.example.test', 'public-test-key', {
    accessToken: async () => 'fake',
    global: { fetch: transport.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
});

describe('Sinopia CAD persistence', () => {
  it('creates an owned accessories project with a separate UUID model identity', async () => {
    transport.fetch
      .mockResolvedValueOnce(json({ current_vertical: 'accessories' }))
      .mockResolvedValueOnce(json(null, 201));
    const result = await createSinopiaCadLink('Ring');
    expect(requests()[1]?.body).toMatchObject({ name: 'Ring', vertical: 'accessories', user_id: userId });
    expect(result.modelId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(result.projectId).not.toBe(result.modelId);
  });
  it('creates the project in the vertical the person is working in on Sinopia, so a heel is born in Calzature', async () => {
    transport.fetch
      .mockResolvedValueOnce(json({ current_vertical: 'footwear' }))
      .mockResolvedValueOnce(json(null, 201));
    await createSinopiaCadLink('Tacco');
    expect(requests()[0]?.url).toContain('/rest/v1/profiles');
    expect(requests()[0]?.url).toContain(`id=eq.${userId}`);
    expect(requests()[1]?.body).toMatchObject({ name: 'Tacco', vertical: 'footwear' });
  });
  it.each([
    { name: 'no vertical chosen yet', profile: json({ current_vertical: null }) },
    { name: 'an unknown vertical', profile: json({ current_vertical: 'spaceships' }) },
    { name: 'a profile that cannot be read', profile: json({ message: 'boom' }, 500) },
  ])('falls back to accessories with $name', async ({ profile }) => {
    transport.fetch.mockResolvedValueOnce(profile).mockResolvedValueOnce(json(null, 201));
    await createSinopiaCadLink('Ring');
    expect(requests()[1]?.body).toMatchObject({ vertical: 'accessories' });
  });
  it('reuses only a verified owned origin project and performs no project insert', async () => {
    transport.fetch.mockResolvedValueOnce(json({ id: link.projectId }));
    const created = await createSinopiaCadLink('Ring', link.projectId);
    expect(created.projectId).toBe(link.projectId);
    expect(requests()[0]?.url).toContain(`user_id=eq.${userId}`);
    expect(requests()[0]?.method).toBe('GET');
  });
  it('names one project and one model per account and local project, as RFC 9562 UUIDs', async () => {
    const ids = await sinopiaCadLinkIds(userId, 'proj_0123456789ABCDEFGHIJK');
    expect(await sinopiaCadLinkIds(userId, 'proj_0123456789ABCDEFGHIJK')).toEqual(ids);
    expect(z.uuid().parse(ids.projectId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(z.uuid().parse(ids.modelId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(ids.modelId).not.toBe(ids.projectId);
    expect(sinopiaModelLocalProjectId(ids.modelId)).toMatch(/^proj_[0-9A-Za-z]{21}$/u);
    const other = await sinopiaCadLinkIds(userId, 'proj_0123456789ABCDEFGHIJL');
    expect(other.projectId).not.toBe(ids.projectId);
    const otherAccount = await sinopiaCadLinkIds('00000000-0000-4000-8000-000000000009', 'proj_0123456789ABCDEFGHIJK');
    expect(otherAccount.projectId).not.toBe(ids.projectId);
  });
  it('verifies an earlier attempt’s named project instead of inserting a second one', async () => {
    const ids = await sinopiaCadLinkIds(userId, 'proj_0123456789ABCDEFGHIJK');
    transport.fetch
      .mockResolvedValueOnce(json({ current_vertical: 'accessories' }))
      .mockResolvedValueOnce(json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409))
      .mockResolvedValueOnce(json({ id: ids.projectId }));
    const created = await createSinopiaCadLink('Collana col ramo', undefined, ids);
    expect(created).toEqual({ ...ids, userId, baseRevisionId: null, projectCreatedByCad: true });
    expect(requests().map((request) => request.method)).toEqual(['GET', 'POST', 'GET']);
    expect(requests()[1]?.body).toMatchObject({ id: ids.projectId, name: 'Collana col ramo', vertical: 'accessories' });
    expect(requests()[2]?.url).toContain(`id=eq.${ids.projectId}`);
    expect(requests()[2]?.url).toContain(`user_id=eq.${userId}`);
    expect(requests()[2]?.url).toContain('deleted_at=is.null');
  });
  it('fails without a link when the named project is not this account’s', async () => {
    const ids = await sinopiaCadLinkIds(userId, 'proj_0123456789ABCDEFGHIJK');
    transport.fetch
      .mockResolvedValueOnce(json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409))
      .mockResolvedValueOnce(json({ code: 'PGRST116', message: 'no rows' }, 406));
    await expect(createSinopiaCadLink('Collana', undefined, ids)).rejects.toMatchObject({
      code: 'PGRST116',
    });
  });
  it('links a model made before the link existed once, through the new-model creation path', async () => {
    const stored = new Map<string, Uint8Array<ArrayBuffer>>();
    const files = {
      exists: vi.fn(async (path: string) => stored.has(path)),
      readFile: vi.fn(async (path: string) => stored.get(path)!),
      writeFile: vi.fn(async (path: string, content: string | Uint8Array<ArrayBuffer>) => {
        stored.set(path, typeof content === 'string' ? bytes(content) : content);
      }),
    };
    const localProjectId = 'proj_0123456789ABCDEFGHIJK';
    const ids = await sinopiaCadLinkIds(userId, localProjectId);
    let inserts = 0;
    transport.fetch.mockImplementation(async (_url, init) => {
      inserts += init?.method === 'POST' ? 1 : 0;
      // A slow insert lets the second caller reach the lock while the first is still creating.
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      return json(null, 201);
    });
    const input = { files, localProjectId, userId, name: 'Collana col ramo' };
    const [first, again] = await Promise.all([linkSinopiaCadModel(input), linkSinopiaCadModel(input)]);
    expect(first).toEqual({ ...ids, userId, baseRevisionId: null, projectCreatedByCad: true });
    expect(again).toEqual(first);
    expect(inserts).toBe(1);
    expect(requests().find((request) => request.method === 'POST')?.body).toMatchObject({
      id: ids.projectId,
      user_id: userId,
      name: 'Collana col ramo',
      vertical: 'accessories',
    });
    expect(files.writeFile).toHaveBeenCalledOnce();
    expect(files.writeFile.mock.calls[0]?.[0]).toBe(`/projects/${localProjectId}/.tau/sinopia.json`);
    // A later open (a remount, a retry, another tab) reads the persisted link and creates nothing.
    transport.fetch.mockClear();
    await expect(linkSinopiaCadModel(input)).resolves.toEqual(first);
    expect(transport.fetch).not.toHaveBeenCalled();
    // Another account's link is never replaced by a new identity.
    stored.set(
      `/projects/${localProjectId}/.tau/sinopia.json`,
      bytes(JSON.stringify({ ...first, userId: '00000000-0000-4000-8000-000000000009' })),
    );
    await expect(linkSinopiaCadModel(input)).rejects.toThrow('SINOPIA_OWNER_MISMATCH');
    expect(transport.fetch).not.toHaveBeenCalled();
  });
  it('lists owner-only active models without creating anything', async () => {
    transport.fetch.mockResolvedValueOnce(json([model]));
    expect(await listSinopiaCadModels()).toEqual([model]);
    expect(requests()[0]?.url).toContain(`user_id=eq.${userId}`);
    expect(requests()[0]?.url).toContain('deleted_at=is.null');
    expect(requests().every((request) => request.method === 'GET')).toBe(true);
  });
  it('uploads immutable save paths then uses a null-aware CAS', async () => {
    transport.fetch
      .mockResolvedValueOnce(json(model))
      .mockResolvedValueOnce(json({ Key: 'zip' }))
      .mockResolvedValueOnce(json([{ id: model.id }]));
    const result = await saveSinopiaCadRevision({
      link,
      revisionId: first,
      engine: 'smlib',
      name: 'Ring',
      snapshot: new Blob(['zip']),
    });
    expect(result.kind).toBe('saved');
    const upload = requests().find((request) => request.url.includes('/storage/'));
    expect(upload?.url).toContain(`/cad/${model.id}/saves/`);
    const update = requests().find((request) => request.method === 'PATCH');
    expect(update?.url).toContain('head_revision_id=is.null');
    expect(update?.body).toMatchObject({ head_revision_id: first, snapshot_bytes: 3 });
  });
  it('persists every source revision without recycling an older preview when the new rendering is unavailable', async () => {
    transport.fetch
      .mockResolvedValueOnce(
        json({ ...model, thumbnail_path: `projects/${link.projectId}/cad/${link.modelId}/old.webp` }),
      )
      .mockResolvedValueOnce(json({ Key: 'zip' }))
      .mockResolvedValueOnce(json([{ id: model.id }]));
    const result = await saveSinopiaCadRevision({
      link,
      revisionId: first,
      engine: 'smlib',
      name: 'Ring',
      snapshot: new Blob(['zip']),
    });
    expect(result.kind).toBe('saved');
    expect(requests().find((request) => request.method === 'PATCH')?.body).toMatchObject({
      thumbnail_path: null,
      head_revision_id: first,
    });
  });

  it('patches only the thumbnail after a matching late capture, without retransmitting the snapshot', async () => {
    transport.fetch
      .mockResolvedValueOnce(json({ ...model, head_revision_id: first }))
      .mockResolvedValueOnce(json({ Key: 'image' }))
      .mockResolvedValueOnce(json([{ id: model.id }]));
    const result = await patchSinopiaCadThumbnail({
      link: { ...link, baseRevisionId: first },
      revisionId: first,
      thumbnail: new Uint8Array([1]),
      isCurrent: () => true,
    });
    expect(result.kind).toBe('saved');
    const update = requests().find((request) => request.method === 'PATCH');
    expect(update?.url).toContain(`head_revision_id=eq.${first}`);
    const previewUpdate = z.object({ thumbnail_path: z.string() }).strict().parse(update?.body);
    expect(previewUpdate.thumbnail_path).toContain('/thumbnail.webp');
    expect(requests().some((request) => request.url.endsWith('/model.zip'))).toBe(false);
  });

  it('gives a project the CAD made its model’s preview as cover, never replacing a cover of its own', async () => {
    transport.fetch
      .mockResolvedValueOnce(json({ ...model, head_revision_id: first }))
      .mockResolvedValueOnce(json({ Key: 'image' }))
      .mockResolvedValueOnce(json([{ id: model.id }]))
      .mockResolvedValueOnce(json([{ id: link.projectId }]));
    await patchSinopiaCadThumbnail({
      link: { ...link, baseRevisionId: first },
      revisionId: first,
      thumbnail: new Uint8Array([1]),
      isCurrent: () => true,
    });
    const cover = requests().find((request) => request.method === 'PATCH' && request.url.includes('/rest/v1/projects'));
    // Sinopia's own convention: a public «assets» address its dashboard maps to the private bucket.
    expect(z.object({ thumbnail_url: z.string() }).strict().parse(cover?.body).thumbnail_url).toMatch(
      new RegExp(
        `/storage/v1/object/public/assets/projects/${link.projectId}/cad/${link.modelId}/saves/.+/thumbnail\\.webp$`,
        'u',
      ),
    );
    expect(decodeURIComponent(cover?.url ?? '')).toContain(`id=eq.${link.projectId}`);
    expect(decodeURIComponent(cover?.url ?? '')).toContain(`user_id=eq.${userId}`);
    expect(decodeURIComponent(cover?.url ?? '')).toContain('or=(thumbnail_url.is.null,thumbnail_url.like.*/cad/*)');
  });

  it('keeps the saved preview when the project cover cannot be written', async () => {
    transport.fetch
      .mockResolvedValueOnce(json({ ...model, head_revision_id: first }))
      .mockResolvedValueOnce(json({ Key: 'image' }))
      .mockResolvedValueOnce(json([{ id: model.id }]))
      .mockResolvedValueOnce(json({ message: 'denied' }, 403));
    const result = await patchSinopiaCadThumbnail({
      link: { ...link, baseRevisionId: first },
      revisionId: first,
      thumbnail: new Uint8Array([1]),
      isCurrent: () => true,
    });
    expect(result.kind).toBe('saved');
  });

  it('does not upload or patch a late preview after the remote head moved', async () => {
    transport.fetch.mockResolvedValueOnce(json({ ...model, head_revision_id: second }));
    const result = await patchSinopiaCadThumbnail({
      link,
      revisionId: first,
      thumbnail: new Uint8Array([1]),
      isCurrent: () => true,
    });
    expect(result.kind).toBe('conflict');
    expect(transport.fetch).toHaveBeenCalledOnce();
  });

  it('fences a late preview if the local capture scope changed while upload was pending', async () => {
    let current = true;
    transport.fetch
      .mockResolvedValueOnce(json({ ...model, head_revision_id: first }))
      .mockImplementationOnce(async () => {
        current = false;
        return json({ Key: 'image' });
      });
    await expect(
      patchSinopiaCadThumbnail({ link, revisionId: first, thumbnail: new Uint8Array([1]), isCurrent: () => current }),
    ).rejects.toThrow('superseded');
    expect(requests().some((request) => request.method === 'PATCH')).toBe(false);
  });

  it('never uploads after observing a different remote baseline', async () => {
    transport.fetch.mockResolvedValueOnce(json({ ...model, head_revision_id: second }));
    const saved = await saveSinopiaCadRevision({
      link,
      revisionId: first,
      engine: 'smlib',
      name: 'Ring',
      snapshot: new Blob(['zip']),
    });
    expect(saved.kind).toBe('conflict');
    expect(transport.fetch).toHaveBeenCalledOnce();
  });
  it('detects a race lost at CAS and leaves the winner’s immutable objects alone', async () => {
    transport.fetch
      .mockResolvedValueOnce(json(model))
      .mockResolvedValueOnce(json({ Key: 'zip' }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ ...model, head_revision_id: second }));
    const result = await saveSinopiaCadRevision({
      link,
      revisionId: first,
      engine: 'smlib',
      name: 'Ring',
      snapshot: new Blob(['zip']),
    });
    expect(result.kind).toBe('conflict');
    expect(requests().filter((request) => request.method === 'DELETE')).toHaveLength(0);
  });
  it('reconciles a lost save acknowledgement without reuploading or reporting its own head as conflict', async () => {
    transport.fetch.mockResolvedValueOnce(
      json({
        ...model,
        head_revision_id: first,
        snapshot_path: `projects/${link.projectId}/cad/${link.modelId}/saves/one/model.zip`,
      }),
    );
    const result = await saveSinopiaCadRevision({
      link,
      revisionId: first,
      engine: 'smlib',
      name: 'Ring',
      snapshot: new Blob(['zip']),
    });
    expect(result.kind).toBe('saved');
    expect(transport.fetch).toHaveBeenCalledOnce();
  });
  it('never updates a head after account change during upload', async () => {
    transport.fetch.mockResolvedValueOnce(json(model)).mockImplementationOnce(async () => {
      transport.active = false;
      return json({ Key: 'zip' });
    });
    await expect(
      saveSinopiaCadRevision({ link, revisionId: first, engine: 'smlib', name: 'Ring', snapshot: new Blob(['zip']) }),
    ).rejects.toThrow('SESSION');
    expect(requests().some((request) => request.method === 'PATCH')).toBe(false);
  });
  it('never updates a head after the project scope was disposed during upload', async () => {
    const abort = new AbortController();
    transport.fetch.mockResolvedValueOnce(json(model)).mockImplementationOnce(async () => {
      abort.abort();
      return json({ Key: 'zip' });
    });
    await expect(
      saveSinopiaCadRevision({
        link,
        revisionId: first,
        engine: 'smlib',
        name: 'Ring',
        snapshot: new Blob(['zip']),
        signal: abort.signal,
      }),
    ).rejects.toThrow();
    expect(requests().some((request) => request.method === 'PATCH')).toBe(false);
  });
  it.each([
    ["import { Pos } from '@classcad/smlibwasm';", 'smlib'],
    ["import { draw } from 'replicad';", 'replicad'],
    ["import { Manifold } from 'manifold';", 'manifold'],
    ["import { voxels } from '@taucad/picovoxel';", 'picovoxel'],
  ])('infers the engine from actual source %s', (source, expected) => {
    expect(inferSinopiaCadEngine(source)).toBe(expected);
  });
  it('maps UUID models losslessly to valid local project identities', () => {
    const id = sinopiaModelLocalProjectId(link.modelId);
    expect(id).toMatch(/^proj_[A-Za-z0-9]{21}$/u);
    expect(id).not.toBe(sinopiaModelLocalProjectId(link.projectId));
    expect(sinopiaModelLocalProjectId(link.modelId)).toBe(id);
  });
  it('archives only authored files from the immutable revision owner', async () => {
    const archive = await archiveSinopiaRevision({
      'main.ts': uint8ArrayToBase64(bytes('shape')),
      '.tau/sinopia.json': uint8ArrayToBase64(bytes('private')),
      'thumbnail.webp': uint8ArrayToBase64(bytes('generated')),
      '.tau/parameters/main.json': uint8ArrayToBase64(bytes('{}')),
    });
    const { default: Zip } = await import('jszip');
    const zip = await Zip.loadAsync(await archive.arrayBuffer());
    expect(Object.keys(zip.files)).toContain('main.ts');
    expect(Object.keys(zip.files)).toContain('.tau/parameters/main.json');
    expect(Object.keys(zip.files)).not.toContain('.tau/sinopia.json');
    expect(Object.keys(zip.files)).not.toContain('thumbnail.webp');
  });
  it('opens a private remote archive with its exact manifest, entry and link baseline', async () => {
    const { default: Zip } = await import('jszip');
    const zip = new Zip();
    zip.file(
      'tau.json',
      serializeProjectManifest(
        projectToManifest({
          name: 'Ring from Sinopia',
          description: '',
          tags: [],
          assets: { main: { entryPath: 'ring.ts' } },
        }),
      ),
    );
    zip.file('ring.ts', 'shape');
    const binary = await zip.generateAsync({ type: 'uint8array' });
    transport.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array(binary), { headers: { 'content-type': 'application/zip' } }),
    );
    const opened = await importSinopiaCadModel({
      ...model,
      head_revision_id: first,
      snapshot_path: `projects/${link.projectId}/cad/${link.modelId}/saves/one/model.zip`,
    });
    expect(opened.project.name).toBe('Ring from Sinopia');
    expect(opened.project.assets.main.entryPath).toBe('ring.ts');
    expect(opened.files['ring.ts']).toBeDefined();
    expect(opened.link.baseRevisionId).toBe(first);
    expect(opened.files['.tau/sinopia.json']).toBeDefined();
  });
  it('rejects traversal or nonauthor records before the project can be created', async () => {
    const { default: Zip } = await import('jszip');
    const zip = new Zip();
    zip.file('../escape.ts', 'shape');
    transport.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))),
    );
    await expect(
      importSinopiaCadModel({
        ...model,
        head_revision_id: first,
        snapshot_path: `projects/${link.projectId}/cad/${link.modelId}/saves/one/model.zip`,
      }),
    ).rejects.toThrow('SINOPIA_INVALID_ARCHIVE');
  });
});

describe('One Sinopia project per piece', () => {
  const asset = '00000000-0000-4000-8000-0000000000a1';
  const target = '00000000-0000-4000-8000-0000000000b2';
  /** Answer by address, like the server would: each test names only the calls it cares about. */
  const route = (handlers: Array<[RegExp, (method: string) => Response]>): void => {
    transport.fetch.mockImplementation(async (url, init) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const method = init?.method ?? 'GET';
      const handler = handlers.find(([pattern]) => pattern.test(`${method} ${decodeURIComponent(href)}`));
      return handler ? handler[1](method) : json({ message: 'unexpected' }, 500);
    });
  };

  it('links a piece started from a Sinopia part to THAT project, with its image and part, creating no project', async () => {
    transport.fetch.mockResolvedValueOnce(json({ id: link.projectId }));
    const created = withSinopiaCadSource(await createSinopiaCadLink('Cornice fibbia', link.projectId), {
      assetId: asset,
      partId: 'buckle_frame',
    });
    expect(created).toMatchObject({ projectId: link.projectId, sourceAssetId: asset, sourcePartId: 'buckle_frame' });
    expect(requests().some((request) => request.method === 'POST' && request.url.includes('/rest/v1/projects'))).toBe(
      false,
    );
  });

  it.each(['New Project', 'Untitled Project', '  '])(
    'never names a CAD-born Sinopia project %j: it becomes «Nuovo progetto»',
    async (name) => {
      transport.fetch
        .mockResolvedValueOnce(json({ current_vertical: 'accessories' }))
        .mockResolvedValueOnce(json(null, 201));
      await createSinopiaCadLink(name);
      expect(requests()[1]?.body).toMatchObject({ name: 'Nuovo progetto' });
    },
  );

  it('registers the model with its origin, and without it while the origin columns are not migrated yet', async () => {
    const linked = { ...link, sourceAssetId: asset, sourcePartId: 'buckle_frame' };
    let upserts = 0;
    let registered = false;
    route([
      [
        /cad_models/u,
        (method) => {
          if (method === 'POST') {
            upserts += 1;
            if (upserts === 1) {
              return json(
                { code: 'PGRST204', message: "Could not find the 'source_asset_id' column of 'cad_models'" },
                400,
              );
            }
            registered = true;
            return json(null, 201);
          }
          return json(registered ? model : null);
        },
      ],
    ]);
    await ensureSinopiaCadModel(linked, 'New Project', 'smlib');
    const posts = requests().filter((request) => request.method === 'POST');
    expect(posts[0]?.body).toMatchObject({
      source_asset_id: asset,
      source_part_id: 'buckle_frame',
      name: 'Modello CAD',
    });
    expect(posts[1]?.body).not.toHaveProperty('source_asset_id');
    expect(posts[1]?.body).toMatchObject({ project_id: link.projectId, name: 'Modello CAD' });
  });

  it('finds the model a part already became, owner-filtered, and answers «none» before the migration', async () => {
    transport.fetch.mockResolvedValueOnce(
      json({ id: model.id, name: 'Cornice fibbia', project_id: link.projectId, user_id: userId }),
    );
    const found = await findSinopiaCadModelForPart({
      projectId: link.projectId,
      assetId: asset,
      partId: 'buckle_frame',
    });
    expect(found).toEqual({ id: model.id, name: 'Cornice fibbia', projectId: link.projectId });
    const query = decodeURIComponent(requests()[0]?.url ?? '');
    expect(query).toContain(`user_id=eq.${userId}`);
    expect(query).toContain(`source_asset_id=eq.${asset}`);
    expect(query).toContain('source_part_id=eq.buckle_frame');
    expect(query).toContain('deleted_at=is.null');
    transport.fetch.mockResolvedValueOnce(
      json({ code: '42703', message: 'column cad_models.source_asset_id does not exist' }, 400),
    );
    expect(
      await findSinopiaCadModelForPart({ projectId: link.projectId, assetId: asset, partId: 'buckle_frame' }),
    ).toBeUndefined();
  });

  it('moves a never-saved model by rewriting only its link, after checking the target is the person’s', async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    });
    const files = { writeFile: vi.fn(async () => undefined) };
    route([
      [/GET .*\/rest\/v1\/projects/u, () => json({ id: target })],
      [/GET .*\/rest\/v1\/cad_models/u, () => json(null)],
    ]);
    const moved = await moveSinopiaCadModel({
      link,
      targetProjectId: target,
      files,
      localProjectId: 'proj_local',
      source: { assetId: asset, partId: 'buckle_frame' },
    });
    expect(moved).toMatchObject({ projectId: target, modelId: link.modelId, sourceAssetId: asset });
    const ownership = decodeURIComponent(requests()[0]?.url ?? '');
    expect(ownership).toContain(`id=eq.${target}`);
    expect(ownership).toContain(`user_id=eq.${userId}`);
    expect(requests().some((request) => request.method !== 'GET')).toBe(false);
    expect(files.writeFile).toHaveBeenCalledWith('/projects/proj_local/.tau/sinopia.json', expect.any(String));
    expect(sinopiaCadSourceHint.get({ userId, projectId: target, assetId: asset, partId: 'buckle_frame' })).toBe(
      link.modelId,
    );
    vi.unstubAllGlobals();
  });

  it('refuses a project that is not the person’s and touches nothing', async () => {
    const files = { writeFile: vi.fn(async () => undefined) };
    route([[/GET .*\/rest\/v1\/projects/u, () => json(null)]]);
    await expect(moveSinopiaCadModel({ link, targetProjectId: target, files, localProjectId: 'p' })).rejects.toThrow(
      'SINOPIA_PROJECT_UNAVAILABLE',
    );
    expect(requests().every((request) => request.method === 'GET')).toBe(true);
    expect(files.writeFile).not.toHaveBeenCalled();
  });

  it('moves a saved model: copies its files, moves the row in one guarded update, then its sent versions', async () => {
    const from = `projects/${link.projectId}/cad/${link.modelId}`;
    const to = `projects/${target}/cad/${link.modelId}`;
    const saved = {
      ...model,
      head_revision_id: first,
      snapshot_path: `${from}/saves/s1/model.zip`,
      thumbnail_path: `${from}/saves/s1/thumbnail.webp`,
    };
    const files = { writeFile: vi.fn(async () => undefined) };
    route([
      [/GET .*\/rest\/v1\/projects/u, () => json({ id: target })],
      [/GET .*\/rest\/v1\/cad_models/u, () => json(saved)],
      [/POST .*\/storage\/v1\/object\/list/u, () => json([])],
      [/POST .*\/storage\/v1\/object\/copy/u, () => json({ Key: 'copied' })],
      [/PATCH .*\/rest\/v1\/cad_models/u, () => json([{ id: link.modelId }])],
      [
        /GET .*\/rest\/v1\/assets/u,
        () =>
          json([
            {
              id: '00000000-0000-4000-8000-0000000000c3',
              storage_path: `${from}/v1/x/model.glb`,
              metadata: {
                cad_model_id: link.modelId,
                thumbnail_path: `${from}/v1/x/preview.png`,
                files: [{ format: 'glb', storage_path: `${from}/v1/x/model.glb` }],
              },
            },
          ]),
      ],
      [/PATCH .*\/rest\/v1\/assets/u, () => noContent()],
      [/PATCH .*\/rest\/v1\/projects/u, () => noContent()],
    ]);
    // The folder walk: the model folder holds «saves/s1» and «v1/x»; each leaf holds files.
    const listing: Record<string, unknown[]> = {
      [from]: [
        { name: 'saves', id: null },
        { name: 'v1', id: null },
      ],
      [`${from}/saves`]: [{ name: 's1', id: null }],
      [`${from}/saves/s1`]: [
        { name: 'model.zip', id: 'f1' },
        { name: 'thumbnail.webp', id: 'f2' },
      ],
      [`${from}/v1`]: [{ name: 'x', id: null }],
      [`${from}/v1/x`]: [
        { name: 'model.glb', id: 'f3' },
        { name: 'preview.png', id: 'f4' },
      ],
    };
    const base = transport.fetch.getMockImplementation()!;
    transport.fetch.mockImplementation(async (url, init) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (href.includes('/storage/v1/object/list/')) {
        const { prefix } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { prefix: string };
        return json(listing[prefix] ?? []);
      }
      return base(url, init);
    });
    const moved = await moveSinopiaCadModel({ link, targetProjectId: target, files, localProjectId: 'p' });
    expect(moved.projectId).toBe(target);
    const copies = requests()
      .filter((request) => request.url.includes('/object/copy'))
      .map((request) => request.body as { sourceKey: string; destinationKey: string });
    expect(copies.map((copy) => copy.destinationKey).toSorted()).toEqual(
      [
        `${to}/saves/s1/model.zip`,
        `${to}/saves/s1/thumbnail.webp`,
        `${to}/v1/x/model.glb`,
        `${to}/v1/x/preview.png`,
      ].toSorted(),
    );
    const row = requests().find((request) => request.method === 'PATCH' && request.url.includes('/cad_models'));
    expect(row?.body).toMatchObject({
      project_id: target,
      snapshot_path: `${to}/saves/s1/model.zip`,
      thumbnail_path: `${to}/saves/s1/thumbnail.webp`,
    });
    // Compare-and-swap on the old project: a second tab's move cannot be overwritten.
    expect(decodeURIComponent(row?.url ?? '')).toContain(`project_id=eq.${link.projectId}`);
    const version = requests().find((request) => request.method === 'PATCH' && request.url.includes('/assets'));
    expect(version?.body).toMatchObject({
      project_id: target,
      storage_path: `${to}/v1/x/model.glb`,
      metadata: { thumbnail_path: `${to}/v1/x/preview.png`, files: [{ storage_path: `${to}/v1/x/model.glb` }] },
    });
    expect(requests().some((request) => request.method === 'DELETE')).toBe(false);
    // The covers follow: the old project forgets this model's preview, the new one takes it only without its own.
    const covers = requests().filter((request) => request.method === 'PATCH' && request.url.includes('/projects'));
    const old = covers.find((request) => decodeURIComponent(request.url).includes(`id=eq.${link.projectId}`));
    expect(old?.body).toEqual({ thumbnail_url: null });
    expect(decodeURIComponent(old?.url ?? '')).toContain(`thumbnail_url=like.%/cad/${link.modelId}/%`);
    const adopted = covers.find((request) => decodeURIComponent(request.url).includes(`id=eq.${target}`));
    expect(z.object({ thumbnail_url: z.string() }).parse(adopted?.body).thumbnail_url).toContain(
      `${to}/saves/s1/thumbnail.webp`,
    );
    expect(decodeURIComponent(adopted?.url ?? '')).toContain('or=(thumbnail_url.is.null,thumbnail_url.like.*/cad/*)');
  });

  it('stops at a version that cannot move, without writing the link, and resumes on the next try', async () => {
    const from = `projects/${link.projectId}/cad/${link.modelId}`;
    const files = { writeFile: vi.fn(async () => undefined) };
    let rowProject = link.projectId;
    let versionFails = true;
    route([
      [/GET .*\/rest\/v1\/projects/u, () => json({ id: target })],
      [/GET .*\/rest\/v1\/cad_models/u, () => json({ ...model, project_id: rowProject })],
      [/POST .*\/storage\/v1\/object\/list/u, () => json([])],
      [
        /PATCH .*\/rest\/v1\/cad_models/u,
        () => {
          rowProject = target;
          return json([{ id: link.modelId }]);
        },
      ],
      [
        /GET .*\/rest\/v1\/assets/u,
        () =>
          json([
            {
              id: '00000000-0000-4000-8000-0000000000c3',
              storage_path: `${from}/v1/x/model.glb`,
              metadata: { cad_model_id: link.modelId },
            },
          ]),
      ],
      [
        /PATCH .*\/rest\/v1\/assets/u,
        () => (versionFails ? json({ code: '57014', message: 'timeout' }, 500) : noContent()),
      ],
      [/PATCH .*\/rest\/v1\/projects/u, () => noContent()],
    ]);
    await expect(
      moveSinopiaCadModel({ link, targetProjectId: target, files, localProjectId: 'p' }),
    ).rejects.toBeTruthy();
    expect(files.writeFile).not.toHaveBeenCalled();
    expect(rowProject).toBe(target);
    // «Sposta» again: the row is already in the target, so only the versions and the link are left to do.
    transport.fetch.mockClear();
    versionFails = false;
    const moved = await moveSinopiaCadModel({ link, targetProjectId: target, files, localProjectId: 'p' });
    expect(moved.projectId).toBe(target);
    expect(requests().some((request) => request.method === 'PATCH' && request.url.includes('/cad_models'))).toBe(false);
    expect(requests().some((request) => request.method === 'PATCH' && request.url.includes('/assets'))).toBe(true);
    expect(files.writeFile).toHaveBeenCalledOnce();
  });

  it('repairs a local link whose model now lives in another project, and leaves a current one alone', async () => {
    const files = { writeFile: vi.fn(async () => undefined) };
    const stale = { ...link, sourceAssetId: asset, sourcePartId: 'buckle_frame', projectCreatedByCad: true };
    transport.fetch.mockResolvedValueOnce(json({ ...model, project_id: target }));
    const repaired = await reconcileSinopiaCadLink(files, '/projects/p', stale);
    expect(repaired).toEqual({ ...link, projectId: target });
    expect(decodeURIComponent(requests()[0]?.url ?? '')).not.toContain('project_id=');
    expect(files.writeFile).toHaveBeenCalledWith(
      '/projects/p/.tau/sinopia.json',
      JSON.stringify({ ...link, projectId: target }),
    );
    transport.fetch.mockResolvedValueOnce(json(model));
    expect(await reconcileSinopiaCadLink(files, '/projects/p', link)).toBe(link);
    expect(files.writeFile).toHaveBeenCalledOnce();
  });

  it('marks only a project the CAD created, and renames only that one, only from «Nuovo progetto»', async () => {
    transport.fetch
      .mockResolvedValueOnce(json({ current_vertical: 'accessories' }))
      .mockResolvedValueOnce(json(null, 201));
    expect(await createSinopiaCadLink('Nuovo progetto')).toMatchObject({ projectCreatedByCad: true });
    transport.fetch.mockReset();
    transport.fetch.mockResolvedValueOnce(json({ id: link.projectId }));
    expect(await createSinopiaCadLink('Fibbia', link.projectId)).not.toHaveProperty('projectCreatedByCad');

    const save = async (linked: SinopiaCadLink) => {
      transport.fetch.mockReset();
      transport.fetch
        .mockResolvedValueOnce(json(model))
        .mockResolvedValueOnce(json({ Key: 'zip' }))
        .mockResolvedValueOnce(json([{ id: model.id }]))
        .mockResolvedValueOnce(noContent());
      await saveSinopiaCadRevision({
        link: linked,
        revisionId: first,
        engine: 'smlib',
        name: 'Fibbia 30 mm',
        snapshot: new Blob(['zip']),
      });
      return requests().filter((request) => request.method === 'PATCH' && request.url.includes('/rest/v1/projects'));
    };
    // The project the person started from (with its generations) keeps its name, whatever it is.
    expect(await save(link)).toEqual([]);
    const renamed = await save({ ...link, projectCreatedByCad: true });
    expect(renamed[0]?.body).toEqual({ name: 'Fibbia 30 mm' });
    expect(new URL(renamed[0]?.url ?? 'https://x').searchParams.get('name')).toBe('eq.Nuovo progetto');
  });
});
