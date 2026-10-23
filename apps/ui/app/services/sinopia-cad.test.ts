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
  listSinopiaCadModels,
  saveSinopiaCadRevision,
  sinopiaModelLocalProjectId,
  importSinopiaCadModel,
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
    transport.fetch.mockResolvedValueOnce(json(null, 201));
    const result = await createSinopiaCadLink('Ring');
    expect(requests()[0]?.body).toMatchObject({ name: 'Ring', vertical: 'accessories', user_id: userId });
    expect(result.modelId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(result.projectId).not.toBe(result.modelId);
  });
  it('reuses only a verified owned origin project and performs no project insert', async () => {
    transport.fetch.mockResolvedValueOnce(json({ id: link.projectId }));
    const created = await createSinopiaCadLink('Ring', link.projectId);
    expect(created.projectId).toBe(link.projectId);
    expect(requests()[0]?.url).toContain(`user_id=eq.${userId}`);
    expect(requests()[0]?.method).toBe('GET');
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
