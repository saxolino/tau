// @vitest-environment node
/* eslint-disable @typescript-eslint/naming-convention -- Fake PostgREST responses must preserve Supabase wire column names; domain assertions use camelCase. */
import { mock } from 'vitest-mock-extended';
import { homeComposerScope, sinopiaComposerOriginPath } from '#db/home-composer-scope.js';
import type { AttachmentClient } from '#db/attachment-store.js';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadSinopiaReferenceImage,
  listSinopiaReferenceImages,
  listSinopiaReferenceProjects,
  mergeSinopiaReferenceSelections,
  prepareSinopiaReferenceSelection,
  rememberSinopiaReferenceOrigin,
  restoreSinopiaReferenceSelection,
  sinopiaImageLocation,
} from '#services/sinopia-references.js';

const admission = vi.hoisted(() => ({ userId: 'user-a' }));
const base = 'https://sinopia.test';
const requests: URL[] = [];
const data = new Map<string, unknown>();
const client = createClient(base, 'public-test-key', {
  accessToken: async () => 'user-jwt',
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      requests.push(url);
      if (url.pathname.includes('/storage/v1/object/')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-jwt');
        return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
      }
      const value = data.get(url.pathname) ?? [];
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    },
  },
});
vi.mock('#environment.config.js', () => ({ ENV: { SINOPIA_SUPABASE_URL: 'https://sinopia.test' } }));
vi.mock('#lib/sinopia-data-client.js', () => ({
  getSinopiaDataClient: async () => ({ client, userId: admission.userId }),
}));

beforeEach(() => {
  requests.length = 0;
  data.clear();
  admission.userId = 'user-a';
});
afterEach(() => {
  vi.restoreAllMocks();
});

const project = {
  id: 'project-a',
  user_id: 'user-a',
  name: 'Necklace',
  updated_at: '2026-10-23',
  canvas_thumbnail_url: null,
  thumbnail_url: null,
};
const image = {
  id: 'image-a',
  user_id: 'user-a',
  project_id: 'project-a',
  type: 'ai_render',
  storage_bucket: 'creator-private',
  storage_path: 'projects/project-a/render.png',
};

describe('Sinopia reference intake', () => {
  it('should use dashboard owner, deletion, Learn and Network filters and authenticated thumbnail references', async () => {
    data.set('/rest/v1/projects', [project, { ...project, id: 'foreign', user_id: 'user-b' }]);
    data.set('/rest/v1/rpc/get_my_project_thumbnails', [
      {
        project_id: 'project-a',
        thumbnail_url: `${base}/storage/v1/object/sign/creator-private/projects/project-a/cover.png?token=secret`,
      },
    ]);
    await expect(listSinopiaReferenceProjects()).resolves.toEqual([
      {
        id: 'project-a',
        userId: 'user-a',
        name: 'Necklace',
        updatedAt: '2026-10-23',
        imageCount: 0,
        thumbnail: { bucket: 'creator-private', path: 'projects/project-a/cover.png' },
      },
    ]);
    const query = requests[0]!.searchParams;
    expect(query.get('user_id')).toBe('eq.user-a');
    expect(query.get('deleted_at')).toBe('is.null');
    expect(query.get('metadata->>learn')).toBe('is.null');
    expect(query.get('or')).toBe('(metadata->>lavoro_network.is.null,metadata->>lavoro_network.neq.true)');
    expect(query.get('order')).toBe('updated_at.desc,id.asc');
    expect(query.get('limit')).toBe('500');
    expect(JSON.stringify(await listSinopiaReferenceProjects())).not.toContain('secret');
  });

  it('should keep only owned active project images and owned library pieces with dimensions', async () => {
    data.set('/rest/v1/projects', { id: 'project-a' });
    data.set('/rest/v1/assets', [
      image,
      { ...image, id: 'missing', storage_path: null },
      {
        ...image,
        id: 'canonical',
        storage_path: null,
        public_url: `${base}/storage/v1/object/authenticated/creator-private/projects/project-a/old.png`,
      },
      { ...image, id: 'foreign', user_id: 'user-b' },
      { ...image, id: 'escape', storage_path: 'projects/project-b/render.png' },
    ]);
    data.set('/rest/v1/library_components', [
      {
        id: 'clasp',
        user_id: 'user-a',
        name: 'Clasp',
        image_url: `${base}/storage/v1/object/public/library-components/user-a/piece.png`,
        width_mm: 10,
        height_mm: 4,
      },
      {
        id: 'foreign-path',
        user_id: 'user-a',
        name: 'Foreign image',
        image_url: `${base}/storage/v1/object/public/library-components/user-b/piece.png`,
        width_mm: 10,
        height_mm: 4,
      },
      {
        id: 'unrelated-bucket',
        user_id: 'user-a',
        name: 'Other bucket',
        image_url: `${base}/storage/v1/object/public/unrelated/user-a/piece.png`,
        width_mm: 10,
        height_mm: 4,
      },
    ]);
    const images = await listSinopiaReferenceImages('project-a');
    expect(
      images.map((item) => ({ id: item.id, kind: item.kind, width: item.widthMm, height: item.heightMm })),
    ).toEqual([
      { id: 'image-a', kind: 'render', width: undefined, height: undefined },
      { id: 'canonical', kind: 'render', width: undefined, height: undefined },
      { id: 'library-clasp', kind: 'library', width: 10, height: 4 },
    ]);
    const assetQuery = requests.find((url) => url.pathname.endsWith('/assets'))!.searchParams;
    expect(assetQuery.get('project_id')).toBe('eq.project-a');
    expect(assetQuery.get('user_id')).toBe('eq.user-a');
    expect(assetQuery.get('deleted_at')).toBe('is.null');
    expect(assetQuery.get('type')).toContain('approved_design');
    expect(requests.find((url) => url.pathname.endsWith('/library_components'))!.searchParams.get('user_id')).toBe(
      'eq.user-a',
    );
  });

  it('should refuse foreign projects before reading their assets', async () => {
    data.set('/rest/v1/projects', null);
    await expect(listSinopiaReferenceImages('foreign')).rejects.toThrow('Sinopia project unavailable');
    expect(requests).toHaveLength(1);
  });

  it('should refuse external URLs and path traversal without forwarding URL tokens', () => {
    expect(sinopiaImageLocation('https://elsewhere.test/picture.png')).toBeUndefined();
    expect(sinopiaImageLocation(`${base}/storage/v1/object/public/library/a%2F..%2Fsecret.png`)).toBeUndefined();
    expect(
      sinopiaImageLocation(`${base}/storage/v1/object/sign/creator-private/projects/p/a.png?token=private`),
    ).toEqual({ bucket: 'creator-private', path: 'projects/p/a.png' });
  });

  it('should download with the user JWT and reject a changed account before fetching', async () => {
    const reference = {
      userId: 'user-a',
      projectId: 'project-a',
      location: { bucket: 'creator-private', path: 'projects/project-a/render.png' },
    };
    const blob = await downloadSinopiaReferenceImage(reference);
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    admission.userId = 'user-b';
    await expect(downloadSinopiaReferenceImage(reference)).rejects.toThrow('Sinopia account changed');
    expect(requests).toHaveLength(1);
  });

  it('should preserve selected image bytes as references while dropping removed images and stale origins', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'sinopia-selected.png', { type: 'image/png' });
    const removed = new File([new Uint8Array([4])], 'sinopia-removed.png', { type: 'image/png' });
    const selection = { userId: 'user-a', projectId: 'project-a', files: [file, removed] };
    const attachments = [{ filename: file.name, mediaType: 'image/png' }];
    const prepared = await prepareSinopiaReferenceSelection(selection, attachments);
    expect(prepared.sinopiaProjectId).toBe('project-a');
    expect(prepared.files).toEqual({ 'riferimenti/sinopia-selected.png': { content: new Uint8Array([1, 2, 3]) } });
    await expect(prepareSinopiaReferenceSelection(selection, [])).resolves.toEqual({});
    admission.userId = 'user-b';
    await expect(prepareSinopiaReferenceSelection(selection, attachments)).rejects.toThrow('Sinopia account changed');
    expect(requests).toHaveLength(0);
  });
  it('should recover origin after a reload using the existing draft attachment owner and fence a different account', async () => {
    const filename = 'sinopia-12345678-abcd-1234-abcd-123456789abc.png';
    const bytes = new Uint8Array([1, 2, 3]);
    const saved = new Map<string, Uint8Array<ArrayBuffer>>();
    const files = mock<AttachmentClient>({
      exists: async (path) => saved.has(path),
      writeFile: async (path, value) => {
        saved.set(path, value);
      },
      readFile: async (path) => {
        const value = saved.get(path);
        if (!value) {
          throw new Error('missing');
        }
        return value;
      },
    });
    const file = new File([bytes], filename, { type: 'image/png' });
    await rememberSinopiaReferenceOrigin(files, { userId: 'user-a', projectId: 'project-a', files: [file] });
    const attachment = { hash: 'a'.repeat(64), mediaType: 'image/png', filename };
    saved.set(`/.tau/composers/new-project/attachments/${attachment.hash}.png`, bytes);
    const restored = await restoreSinopiaReferenceSelection(files, [attachment]);
    expect(restored?.projectId).toBe('project-a');
    expect(new Uint8Array(await restored!.files[0]!.arrayBuffer())).toEqual(bytes);
    await expect(restoreSinopiaReferenceSelection(files, [])).resolves.toBeUndefined();
    admission.userId = 'user-b';
    await expect(restoreSinopiaReferenceSelection(files, [attachment])).rejects.toThrow('Sinopia account changed');
  });
  it('should preserve both picks and library measures through creation while the latest chosen project owns the CAD', async () => {
    const first = new File([new Uint8Array([1])], 'sinopia-first.png', { type: 'image/png' });
    const second = new File([new Uint8Array([2])], 'sinopia-second.png', { type: 'image/png' });
    const previous = {
      userId: 'user-a',
      projectId: 'project-a',
      files: [first],
      measurements: [{ filename: first.name, widthMm: 12, heightMm: 4 }],
    };
    const attachments = [
      { filename: first.name, mediaType: 'image/png' },
      { filename: second.name, mediaType: 'image/png' },
    ];
    const combined = mergeSinopiaReferenceSelections(
      previous,
      { userId: 'user-a', projectId: 'project-a', files: [second] },
      attachments,
    );
    const prepared = await prepareSinopiaReferenceSelection(combined, attachments);
    expect(prepared.sinopiaProjectId).toBe('project-a');
    expect(prepared.files?.[`riferimenti/${first.name}`]?.content).toEqual(new Uint8Array([1]));
    expect(prepared.files?.[`riferimenti/${second.name}`]?.content).toEqual(new Uint8Array([2]));
    expect(JSON.parse(new TextDecoder().decode(prepared.files?.['riferimenti/misure.json']?.content))).toEqual(
      previous.measurements,
    );
    const switched = mergeSinopiaReferenceSelections(
      combined,
      { userId: 'user-a', projectId: 'project-b', files: [second] },
      attachments,
    );
    expect(switched.projectId).toBe('project-b');
    expect(switched.files.map((file) => file.name)).toEqual([first.name, second.name]);
    const removed = mergeSinopiaReferenceSelections(
      combined,
      { userId: 'user-a', projectId: 'project-b', files: [second] },
      [{ filename: second.name }],
    );
    expect(removed.files.map((file) => file.name)).toEqual([second.name]);
    expect(removed.measurements).toEqual([]);
  });
  it('should restore only the account-scoped origin and attachment source without reading another account’s sidecar', async () => {
    const filename = 'sinopia-12345678-abcd-1234-abcd-123456789abc.png';
    const saved = new Map<string, Uint8Array<ArrayBuffer>>();
    const reads: string[] = [];
    const files = mock<AttachmentClient>({
      exists: async (path) => saved.has(path),
      writeFile: async (path, value) => {
        saved.set(path, value);
      },
      readFile: async (path) => {
        reads.push(path);
        const value = saved.get(path);
        if (!value) {
          throw new Error('missing');
        }
        return value;
      },
    });
    const scopeA = homeComposerScope('user-a');
    const scopeB = homeComposerScope('user-b');
    const file = new File([new Uint8Array([7, 8])], filename, { type: 'image/png' });
    await rememberSinopiaReferenceOrigin(
      files,
      { userId: 'user-a', projectId: 'project-a', files: [file] },
      scopeA.attachmentDirectory,
    );
    const attachment = { hash: 'a'.repeat(64), mediaType: 'image/png', filename };
    saved.set(`${scopeA.attachmentDirectory}/${attachment.hash}.png`, new Uint8Array([7, 8]));
    expect(saved.has(sinopiaComposerOriginPath(scopeA.attachmentDirectory))).toBe(true);
    admission.userId = 'user-b';
    await expect(
      restoreSinopiaReferenceSelection(files, [attachment], scopeB.attachmentDirectory),
    ).resolves.toBeUndefined();
    expect(reads).toEqual([]);
    admission.userId = 'user-a';
    const restored = await restoreSinopiaReferenceSelection(files, [attachment], scopeA.attachmentDirectory);
    expect(restored?.projectId).toBe('project-a');
    expect(new Uint8Array(await restored!.files[0]!.arrayBuffer())).toEqual(new Uint8Array([7, 8]));
    expect(reads).toEqual([
      sinopiaComposerOriginPath(scopeA.attachmentDirectory),
      `${scopeA.attachmentDirectory}/${attachment.hash}.png`,
    ]);
  });
});
