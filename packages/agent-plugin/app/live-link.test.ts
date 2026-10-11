import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TauViewerShowResult, TauViewerSyncResult } from '@taucad/mcp/viewer-protocol';
import { startLiveLink } from '#app/live-link.js';
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
});
