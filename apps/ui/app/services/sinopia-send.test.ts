import { describe, expect, it, vi } from 'vitest';
/* eslint-disable @typescript-eslint/naming-convention -- Fake PostgREST responses and exact persisted-row assertions preserve Supabase wire column names. */
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createExportFile } from '@taucad/types/constants';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';
import {
  createSinopiaSender,
  readSinopiaDeliveries,
  recordSinopiaDelivery,
  deliveryFileName,
  sameProjectThumbnail,
  selectedSinopiaFiles,
  SinopiaSendError,
} from '#services/sinopia-send.js';
import type { SinopiaSendFiles } from '#services/sinopia-send.js';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const projectId = '20000000-0000-4000-8000-000000000001';
const modelId = '30000000-0000-4000-8000-000000000001';
const deliveryId = '40000000-0000-4000-8000-000000000001';
const link: SinopiaCadLink = { modelId, projectId, userId: owner, baseRevisionId: null };
const prepared: SinopiaSendFiles = {
  step: { status: 'verified', files: [createExportFile('step', 'model', new Uint8Array([1, 2]))] },
  glb: { status: 'ready', files: [createExportFile('glb', 'model', new Uint8Array([3, 4]))] },
  photo: { status: 'ready', files: [createExportFile('png', 'preview', new Uint8Array([5, 6]))] },
  pdf: {
    status: 'ready',
    files: [{ name: 'Collana.pdf', bytes: new Uint8Array([37, 80, 68, 70]), mimeType: 'application/pdf' }],
  },
};
type Asset = {
  id: string;
  version_number: number;
  created_at: string;
  storage_path: string;
  user_id: string;
  project_id: string;
  metadata: { files: Array<{ storage_path: string }> };
};

/** A real Supabase query/storage client over an in-memory HTTP transport; no network or database. */
let fixtureSequence = 0;
function fixture() {
  const assets: Asset[] = [];
  const requests: Array<{ url: URL; method: string; headers: Headers; body: string }> = [];
  const uploaded = new Set<string>();
  const removed: string[] = [];
  let userId = owner;
  let insertFailure: { code: string; message: string } | undefined;
  let shouldLoseAcknowledgement = false;
  let uploadFailure = 0;
  let uploadCount = 0;
  let onUpload: (() => void) | undefined;
  let onCommit: (() => void) | undefined;
  const response = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = options?.method ?? 'GET';
    const body = typeof options?.body === 'string' ? options.body : '';
    requests.push({ url, method, headers: new Headers(options?.headers), body });
    if (url.pathname === '/rest/v1/projects') {
      return response([{ id: projectId, name: 'Collana' }]);
    }
    if (url.pathname === '/rest/v1/assets' && method === 'GET') {
      const requestedId = url.searchParams.get('id')?.slice(3);
      const rows = requestedId
        ? assets.filter((asset) => asset.id === requestedId)
        : [...assets].sort((a, b) => b.version_number - a.version_number).slice(0, 1);
      return response(rows);
    }
    if (url.pathname === '/rest/v1/assets' && method === 'POST') {
      if (insertFailure) {
        return response(insertFailure, 400);
      }
      const asset = z
        .object({
          id: z.string(),
          version_number: z.number(),
          created_at: z.string(),
          storage_path: z.string(),
          user_id: z.string(),
          project_id: z.string(),
          metadata: z.object({ files: z.array(z.object({ storage_path: z.string() })) }).loose(),
        })
        .loose()
        .parse(JSON.parse(body));
      if (assets.some((row) => row.id === asset.id || row.version_number === asset.version_number)) {
        return response({ code: '23505', message: 'duplicate key assets_cad_model_version_idx' }, 409);
      }
      assets.push(asset);
      onCommit?.();
      if (shouldLoseAcknowledgement) {
        return response({ message: 'Response unavailable' }, 503);
      }
      return new Response(null, { status: 201 });
    }
    if (url.pathname.startsWith('/storage/v1/object/creator-private/') && method === 'POST') {
      uploadCount++;
      if (uploadCount === uploadFailure) {
        return response({ message: 'Upload unavailable' }, 500);
      }
      const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/creator-private/'.length));
      uploaded.add(path);
      onUpload?.();
      return response({ Key: `creator-private/${path}` });
    }
    if (url.pathname === '/storage/v1/object/creator-private' && method === 'DELETE') {
      const parsed = z.object({ prefixes: z.array(z.string()) }).parse(JSON.parse(body));
      for (const path of parsed.prefixes) {
        removed.push(path);
        uploaded.delete(path);
      }
      return response([]);
    }
    throw new Error(`Unexpected fake request: ${method} ${url.pathname}`);
  };
  const client = createClient('https://sinopia.invalid', 'public-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `sinopia-send-test-${++fixtureSequence}`,
    },
    global: { fetch: fetcher },
  });
  const getClient = vi.fn(async () => ({ client, userId }));
  const sender = createSinopiaSender(getClient);
  const send = async (
    id = deliveryId,
    signal = new AbortController().signal,
    extra: Partial<Parameters<typeof sender.send>[0]> = {},
  ) =>
    sender.send({
      link,
      projectId,
      prepared,
      selected: ['step', 'glb', 'photo'],
      note: '  Marquise 12 × 5  ',
      deliveryId: id,
      signal,
      ...extra,
    });
  return {
    assets,
    requests,
    uploaded,
    removed,
    getClient,
    sender,
    send,
    failInsert: (error: { code: string; message: string }) => {
      insertFailure = error;
    },
    loseAck: () => {
      shouldLoseAcknowledgement = true;
    },
    failUpload: (count: number) => {
      uploadFailure = count;
    },
    switchOnUpload: () => {
      onUpload = () => {
        userId = other;
      };
    },
    switchUser: () => {
      userId = other;
    },
    onCommit: (handler: () => void) => {
      onCommit = handler;
    },
  };
}

describe('Sinopia delivery', () => {
  it('should carry each piece’s material, process and weight, the PDF sheet and a thumbnail (E3a)', async () => {
    const test = fixture();
    const thumbnail = `projects/${projectId}/cad/${modelId}/saves/abc/thumbnail.webp`;
    await test.send(deliveryId, new AbortController().signal, {
      selected: ['step', 'glb', 'pdf'],
      pieces: [
        {
          nome: 'Telaio fibbia',
          materiale: { chiave: 'ottone', nome: 'Ottone' },
          processo: 'tranciatura_lamiera',
          pesoGrammi: 12.3456,
          volumeMm3: 1452.38912,
        },
        { nome: 'Ardiglione', processo: 'cnc' },
      ],
      fallbackThumbnailPath: thumbnail,
    });
    // The row exactly as it was posted (the fake keeps only the columns it checks).
    const posted = test.requests.find(({ url, method }) => url.pathname === '/rest/v1/assets' && method === 'POST');
    const { metadata } = JSON.parse(posted!.body) as {
      metadata: Record<string, unknown> & { files: Array<Record<string, unknown>> };
    };
    expect(metadata['pezzi']).toEqual([
      {
        nome: 'Telaio fibbia',
        materiale: 'ottone',
        materiale_nome: 'Ottone',
        processo: 'tranciatura_lamiera',
        peso_g: 12.35,
        volume_mm3: 1452.389,
      },
      { nome: 'Ardiglione', processo: 'cnc' },
    ]);
    // No photo was sent: the model's own preview in the same project is the version's thumbnail.
    expect(metadata['thumbnail_path']).toBe(thumbnail);
    expect(metadata.files.map((entry) => [entry['format'], entry['mime_type']])).toEqual([
      ['step', 'application/step'],
      ['glb', 'model/gltf-binary'],
      ['pdf', 'application/pdf'],
    ]);
    expect([...test.uploaded].some((path) => path.endsWith('/tavola.pdf'))).toBe(true);
  });
  it('should never take a thumbnail from another project or model, and prefer the photo when sent', async () => {
    expect(sameProjectThumbnail(`projects/${projectId}/cad/${modelId}/t.webp`, projectId, modelId)).toBe(
      `projects/${projectId}/cad/${modelId}/t.webp`,
    );
    expect(sameProjectThumbnail(`projects/${projectId}/cad/other/t.webp`, projectId, modelId)).toBeUndefined();
    expect(sameProjectThumbnail(`projects/${projectId}/cad/${modelId}/../x.webp`, projectId, modelId)).toBeUndefined();
    expect(sameProjectThumbnail(undefined, projectId, modelId)).toBeUndefined();
    const test = fixture();
    await test.send(deliveryId, new AbortController().signal, {
      fallbackThumbnailPath: `projects/${projectId}/cad/${modelId}/t.webp`,
    });
    expect((test.assets[0]?.metadata as Record<string, unknown>)['thumbnail_path']).toMatch(/\/preview\.png$/u);
    expect(deliveryFileName('pdf')).toBe('tavola.pdf');
  });
  it('should upload selected verified files privately and persist actual asset columns with AI metadata', async () => {
    const test = fixture();
    const sent = await test.send();
    expect(sent).toMatchObject({ assetId: deliveryId, projectId, modelId, userId: owner, versionNumber: 1 });
    expect(test.uploaded.size).toBe(3);
    expect(test.assets[0]).toMatchObject({
      type: 'cad_model',
      project_id: projectId,
      user_id: owner,
      version_number: 1,
      storage_bucket: 'creator-private',
      public_url: null,
      size_bytes: 6,
      metadata: {
        cad_model_id: modelId,
        note: 'Marquise 12 × 5',
        ai_generated: true,
        aiAct: { label: 'ai-generated' },
      },
    });
    expect(test.assets[0]?.storage_path).toMatch(/\/v1\/[\da-f-]+\/model\.glb$/u);
    const uploads = test.requests.filter(
      (request) => request.url.pathname.startsWith('/storage/') && request.method === 'POST',
    );
    expect(uploads).toHaveLength(3);
    expect(uploads.every((request) => request.headers.get('x-upsert') === 'false')).toBe(true);
    for (const request of test.requests.filter(
      (request) => request.url.pathname === '/rest/v1/assets' && request.method === 'GET',
    )) {
      expect(request.url.searchParams.get('user_id')).toBe(`eq.${owner}`);
      expect(request.url.searchParams.get('project_id')).toBe(`eq.${projectId}`);
      expect(request.url.searchParams.get('metadata')).toContain(modelId);
    }
  });

  it('should preserve winner files and allocate a distinct number when two devices race', async () => {
    const test = fixture();
    const results = await Promise.all([test.send(), test.send('40000000-0000-4000-8000-000000000002')]);
    expect(results.map((result) => result.versionNumber).sort((left, right) => left - right)).toEqual([1, 2]);
    expect(test.assets).toHaveLength(2);
    const referenced = test.assets.flatMap((asset) => asset.metadata.files.map((file) => file.storage_path));
    expect(referenced).toHaveLength(6);
    expect(referenced.every((path) => test.uploaded.has(path))).toBe(true);
    expect(test.removed.every((path) => !referenced.includes(path))).toBe(true);
  });

  it('should reconcile a lost insert acknowledgement and repeat the same send without another version', async () => {
    const test = fixture();
    test.loseAck();
    const sent = await test.send();
    expect(await test.send()).toEqual(sent);
    expect(test.assets).toHaveLength(1);
    expect(
      test.requests.filter((request) => request.url.pathname === '/rest/v1/assets' && request.method === 'POST'),
    ).toHaveLength(1);
    expect(test.removed).toEqual([]);
  });

  it('should retain committed artifacts after abort and reconcile the durable send identity on retry', async () => {
    const test = fixture();
    const controller = new AbortController();
    test.onCommit(() => {
      controller.abort();
    });
    await expect(test.send(deliveryId, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(test.assets).toHaveLength(1);
    expect(test.uploaded.size).toBe(3);
    expect(test.removed).toEqual([]);
    const recovered = await test.send();
    expect(recovered).toMatchObject({ assetId: deliveryId, versionNumber: 1 });
    expect(test.assets).toHaveLength(1);
    expect(
      test.requests.filter((request) => request.url.pathname.startsWith('/storage/') && request.method === 'POST'),
    ).toHaveLength(3);
  });

  it('should report a missing type migration and remove only this failed delivery’s uploads', async () => {
    const test = fixture();
    test.failInsert({ code: '23514', message: 'new row violates check constraint "assets_type_check"' });
    await expect(test.send()).rejects.toMatchObject({ name: 'SinopiaSendError', problem: 'migration' });
    expect(test.removed).toHaveLength(3);
    expect(test.uploaded.size).toBe(0);
    expect(test.assets).toEqual([]);
  });

  it('should remove completed uploads after a later upload fails without creating an asset', async () => {
    const test = fixture();
    test.failUpload(2);
    await expect(test.send()).rejects.toMatchObject({ name: 'SinopiaSendError', problem: 'failed' });
    expect(test.removed).toHaveLength(1);
    expect(test.uploaded.size).toBe(0);
    expect(test.assets).toEqual([]);
  });

  it('should stop before reading or mutating when the admitted account no longer matches the link', async () => {
    const test = fixture();
    test.switchUser();
    await expect(test.send()).rejects.toMatchObject({ name: 'SinopiaSendError', problem: 'session' });
    expect(test.requests).toEqual([]);
  });

  it('should stop a delivery after an account switch during upload without using the new account for cleanup', async () => {
    const test = fixture();
    test.switchOnUpload();
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(test.send()).rejects.toMatchObject({ name: 'SinopiaSendError', problem: 'session' });
      expect(
        test.requests.filter((request) => request.url.pathname.startsWith('/storage/') && request.method === 'POST'),
      ).toHaveLength(1);
      expect(test.assets).toEqual([]);
      expect(test.removed).toEqual([]);
    } finally {
      diagnostic.mockRestore();
    }
  });

  it('should reject an unsupported requested STEP before uploading rather than silently omitting it', () => {
    expect(() =>
      selectedSinopiaFiles({ ...prepared, step: { status: 'needsFix', problem: 'independent' } }, ['step', 'glb']),
    ).toThrow(SinopiaSendError);
    expect(
      selectedSinopiaFiles({ ...prepared, step: { status: 'needsFix', problem: 'independent' } }, ['glb']),
    ).toEqual([{ format: 'glb', file: prepared.glb.files?.[0] }]);
    expect(() => selectedSinopiaFiles(prepared, [])).toThrow('Sinopia delivery: files');
  });

  it('should query only the admitted owner’s active destination projects', async () => {
    const test = fixture();
    expect(await test.sender.projects(owner)).toEqual([{ id: projectId, name: 'Collana' }]);
    const request = test.requests[0]!;
    expect(request.url.searchParams.get('user_id')).toBe(`eq.${owner}`);
    expect(request.url.searchParams.get('deleted_at')).toBe('is.null');
  });

  it('should write a delivery as a real immutable event and read it back without inventing a revision', async () => {
    const sent = await fixture().send();
    const stored = new Map<string, Uint8Array<ArrayBuffer>>();
    const writeFile = vi.fn(async (path: string, bytes: Uint8Array<ArrayBuffer>) => {
      stored.set(path, bytes);
    });
    await recordSinopiaDelivery({ writeFile }, 'local', sent);
    expect(writeFile.mock.calls[0]?.[0]).toBe(`/projects/local/.tau/sinopia-sent/${deliveryId}.json`);
    function readFile(path: string, encoding: 'utf8'): Promise<string>;
    function readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
    async function readFile(path: string, encoding?: 'utf8'): Promise<string | Uint8Array<ArrayBuffer>> {
      const bytes = stored.get(path);
      if (!bytes) {
        throw new Error('missing event');
      }
      return encoding === 'utf8' ? new TextDecoder().decode(bytes) : bytes;
    }
    const events = await readSinopiaDeliveries(
      { readFile, readdir: async () => [`${deliveryId}.json`, 'unrelated.txt'] },
      'local',
    );
    expect(events).toEqual([{ kind: 'sent', id: deliveryId, createdAt: sent.createdAt, versionNumber: 1 }]);
  });
});

/* eslint-enable @typescript-eslint/naming-convention -- End of the fake Supabase wire fixture and persisted-row assertions. */
