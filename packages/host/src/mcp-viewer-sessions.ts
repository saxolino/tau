/**
 * The live link between `tau mcp` and the viewer pages it serves (agent plugin UI blueprint W6).
 *
 * A page long-polls `app_sync`: it reports what the person sees and hears of models `show_model` handed over and of
 * captures the agent waits for. `view_state` reads the page the person used last and, when asked, has that page
 * capture its live view. Everything lives in memory for one server process.
 */

import { randomUUID } from 'node:crypto';

import type { TauMcpViewerFailure } from '@taucad/mcp';
import type {
  TauViewerCaptureReplyInput,
  TauViewerImage,
  TauViewerShowResult,
  TauViewerSyncInput,
  TauViewerSyncResult,
  TauViewerViewState,
} from '@taucad/mcp/viewer-protocol';

/** Timing knobs; tests shorten them. */
export type McpViewerSessionsOptions = Readonly<{
  /** How long a waiting `app_sync` is held before it answers unchanged. Milliseconds. */
  hold?: number;
  /** How long after its last sync a page still counts as open. Milliseconds. */
  live?: number;
  /** How long `view_state` waits for a capture. Milliseconds. */
  captureTimeout?: number;
  now?: () => number;
}>;

/** What `view_state` returns. */
export type McpViewerViewStateResult = Readonly<{
  view: TauViewerViewState;
  image?: TauViewerImage;
  captureError?: string;
}>;

/** The sessions of one server process. */
export type McpViewerSessions = Readonly<{
  /** A model was shown: pages that follow `show_model` switch to it. */
  shown(result: TauViewerShowResult): void;
  sync(input: TauViewerSyncInput, signal?: AbortSignal): Promise<TauViewerSyncResult>;
  viewState(
    input: Readonly<{ capture?: boolean | undefined }>,
    signal?: AbortSignal,
  ): Promise<McpViewerViewStateResult | TauMcpViewerFailure>;
  captureReply(input: TauViewerCaptureReplyInput): Readonly<{ accepted: boolean }>;
  /** Answer every held sync and fail every pending capture. */
  close(): void;
}>;

type Page = {
  view?: TauViewerViewState;
  lastSeen: number;
  /** Capture requests this page has not answered, oldest first. */
  captures: string[];
  wake?: () => void;
};

type CaptureOutcome = Readonly<{ image: TauViewerImage } | { error: string }>;

type PendingCapture = Readonly<{ pageId: string; settle: (outcome: CaptureOutcome) => void }>;

const unref = (timer: ReturnType<typeof setTimeout>): void => {
  // Node timers keep the process alive; a held sync must not keep `tau mcp` running after stdin closes.
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
};

/**
 * Create the sessions of one `tau mcp` process.
 *
 * @param options - Timing knobs.
 * @returns The sessions.
 */
export const createMcpViewerSessions = (options: McpViewerSessionsOptions = {}): McpViewerSessions => {
  /** Milliseconds. */
  const hold = options.hold ?? 20_000;
  /** Milliseconds. */
  const live = options.live ?? 45_000;
  /** Milliseconds. */
  const captureTimeout = options.captureTimeout ?? 20_000;
  const now = options.now ?? Date.now;
  const pages = new Map<string, Page>();
  const captures = new Map<string, PendingCapture>();
  let version = 0;
  let latest: TauViewerShowResult | undefined;
  let closed = false;

  const answer = (page: Page, input: TauViewerSyncInput): TauViewerSyncResult => {
    const [requestId] = page.captures;
    return {
      version,
      ...(input.follow && latest !== undefined && version > input.version ? { show: latest } : {}),
      ...(requestId === undefined ? {} : { capture: { requestId } }),
    };
  };
  const isReady = (page: Page, input: TauViewerSyncInput): boolean =>
    page.captures.length > 0 || (input.follow && latest !== undefined && version > input.version);

  const livePages = (): Array<readonly [string, Page & { view: TauViewerViewState }]> =>
    [...pages.entries()]
      .filter((entry): entry is [string, Page & { view: TauViewerViewState }] => {
        const [, page] = entry;
        return page.view !== undefined && now() - page.lastSeen <= live;
      })
      .sort(
        ([, left], [, right]) => right.view.interactedAt - left.view.interactedAt || right.lastSeen - left.lastSeen,
      );

  const sessions: McpViewerSessions = {
    shown(result) {
      version += 1;
      latest = result;
      for (const page of pages.values()) {
        page.wake?.();
      }
    },
    async sync(input, signal) {
      let page = pages.get(input.pageId);
      if (page === undefined) {
        page = { lastSeen: now(), captures: [] };
        pages.set(input.pageId, page);
      }
      page.lastSeen = now();
      if (input.view !== undefined) {
        page.view = input.view;
      }
      // A newer sync from the same page supersedes the one it held.
      page.wake?.();
      if (closed || !input.wait || isReady(page, input)) {
        return answer(page, input);
      }
      const held = page;
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', finish);
          if (held.wake === finish) {
            held.wake = undefined;
          }
          resolve();
        };
        const timer = setTimeout(finish, hold);
        unref(timer);
        signal?.addEventListener('abort', finish, { once: true });
        held.wake = finish;
      });
      held.lastSeen = now();
      return answer(held, input);
    },
    async viewState(input, signal) {
      const [target] = livePages();
      if (target === undefined) {
        return {
          errorCode: 'NO_VIEWER',
          message: 'No Tau viewer page is open. Call show_model to open one, then ask again.',
        };
      }
      const [pageId, page] = target;
      if (input.capture !== true) {
        return { view: page.view };
      }
      const requestId = randomUUID();
      const outcome = await new Promise<CaptureOutcome>((resolve) => {
        const settle = (value: CaptureOutcome): void => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', aborted);
          captures.delete(requestId);
          page.captures = page.captures.filter((id) => id !== requestId);
          resolve(value);
        };
        const aborted = (): void => {
          settle({ error: 'The call was cancelled.' });
        };
        const timer = setTimeout(() => {
          settle({ error: 'The viewer did not answer in time; it may be hidden or still drawing the model.' });
        }, captureTimeout);
        unref(timer);
        signal?.addEventListener('abort', aborted, { once: true });
        captures.set(requestId, { pageId, settle });
        page.captures.push(requestId);
        page.wake?.();
      });
      // The page reports its view with each sync; the freshest one goes with the image.
      const { view } = page;
      return 'image' in outcome ? { view, image: outcome.image } : { view, captureError: outcome.error };
    },
    captureReply(input) {
      const pending = captures.get(input.requestId);
      if (pending === undefined || pending.pageId !== input.pageId) {
        return { accepted: false };
      }
      pending.settle(
        input.image === undefined ? { error: input.error ?? 'The viewer sent no image.' } : { image: input.image },
      );
      return { accepted: true };
    },
    close() {
      closed = true;
      for (const pending of captures.values()) {
        pending.settle({ error: 'The server is closing.' });
      }
      for (const page of pages.values()) {
        page.wake?.();
      }
    },
  };
  return sessions;
};
