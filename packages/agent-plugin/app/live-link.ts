/**
 * The page's live link to `tau mcp` (agent plugin UI blueprint W6): a long poll of `app_sync` that reports what the
 * person sees and hears of models `show_model` handed over and of captures the agent waits for.
 */

import { tauViewerToolName } from '@taucad/mcp/viewer-protocol';
import type {
  TauViewerCamera,
  TauViewerComponent,
  TauViewerImage,
  TauViewerModel,
  TauViewerShowResult,
  TauViewerSyncResult,
  TauViewerViewState,
} from '@taucad/mcp/viewer-protocol';
import type { GeometryComponentManifest } from '@taucad/types';
import type { HostBridge } from '#app/host-bridge.js';

/** What the page knows about one unit of the model it draws. */
export type ShownUnit = Readonly<{
  manifest?: GeometryComponentManifest | undefined;
  selectedComponentIds: readonly string[];
  hiddenComponentIds: readonly string[];
  isolatedComponentIds: readonly string[];
}>;

/**
 * The view the page reports.
 *
 * @param input - The shown model, its unit's interaction state, the camera and the page's composition.
 * @returns The view state.
 */
export const viewStateOf = (
  input: Readonly<{
    model: TauViewerModel;
    unit: ShownUnit;
    camera: TauViewerCamera | undefined;
    sectionActive: boolean;
    measurementCount: number;
    composition: 'inline' | 'tab';
    interactedAt: number;
  }>,
): TauViewerViewState => {
  const { model, unit, camera } = input;
  const selected = unit.selectedComponentIds.slice(0, 64).flatMap((componentId): TauViewerComponent[] => {
    const node = unit.manifest?.nodesById[componentId];
    return node === undefined
      ? []
      : [
          {
            componentId,
            label: node.name,
            kind: node.kind,
            ...(node.selector === '' ? {} : { selector: node.selector }),
          },
        ];
  });
  return {
    model: {
      id: model.id,
      title: model.title,
      path: model.path,
      ...(model.sourceFile === undefined ? {} : { sourceFile: model.sourceFile }),
    },
    selected,
    hidden: unit.hiddenComponentIds.slice(0, 1024),
    isolated: unit.isolatedComponentIds.slice(0, 1024),
    ...(camera === undefined ? {} : { camera }),
    sectionActive: input.sectionActive,
    measurementCount: input.measurementCount,
    composition: input.composition,
    interactedAt: input.interactedAt,
  };
};

/** The widest capture the page sends; the agent reads a frame, not a print. */
const captureWidth = 1280;

/**
 * Capture the live view: the largest canvas in `root`, scaled down to at most 1280 px wide, as PNG.
 *
 * @param root - The element holding the viewer.
 * @returns The image, or why there is none.
 */
export const captureLiveView = (root: ParentNode): TauViewerImage | Readonly<{ error: string }> => {
  const canvases = [...root.querySelectorAll('canvas')].filter((canvas) => canvas.width > 0 && canvas.height > 0);
  const [canvas] = canvases.sort((left, right) => right.width * right.height - left.width * left.height);
  if (canvas === undefined) {
    return { error: 'The viewer draws no 3D canvas (a 2D drawing is captured with screenshot).' };
  }
  let source: HTMLCanvasElement = canvas;
  if (canvas.width > captureWidth) {
    const scaled = document.createElement('canvas');
    scaled.width = captureWidth;
    scaled.height = Math.round((canvas.height * captureWidth) / canvas.width);
    const context = scaled.getContext('2d');
    if (context === null) {
      return { error: 'The browser gave no 2D context to scale the capture.' };
    }
    context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    source = scaled;
  }
  const dataUrl = source.toDataURL('image/png');
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return data === '' ? { error: 'The canvas could not be read.' } : { mimeType: 'image/png', data };
};

/** What the live link asks of the page. */
export type LiveLinkPage = Readonly<{
  /** The view to report, or `undefined` before a model is shown. */
  view(): TauViewerViewState | undefined;
  /** Whether the page follows `show_model` (a tab does; a card keeps its model). */
  follows(): boolean;
  /** A model `show_model` handed over that this page has not seen. */
  show(result: TauViewerShowResult): void;
  /** Capture the live view once its model is drawn. */
  capture(): Promise<TauViewerImage | Readonly<{ error: string }>>;
}>;

/** The running link. */
export type LiveLink = Readonly<{
  /** Report the view now, outside the poll (after the person changed it). */
  nudge(): void;
  stop(): void;
}>;

const isSyncResult = (value: unknown): value is TauViewerSyncResult =>
  typeof value === 'object' && value !== null && 'version' in value && typeof value.version === 'number';

/** Milliseconds between retries after a failed sync, doubling to the cap. */
const retryFloor = 1000;
const retryCap = 30_000;

const sleep = async (duration: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, duration);
  });

/**
 * Start the page's long poll.
 *
 * @param callTool - The host bridge's tool call.
 * @param page - What the link reads from and hands to the page.
 * @returns The running link.
 */
export const startLiveLink = (callTool: HostBridge['callTool'], page: LiveLinkPage): LiveLink => {
  /* `randomUUID` needs a secure context, which a sandboxed host frame may not be. */
  const pageId = `page-${[...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  let version = 0;
  const control = { stopped: false };
  let retry = retryFloor;
  const answered = new Set<string>();

  const handle = async (result: TauViewerSyncResult): Promise<void> => {
    version = Math.max(version, result.version);
    if (result.show !== undefined && page.follows()) {
      page.show(result.show);
    }
    const requestId = result.capture?.requestId;
    if (requestId !== undefined && !answered.has(requestId)) {
      answered.add(requestId);
      const captured = await page.capture();
      await callTool(tauViewerToolName.appCaptureReply, {
        requestId,
        pageId,
        ...('error' in captured ? { error: captured.error } : { image: captured }),
      });
    }
  };

  const sync = async (wait: boolean): Promise<void> => {
    const view = page.view();
    const result = await callTool(tauViewerToolName.appSync, {
      pageId,
      version,
      follow: page.follows(),
      wait,
      ...(view === undefined ? {} : { view }),
    });
    if (isSyncResult(result)) {
      await handle(result);
    }
  };

  const loop = async (): Promise<void> => {
    while (!control.stopped) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- One sync at a time: each answers the version the last one saw.
        await sync(true);
        retry = retryFloor;
      } catch {
        // A host without the tool, or a server that went away: try again later, less often.
        // oxlint-disable-next-line eslint/no-await-in-loop -- The back-off waits between serial syncs.
        await sleep(retry);
        retry = Math.min(retry * 2, retryCap);
      }
    }
  };
  // async-iife: bootstrap — the poll runs for the page's life; stop() ends it.
  void loop();

  return {
    nudge() {
      if (!control.stopped) {
        // async-iife: bootstrap — a report the next poll repeats if it fails.
        void (async () => {
          try {
            await sync(false);
          } catch {
            // The next poll reports the same view.
          }
        })();
      }
    },
    stop() {
      control.stopped = true;
    },
  };
};
