/* eslint-disable @typescript-eslint/naming-convention -- Fake Supabase HTTP rows retain their wire column names. */
import type { SinopiaCadModel } from '#services/sinopia-cad.js';
// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCloudProjectPreview, useCloudProjectPreview } from '#hooks/use-cloud-project-preview.js';

const session = vi.hoisted(() => ({ id: 'account-one' as string | undefined, sinopia: false, download: vi.fn() }));
vi.mock('#hooks/use-sinopia-session.js', () => ({
  useSinopiaSession: () =>
    session.sinopia ? { status: 'signed-in', user: { id: session.id } } : { status: 'disabled' },
}));
vi.mock('#services/sinopia-cad.js', () => ({ downloadSinopiaCadObject: session.download }));
vi.mock('#lib/revision-actor.js', () => ({
  useRevisionSessionUser: () => (session.id ? { id: session.id } : undefined),
}));
vi.mock('#environment.config.js', () => ({ ENV: { TAU_API_URL: 'https://api.test/' } }));
const imageResponse = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } });

beforeEach(() => {
  session.id = 'account-one';
  session.sinopia = false;
  session.download.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => imageResponse()),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:saved-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cloud saved previews', () => {
  it('should fetch only the authenticated image and distinguish no preview from denied access', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response(undefined, { status: 204 }));
    await expect(fetchCloudProjectPreview('proj-one', new AbortController().signal)).resolves.toBeUndefined();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.test/v1/projects/proj-one/preview');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
    fetcher.mockResolvedValueOnce(new Response(undefined, { status: 404 }));
    await expect(fetchCloudProjectPreview('proj-one', new AbortController().signal)).rejects.toThrow('404');
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(262_145), { headers: { 'content-type': 'image/webp' } }));
    await expect(fetchCloudProjectPreview('proj-one', new AbortController().signal)).rejects.toThrow('too large');
  });

  it('should bound concurrent reads and abort queued work without issuing a request', async () => {
    const finish: Array<() => void> = [];
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          finish.push(() => {
            resolve(imageResponse());
          });
        }),
    );
    const controllers = Array.from({ length: 6 }, () => new AbortController());
    const requests = controllers.map(async (controller, index) =>
      fetchCloudProjectPreview(`p${String(index)}`, controller.signal),
    );
    const outcomes = Promise.allSettled(requests);
    expect(fetch).toHaveBeenCalledTimes(4);
    controllers[4]!.abort();
    for (const resolve of finish.splice(0)) {
      resolve();
    }
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(5);
    });
    for (const resolve of finish.splice(0)) {
      resolve();
    }
    const settled = await outcomes;
    expect(settled[4]?.status).toBe('rejected');
  });

  it('loads Sinopia previews only from private storage and drops them on account changes', async () => {
    session.sinopia = true;
    session.download.mockResolvedValue(new Blob(['preview'], { type: 'image/webp' }));
    const model: SinopiaCadModel = {
      id: 'model',
      project_id: 'project',
      user_id: 'account-one',
      name: 'Ring',
      engine: 'smlib',
      head_revision_id: null,
      snapshot_path: null,
      thumbnail_path: 'private-preview',
      snapshot_bytes: null,
      updated_at: '2026-10-23T10:00:00Z',
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useCloudProjectPreview('local-id', true, model), { wrapper });
    await waitFor(() => {
      expect(view.result.current.url).toBe('blob:saved-preview');
    });
    expect(session.download).toHaveBeenCalledWith(model, 'private-preview');
    expect(fetch).not.toHaveBeenCalled();
    session.id = 'account-two';
    act(() => {
      view.rerender();
    });
    expect(view.result.current.url).toBeUndefined();
    expect(session.download).toHaveBeenCalledOnce();
    view.unmount();
    client.clear();
  });

  it('should expose retry progress and recover from a transient preview failure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(fetch).mockResolvedValueOnce(new Response(undefined, { status: 503 }));
    const view = renderHook(() => useCloudProjectPreview('project', true), { wrapper });
    await waitFor(() => {
      expect(view.result.current.isFailed).toBe(true);
    });
    expect(view.result.current.canRetry).toBe(true);
    let finish: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(
      async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    let retry: Promise<unknown> | undefined;
    act(() => {
      retry = view.result.current.retry();
    });
    await waitFor(() => {
      expect(view.result.current.isLoading).toBe(true);
    });
    await act(async () => {
      finish?.(imageResponse());
      await retry;
    });
    await waitFor(() => {
      expect(view.result.current.url).toBe('blob:saved-preview');
    });
    expect(view.result.current.isFailed).toBe(false);
    view.unmount();
    client.clear();
  });

  it('should release image URLs and never retain the previous account image on account switch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useCloudProjectPreview('project', true), { wrapper });
    await waitFor(() => {
      expect(view.result.current.url).toBe('blob:saved-preview');
    });
    vi.mocked(fetch).mockResolvedValue(new Response(undefined, { status: 403 }));
    session.id = 'account-two';
    act(() => {
      view.rerender();
    });
    expect(view.result.current.url).toBeUndefined();
    await waitFor(() => {
      expect(view.result.current.isFailed).toBe(true);
      expect(view.result.current.canRetry).toBe(false);
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:saved-preview');
    view.unmount();
    client.clear();
  });
});
