/**
 * The host half of the `tau mcp` viewer: which file a call shows, how a source
 * becomes a GLB, what the page may read, and what the loopback server admits.
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TauMcpViewerCallOptions } from '@taucad/mcp';
import type { TauViewerShowResult } from '@taucad/mcp/viewer-protocol';

import { createLocalMcpViewer } from '#mcp-viewer.js';
import type { LocalMcpViewer, LocalMcpViewerOptions } from '#mcp-viewer.js';

const page = { html: '<!doctype html><title>Tau viewer</title>', sha256: 'c'.repeat(64) };
const glb = Buffer.from('glTF-binary-bytes');
const sha = (bytes: Uint8Array<ArrayBuffer>): string => createHash('sha256').update(bytes).digest('hex');

const inline: TauMcpViewerCallOptions = { toolCallId: 'call-1', presentation: 'inline' };
const text: TauMcpViewerCallOptions = { toolCallId: 'call-2', presentation: 'text' };

let root: string;
let viewer: LocalMcpViewer;
let renderGlb: ReturnType<typeof vi.fn<LocalMcpViewerOptions['renderGlb']>>;

const shownModel = (result: unknown): TauViewerShowResult => {
  if (typeof result !== 'object' || result === null || !('model' in result)) {
    throw new Error(`Expected a shown model, got ${JSON.stringify(result)}`);
  }
  return result as TauViewerShowResult;
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tau-viewer-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'models'));
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(root, 'src', 'bracket.ts'), 'export default () => null;');
  await writeFile(join(root, 'src', 'bracket.test.ts'), '');
  await writeFile(join(root, 'models', 'part.glb'), glb);
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), '');
  await writeFile(join(root, 'tau.json'), JSON.stringify({ assets: { main: { entryPath: 'src/bracket.ts' } } }));
  renderGlb = vi.fn<LocalMcpViewerOptions['renderGlb']>(async ({ targetFile }) => {
    await mkdir(join(root, '.tau', 'artifacts'), { recursive: true });
    await writeFile(join(root, '.tau', 'artifacts', 'bracket.glb'), glb);
    return targetFile === 'src/bracket.ts'
      ? '.tau/artifacts/bracket.glb'
      : { errorCode: 'KERNEL_ERROR', message: 'Bad model.' };
  });
  viewer = createLocalMcpViewer({ page, rootOf: () => root, renderGlb });
});

afterEach(async () => {
  await viewer.close();
  await rm(root, { recursive: true, force: true });
});

describe('createLocalMcpViewer', () => {
  it('should show a GLB as it is, without rendering', async () => {
    const { model, viewerUrl } = shownModel(await viewer.show({ targetFile: 'models/part.glb' }, inline));

    expect(model).toEqual({
      id: expect.any(String) as unknown,
      title: 'part',
      path: 'models/part.glb',
      mimeType: 'model/gltf-binary',
      byteLength: glb.length,
      sha256: sha(glb),
    });
    expect(viewerUrl).toBeUndefined();
    expect(renderGlb).not.toHaveBeenCalled();
  });

  it('should render a CAD source to GLB through export_model', async () => {
    const { model } = shownModel(await viewer.show({ targetFile: 'src/bracket.ts' }, inline));

    expect(renderGlb).toHaveBeenCalledWith(expect.objectContaining({ root, targetFile: 'src/bracket.ts' }));
    expect(model).toMatchObject({ title: 'bracket', path: '.tau/artifacts/bracket.glb', sourceFile: 'src/bracket.ts' });
  });

  it('should show the main entry, then the model shown last, when no target is named', async () => {
    expect(shownModel(await viewer.show({}, inline)).model.sourceFile).toBe('src/bracket.ts');
    await viewer.show({ targetFile: 'models/part.glb' }, inline);
    expect(shownModel(await viewer.show({}, inline)).model.path).toBe('models/part.glb');
  });

  it('should refuse a path outside the project and a format the page cannot draw', async () => {
    expect(await viewer.show({ targetFile: '../secret.glb' }, inline)).toMatchObject({
      errorCode: 'PATH_OUTSIDE_PROJECT',
    });
    expect(await viewer.open({ path: '/etc/passwd' }, inline)).toMatchObject({ errorCode: 'PATH_OUTSIDE_PROJECT' });
    await writeFile(join(root, 'models', 'part.step'), 'ISO-10303-21;');
    renderGlb.mockResolvedValueOnce('models/part.step');
    expect(await viewer.open({ path: join(root, 'models', 'part.step') }, inline)).toMatchObject({
      errorCode: 'UNSUPPORTED_FORMAT',
    });
  });

  it('should pass a render failure through', async () => {
    await writeFile(join(root, 'src', 'broken.ts'), '');

    expect(await viewer.show({ targetFile: 'src/broken.ts' }, inline)).toEqual({
      errorCode: 'KERNEL_ERROR',
      message: 'Bad model.',
    });
  });

  it('should list renderable files with the main entry first, skipping tests and dependencies', async () => {
    expect(await viewer.browse(inline)).toEqual({
      files: [
        { path: 'src/bracket.ts', title: 'bracket' },
        { path: 'models/part.glb', title: 'part' },
      ],
    });
  });

  it('should read a shown model in ranges and refuse one that changed', async () => {
    const { model } = shownModel(await viewer.show({ targetFile: 'models/part.glb' }, inline));

    expect(await viewer.read({ modelId: model.id, offset: 5, length: 6 }, inline)).toEqual({
      offset: 5,
      byteLength: 6,
      totalBytes: glb.length,
      data: glb.subarray(5, 11).toString('base64'),
    });
    expect(await viewer.read({ modelId: 'unknown', offset: 0, length: 1 }, inline)).toMatchObject({
      errorCode: 'UNKNOWN_MODEL',
    });
    await writeFile(join(root, 'models', 'part.glb'), 'changed');
    expect(await viewer.read({ modelId: model.id, offset: 0, length: 1 }, inline)).toMatchObject({
      errorCode: 'MODEL_CHANGED',
    });
  });

  describe('loopback server', () => {
    const loopbackOf = (viewerUrl: string | undefined) => {
      const url = new URL(viewerUrl ?? '');
      return { origin: url.origin, token: url.hash.slice(1), modelId: url.searchParams.get('model') ?? '' };
    };

    it('should link a text host to a loopback page carrying its token in the fragment', async () => {
      const { viewerUrl, model } = shownModel(await viewer.show({ targetFile: 'models/part.glb' }, text));
      const { origin, token, modelId } = loopbackOf(viewerUrl);

      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(token.length).toBeGreaterThan(20);
      expect(modelId).toBe(model.id);
      const response = await fetch(`${origin}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(page.html);
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    });

    it('should answer tool calls only with the token', async () => {
      const { viewerUrl } = shownModel(await viewer.show({ targetFile: 'models/part.glb' }, text));
      const { origin, token, modelId } = loopbackOf(viewerUrl);
      const call = async (headers: Record<string, string>) =>
        fetch(`${origin}/api/tools/call`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ name: 'app_read', arguments: { modelId, offset: 0, length: 4 } }),
        });

      const missing = await call({});
      const wrong = await call({ 'x-tau-viewer-token': 'wrong' });
      expect(missing.status).toBe(403);
      expect(wrong.status).toBe(403);
      const allowed = await call({ 'x-tau-viewer-token': token });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({
        offset: 0,
        byteLength: 4,
        totalBytes: glb.length,
        data: glb.subarray(0, 4).toString('base64'),
      });
    });

    it('should hand the loopback page a shown model, with its selection, through app_sync and refuse malformed input', async () => {
      const { viewerUrl } = shownModel(await viewer.show({ targetFile: 'models/part.glb' }, text));
      const { origin, token } = loopbackOf(viewerUrl);
      const call = async (name: string, args: unknown) =>
        fetch(`${origin}/api/tools/call`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tau-viewer-token': token },
          body: JSON.stringify({ name, arguments: args }),
        });

      const held = call('app_sync', { pageId: 'loopback-page', version: 1, follow: true, wait: true });
      const next = shownModel(await viewer.show({ targetFile: 'models/part.glb', select: ['component:arm'] }, text));
      const synced = await held;
      expect(synced.status).toBe(200);
      expect(await synced.json()).toEqual({ version: 2, show: { ...next, select: ['component:arm'] } });
      const malformed = await call('app_sync', { pageId: 'p' });
      expect(malformed.status).toBe(400);
    });

    it('should refuse a request under another host name', async () => {
      const { viewerUrl } = shownModel(await viewer.show({ targetFile: 'models/part.glb' }, text));
      const { origin } = loopbackOf(viewerUrl);
      const { port } = new URL(origin);
      const { request } = await import('node:http');

      const status = await new Promise<number | undefined>((resolve, reject) => {
        request({ host: '127.0.0.1', port, path: '/', headers: { host: `attacker.example:${port}` } }, (response) => {
          response.resume();
          resolve(response.statusCode);
        })
          .on('error', reject)
          .end();
      });
      expect(status).toBe(421);
    });
  });
});
