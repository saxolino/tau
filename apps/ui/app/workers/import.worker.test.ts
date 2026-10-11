// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { ImportWorkerResponse } from '#workers/import.worker.js';

describe('ImportWorkerResponse types', () => {
  it('should accept valid downloadProgress response', () => {
    const response: ImportWorkerResponse = {
      type: 'downloadProgress',
      loaded: 100,
      total: 1000,
    };
    expect(response.type).toBe('downloadProgress');
  });

  it('should accept valid extractProgress response', () => {
    const response: ImportWorkerResponse = {
      type: 'extractProgress',
      processed: 5,
      total: 10,
    };
    expect(response.type).toBe('extractProgress');
  });

  it('should accept valid extractComplete response', () => {
    const response: ImportWorkerResponse = {
      type: 'extractComplete',
      filePaths: ['src/main.ts', 'package.json'],
      files: [
        { path: 'src/main.ts', content: new Uint8Array([1]) },
        { path: 'package.json', content: new Uint8Array([2]) },
      ],
    };
    expect(response.type).toBe('extractComplete');
    expect(response.filePaths).toHaveLength(2);
    expect(response.files).toHaveLength(2);
  });

  it('should accept valid error response with phase', () => {
    const response: ImportWorkerResponse = {
      type: 'error',
      message: 'Network error',
      phase: 'download',
    };
    expect(response.type).toBe('error');
    expect(response.phase).toBe('download');
  });
});

describe('downloadRefusal', () => {
  const load = async () => {
    vi.stubGlobal('addEventListener', vi.fn());
    const { downloadRefusal } = await import('#workers/import.worker.js');
    return downloadRefusal;
  };

  it.each([
    [
      'an API refusal',
      new Response(JSON.stringify({ error: 'Too many GitHub imports.', code: 'REPOSITORY_RATE_LIMITED' }), {
        status: 429,
      }),
      'Too many GitHub imports.',
    ],
    [
      "the archive gateway's sentence",
      new Response('The repository archive could not be fetched.', { status: 404 }),
      'The repository archive could not be fetched.',
    ],
    ['an empty body', new Response('', { status: 502, statusText: 'Bad Gateway' }), 'Download failed: 502 Bad Gateway'],
  ])('should say why for %s', async (_case, response, sentence) => {
    const downloadRefusal = await load();

    await expect(downloadRefusal(response)).resolves.toBe(sentence);
  });
});
