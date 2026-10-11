import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TauViewerShowResult, TauViewerSyncResult } from '@taucad/mcp/viewer-protocol';
import { startLiveLink, whenDrawn } from '#app/live-link.js';
import type { LiveLink, LiveLinkPage } from '#app/live-link.js';

const shown: TauViewerShowResult = {
  model: {
    id: 'm2',
    title: 'Gear',
    path: '.tau/artifacts/gear.glb',
    sourceFile: 'gear.ts',
    mimeType: 'model/gltf-binary',
    byteLength: 3,
    sha256: 'b'.repeat(64),
  },
};

type Call = Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>;

/**
 * A server that answers each `app_sync` from a script, then holds later ones open until stopped.
 *
 * @param answers - The structured results of the first syncs, in order.
 * @returns The tool call and the calls it received.
 */
const scriptedServer = (answers: TauViewerSyncResult[]) => {
  const calls: Call[] = [];
  const callTool = vi.fn(async (name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> => {
    calls.push({ name, args });
    if (name !== 'app_sync') {
      return { accepted: true };
    }
    const next = answers.shift();
    /* Later syncs stay held, as a server with nothing new holds them. */
    return (
      next ??
      new Promise<never>(() => {
        // Never settles.
      })
    );
  });
  return { calls, callTool };
};

const pageOf = (overrides: Partial<LiveLinkPage>): LiveLinkPage => ({
  view: () => undefined,
  follows: () => true,
  toolCallId: () => undefined,
  show: vi.fn<LiveLinkPage['show']>(),
  capture: async () => ({ error: 'unused' }),
  ...overrides,
});

const links: LiveLink[] = [];
afterEach(() => {
  for (const link of links.splice(0)) {
    link.stop();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startLiveLink', () => {
  it('should keep a card on its model and name the tool call that opened it', async () => {
    const { calls, callTool } = scriptedServer([{ version: 1, show: shown }]);
    const show = vi.fn<LiveLinkPage['show']>();
    links.push(startLiveLink(callTool, pageOf({ follows: () => false, toolCallId: () => 'call-7', show })));

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.name === 'app_sync')).toHaveLength(2);
    });
    expect(calls[0]?.args).toMatchObject({ follow: false, toolCallId: 'call-7', wait: true });
    expect(calls[1]?.args).toMatchObject({ version: 1 });
    expect(show).not.toHaveBeenCalled();
  });

  it('should hand a page the person opened each model shown', async () => {
    const { calls, callTool } = scriptedServer([{ version: 1, show: shown }]);
    const show = vi.fn<LiveLinkPage['show']>();
    links.push(startLiveLink(callTool, pageOf({ show })));

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith(shown);
    });
    expect(calls[0]?.args).not.toHaveProperty('toolCallId');
  });

  it('should answer a capture that throws with its error, without backing off the poll', async () => {
    vi.useFakeTimers();
    const { calls, callTool } = scriptedServer([{ version: 0, capture: { requestId: 'capture-1' } }]);
    links.push(
      startLiveLink(
        callTool,
        pageOf({
          capture: async () => {
            throw new Error('WebGL context lost');
          },
        }),
      ),
    );

    /* No timer runs, so a back-off sleep would hold the next sync back. */
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((call) => call.name)).toEqual(['app_sync', 'app_capture_reply', 'app_sync']);
    expect(calls[1]?.args).toEqual({
      requestId: 'capture-1',
      pageId: calls[0]?.args['pageId'],
      error: 'The viewer could not capture its view: WebGL context lost',
    });
  });

  it('should capture a frame the browser paints no frames for, polling meanwhile', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const image = { mimeType: 'image/png', data: 'cG5n' } as const;
    const { calls, callTool } = scriptedServer([{ version: 0, capture: { requestId: 'capture-1' } }]);
    links.push(
      startLiveLink(
        callTool,
        pageOf({
          capture: async () => ((await whenDrawn(() => true)) ? image : { error: 'Not drawn.' }),
        }),
      ),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((call) => call.name)).toEqual(['app_sync', 'app_sync']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.map((call) => call.name)).toEqual(['app_sync', 'app_sync', 'app_capture_reply']);
    expect(calls[2]?.args).toMatchObject({ requestId: 'capture-1', image });
  });
});
