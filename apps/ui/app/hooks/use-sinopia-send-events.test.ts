import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { WatchEvent } from '@taucad/filesystem';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useSinopiaSendEvents } from '#hooks/use-sinopia-send-events.js';

vi.mock('#hooks/use-file-manager.js', () => ({ useFileManager: vi.fn() }));
type Manager = ReturnType<typeof useFileManager>;
const eventId = '40000000-0000-4000-8000-000000000001';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function source() {
  const records = new Map<string, Uint8Array<ArrayBuffer>>();
  function readFile(path: string, encoding: 'utf8'): Promise<string>;
  function readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  async function readFile(path: string, encoding?: 'utf8'): Promise<string | Uint8Array<ArrayBuffer>> {
    const bytes = records.get(path);
    if (!bytes) {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }
    return encoding === 'utf8' ? new TextDecoder().decode(bytes) : bytes;
  }
  const readdir = vi.fn(async (path: string) =>
    [...records.keys()].filter((name) => name.startsWith(`${path}/`)).map((name) => name.slice(path.length + 1)),
  );
  const ready = Promise.withResolvers<void>();
  const dispose = vi.fn();
  const listeners = new Map<string, (event: WatchEvent) => void>();
  const manager = mock<Manager>({
    recordFiles: mock<Manager['recordFiles']>({ readFile, readdir }),
    watchRecordFile: vi.fn<Manager['watchRecordFile']>((path, listener) => {
      listeners.set(path, listener);
      return { ready: ready.promise, closed: Promise.withResolvers<void>().promise, dispose };
    }),
  });
  vi.mocked(useFileManager).mockReturnValue(manager);
  const put = (projectId: string, versionNumber: number): void => {
    const path = `/projects/${projectId}/.tau/sinopia-sent/${eventId}.json`;
    records.set(
      path,
      new TextEncoder().encode(JSON.stringify({ kind: 'sent', id: eventId, versionNumber, createdAt: 123 })),
    );
    listeners.get(`/projects/${projectId}/.tau/sinopia-sent`)?.({ type: 'change', path });
  };
  return { records, manager, readdir, ready, dispose, put };
}

describe('Sinopia delivery record observation', () => {
  it('should wait for registration, project stored deliveries and react to the record owner’s changes', async () => {
    const test = source();
    test.put('local', 2);
    const view = renderHook(() => useSinopiaSendEvents('local'));
    expect(test.readdir).not.toHaveBeenCalled();
    await act(async () => {
      test.ready.resolve();
    });
    await waitFor(() => {
      expect(view.result.current.events).toEqual([{ kind: 'sent', id: eventId, createdAt: 123, versionNumber: 2 }]);
    });
    await act(async () => {
      test.put('local', 3);
    });
    await waitFor(() => {
      expect(view.result.current.events[0]?.versionNumber).toBe(3);
    });
    view.unmount();
    expect(test.dispose).toHaveBeenCalledOnce();
  });

  it('should drop the previous project’s deliveries when the project identity changes', async () => {
    const test = source();
    test.put('first', 2);
    test.ready.resolve();
    const view = renderHook(({ projectId }) => useSinopiaSendEvents(projectId), {
      initialProps: { projectId: 'first' },
    });
    await waitFor(() => {
      expect(view.result.current.events[0]?.versionNumber).toBe(2);
    });
    view.rerender({ projectId: 'second' });
    expect(view.result.current.events).toEqual([]);
    await waitFor(() => {
      expect(test.readdir).toHaveBeenCalledWith('/projects/second/.tau/sinopia-sent');
    });
    view.unmount();
  });

  it('should expose a record read failure without inventing a delivery', async () => {
    const test = source();
    test.readdir.mockRejectedValue(new Error('record unavailable'));
    test.ready.resolve();
    const view = renderHook(() => useSinopiaSendEvents('local'));
    await waitFor(() => {
      expect(view.result.current.error).toBe('Error: record unavailable');
    });
    expect(view.result.current.events).toEqual([]);
    view.unmount();
  });
});
