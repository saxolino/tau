import type { GeometryComponentManifest } from '@taucad/types';

/**
 * A new model's pieces entering the viewer one at a time, each with its place on the canvas, so a host can name them as
 * they arrive. The assembly is only a veil over the drawing: the model interaction state keeps every piece, so
 * selection, measures, counts and exports never see it.
 */

/**
 * What a host asks for the next model the viewer presents.
 *
 * @public
 */
export type ModelAssemblyRequest = Readonly<{
  /** Identity of the request, such as the agent turn building the model; one key plays at most once. */
  key: string;
  /** Pause between two pieces. Milliseconds. Zero shows every piece at once, for reduced motion. */
  stepMilliseconds: number;
  /** How long the pieces stay named once all have entered. Milliseconds. */
  holdMilliseconds: number;
}>;

/**
 * Where a piece's centre sits on the canvas, in CSS pixels from its top-left corner.
 *
 * @public
 */
export type ModelAssemblyAnchor = Readonly<{ x: number; y: number }>;

/**
 * The canvas size anchors are measured in. CSS pixels.
 *
 * @public
 */
export type ModelAssemblyCanvas = Readonly<{ width: number; height: number }>;

/**
 * An assembly being played.
 *
 * @public
 */
export type ModelAssemblyRun = Readonly<{
  key: string;
  /** Every piece, in construction order. */
  componentIds: readonly string[];
  /** The model's components, so a host can name and size the pieces. */
  manifest: GeometryComponentManifest;
  /** How many pieces, from the first, are drawn. */
  entered: number;
  /** Whether every piece has entered; the run then holds for its request's `holdMilliseconds` and ends. */
  isComplete: boolean;
  /** The anchors of the entered pieces, once the viewer has measured them. */
  anchors: Readonly<Record<string, ModelAssemblyAnchor>>;
  /** The canvas the anchors belong to; absent before the first measurement. */
  canvas: ModelAssemblyCanvas | undefined;
}>;

/**
 * The assembly's state, read with `getSnapshot` and watched with `subscribe`.
 *
 * @public
 */
export type ModelAssemblySnapshot = Readonly<{
  /** The request waiting for the next model, if any. */
  request: ModelAssemblyRequest | undefined;
  /** The assembly being played, if any. */
  run: ModelAssemblyRun | undefined;
  /** The key of the last run started: a host never arms it again. */
  playedKey: string | undefined;
}>;

/**
 * The viewer's presentation of a model, as the assembly needs it.
 *
 * @public
 */
export type ModelAssemblyPresentation = Readonly<{
  /** The model's pieces, in construction order. */
  componentIds: readonly string[];
  /** The model's components. */
  manifest: GeometryComponentManifest;
  /** How many pieces the viewer drew before this model; only a model replacing none is assembled. */
  previousCount: number;
}>;

/**
 * One viewer's assembly: the host arms it, the viewer plays it.
 *
 * @public
 */
export type ModelAssembly = Readonly<{
  /** Arm the next model, or disarm with `undefined`. A played key is ignored; a run already playing continues. */
  arm: (request: ModelAssemblyRequest | undefined) => void;
  /** Called by the viewer for each model it presents: an armed request starts its run on a first model. */
  present: (presentation: ModelAssemblyPresentation) => void;
  /** The pieces not drawn yet. */
  hiddenComponentIds: () => readonly string[];
  /** Draw every piece now and end the run, as when the person starts working on the model. */
  finish: () => void;
  /** Record where the entered pieces sit; ignored without a run or when nothing moved by a pixel. */
  measure: (anchors: Readonly<Record<string, ModelAssemblyAnchor>>, canvas: ModelAssemblyCanvas) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ModelAssemblySnapshot;
  /** Stop the timers, when the viewer that owns the assembly goes away. */
  dispose: () => void;
}>;

/**
 * However many pieces a model has, they all enter within this time. Milliseconds.
 *
 * @public
 */
export const maximumModelAssemblyMilliseconds = 3000;

/**
 * The pause between two pieces: the requested step, shortened so the whole assembly stays within
 * {@link maximumModelAssemblyMilliseconds}.
 *
 * @param count - How many pieces enter.
 * @param stepMilliseconds - The requested pause. Milliseconds.
 * @returns The pause to use. Milliseconds.
 * @public
 */
export function modelAssemblyStep(count: number, stepMilliseconds: number): number {
  if (count <= 1 || stepMilliseconds <= 0) {
    return 0;
  }
  return Math.min(stepMilliseconds, maximumModelAssemblyMilliseconds / (count - 1));
}

const emptyIds: readonly string[] = Object.freeze([]);

const sameRequest = (previous: ModelAssemblyRequest | undefined, next: ModelAssemblyRequest | undefined): boolean =>
  previous?.key === next?.key &&
  previous?.stepMilliseconds === next?.stepMilliseconds &&
  previous?.holdMilliseconds === next?.holdMilliseconds;

const sameAnchors = (
  previous: Readonly<Record<string, ModelAssemblyAnchor>>,
  next: Readonly<Record<string, ModelAssemblyAnchor>>,
): boolean => {
  const keys = Object.keys(next);
  return (
    keys.length === Object.keys(previous).length &&
    keys.every((key) => {
      const before = previous[key];
      const after = next[key];
      return (
        before !== undefined &&
        after !== undefined &&
        Math.abs(before.x - after.x) < 1 &&
        Math.abs(before.y - after.y) < 1
      );
    })
  );
};

/**
 * Create a viewer's assembly. The host keeps one per viewer, arms it while an agent builds a model from nothing, and
 * hands it to the viewer, which presents each model to it, hides the pieces not entered yet and measures the others.
 *
 * @returns The assembly, idle and unarmed.
 * @public
 *
 * @example <caption>A host arms the next model and names the pieces as they enter</caption>
 * ```typescript
 * import { createModelAssembly } from '@taucad/viewer/graphics/three/react/model-assembly';
 *
 * const assembly = createModelAssembly();
 * assembly.arm({ key: 'turn-1', stepMilliseconds: 380, holdMilliseconds: 2200 });
 * const stop = assembly.subscribe(() => {
 *   const run = assembly.getSnapshot().run;
 *   console.log(run?.componentIds.slice(0, run.entered));
 * });
 * stop();
 * ```
 */
export function createModelAssembly(): ModelAssembly {
  let snapshot: ModelAssemblySnapshot = { request: undefined, run: undefined, playedKey: undefined };
  let hidden: readonly string[] = emptyIds;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const publish = (next: ModelAssemblySnapshot): void => {
    const before = snapshot.run;
    snapshot = next;
    const { run } = next;
    // The hidden list keeps its identity while only the anchors move, so a viewer redraws only when a piece enters.
    if (run?.key !== before?.key || run?.entered !== before?.entered || run?.componentIds !== before?.componentIds) {
      hidden = run && run.entered < run.componentIds.length ? run.componentIds.slice(run.entered) : emptyIds;
    }
    for (const listener of listeners) {
      listener();
    }
  };

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const end = (): void => {
    clearTimer();
    publish({ ...snapshot, run: undefined });
  };

  const advance = (step: number, hold: number): void => {
    const { run } = snapshot;
    if (!run) {
      return;
    }
    if (run.entered >= run.componentIds.length) {
      if (!run.isComplete) {
        publish({ ...snapshot, run: { ...run, isComplete: true } });
      }
      timer = setTimeout(end, hold);
      return;
    }
    timer = setTimeout(() => {
      const current = snapshot.run;
      if (!current) {
        return;
      }
      const entered = current.entered + 1;
      publish({
        ...snapshot,
        run: { ...current, entered, isComplete: entered >= current.componentIds.length },
      });
      advance(step, hold);
    }, step);
  };

  return {
    arm: (request) => {
      const next = request?.key === snapshot.playedKey ? undefined : request;
      if (sameRequest(snapshot.request, next)) {
        return;
      }
      publish({ ...snapshot, request: next });
    },
    present: ({ componentIds, manifest, previousCount }) => {
      const { request } = snapshot;
      if (!request || previousCount > 0 || componentIds.length === 0) {
        return;
      }
      clearTimer();
      const step = modelAssemblyStep(componentIds.length, request.stepMilliseconds);
      const entered = step === 0 ? componentIds.length : 1;
      publish({
        request: undefined,
        playedKey: request.key,
        run: {
          key: request.key,
          componentIds: [...componentIds],
          manifest,
          entered,
          isComplete: entered >= componentIds.length,
          anchors: {},
          canvas: undefined,
        },
      });
      advance(step, request.holdMilliseconds);
    },
    hiddenComponentIds: () => hidden,
    finish: () => {
      if (snapshot.run) {
        end();
      }
    },
    measure: (anchors, canvas) => {
      const { run } = snapshot;
      if (
        !run ||
        (run.canvas !== undefined &&
          run.canvas.width === canvas.width &&
          run.canvas.height === canvas.height &&
          sameAnchors(run.anchors, anchors))
      ) {
        return;
      }
      publish({ ...snapshot, run: { ...run, anchors, canvas } });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    dispose: clearTimer,
  };
}
