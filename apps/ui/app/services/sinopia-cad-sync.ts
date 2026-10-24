import { Topic } from '@taucad/events';
import type { SinopiaCadEngine, SinopiaCadLink, SinopiaCadModel } from '#services/sinopia-cad.js';

/** The state describes the acknowledged Sinopia copy, independently of local revision minting. */
export type SinopiaCadSyncState = Readonly<{
  kind: 'idle' | 'loading' | 'saving' | 'saved' | 'failed' | 'conflict';
  at?: number;
  remote?: SinopiaCadModel;
}>;
export type SinopiaCadSyncObservation = Readonly<{
  revisionId: string | undefined;
  engine: SinopiaCadEngine | undefined;
  name: string;
  busy: boolean;
}>;
export type SinopiaCadSyncPort = Readonly<{
  read: (link: SinopiaCadLink) => Promise<SinopiaCadModel | undefined>;
  save: (
    link: SinopiaCadLink,
    observation: SinopiaCadSyncObservation & { revisionId: string; engine: SinopiaCadEngine },
  ) => Promise<
    | { kind: 'saved'; link: SinopiaCadLink; at: number; previewPending?: boolean }
    | { kind: 'conflict'; remote: SinopiaCadModel }
  >;
  persist: (link: SinopiaCadLink) => Promise<void>;
  preserve: (remote: SinopiaCadModel) => Promise<void>;
  apply: (remote: SinopiaCadModel) => Promise<string>;
  active: () => boolean;
}>;

export type SinopiaCadSync = Readonly<{
  getState: () => SinopiaCadSyncState;
  getLink: () => SinopiaCadLink;
  subscribe: (listener: () => void) => () => void;
  observe: (next: SinopiaCadSyncObservation) => void;
  retry: () => void;
  resolve: (choice: 'local' | 'remote' | 'defer') => Promise<void>;
  dispose: () => void;
}>;

/** One serialized queue per mounted project/account. Its pure port makes races and debounce testable without a network. */
export function createSinopiaCadSync(initialLink: SinopiaCadLink, port: SinopiaCadSyncPort): SinopiaCadSync {
  let link = initialLink;
  let state: SinopiaCadSyncState = { kind: 'loading' };
  let observation: SinopiaCadSyncObservation = { revisionId: undefined, engine: undefined, name: '', busy: true };
  let lastSaved = initialLink.localRevisionId ?? initialLink.baseRevisionId ?? undefined;
  let running = false;
  let disposed = false;
  let deferred = false;
  let checked = false;
  let failures = 0;
  let previewRetryOwed = initialLink.previewPending === true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const topic = new Topic<void>({ name: 'SinopiaCadSync.state' });
  let acknowledged: { link: SinopiaCadLink; revisionId: string; at: number } | undefined;
  const active = (): boolean => !disposed && port.active();
  const publish = (next: SinopiaCadSyncState): void => {
    if (!active()) {
      return;
    }
    state = next;
    topic.emit();
  };
  const conflict = (remote: SinopiaCadModel): void => {
    deferred = true;
    publish({ kind: 'conflict', remote });
  };
  const schedule = (): void => {
    clearTimeout(timer);
    if (
      !active() ||
      running ||
      deferred ||
      observation.busy ||
      observation.revisionId === undefined ||
      observation.engine === undefined ||
      (observation.revisionId === lastSaved && !previewRetryOwed)
    ) {
      return;
    }
    timer = setTimeout(() => {
      void save();
    }, 2000);
  };
  const scheduleRetry = (): void => {
    clearTimeout(timer);
    if (!active() || deferred) {
      return;
    }
    failures += 1;
    timer = setTimeout(
      () => {
        if (checked) {
          void save();
        } else {
          void inspect();
        }
      },
      Math.min(60_000, 5000 * 2 ** Math.min(failures - 1, 4)),
    );
  };
  const inspect = async (): Promise<void> => {
    if (!active() || running || checked) {
      return;
    }
    running = true;
    try {
      const remote = await port.read(link);
      if (!active()) {
        return;
      }
      checked = true;
      if (remote !== undefined && remote.head_revision_id !== link.baseRevisionId) {
        conflict(remote);
        return;
      }
      publish({
        kind: lastSaved === undefined ? 'idle' : 'saved',
        ...(remote === undefined ? {} : { at: Date.parse(remote.updated_at) }),
      });
    } catch (error) {
      console.error('[sinopia] model check failed', error);
      publish({ kind: 'failed' });
    } finally {
      running = false;
      if (state.kind === 'failed') {
        scheduleRetry();
      } else {
        failures = 0;
        schedule();
      }
    }
  };
  const save = async (): Promise<void> => {
    if (!active() || running || deferred || observation.busy) {
      return;
    }
    const current = observation;
    if (current.revisionId === undefined || current.engine === undefined) {
      return;
    }
    running = true;
    previewRetryOwed = false;
    publish({ kind: 'saving' });
    try {
      const result: Awaited<ReturnType<SinopiaCadSyncPort['save']>> =
        acknowledged === undefined
          ? await port.save(link, { ...current, revisionId: current.revisionId, engine: current.engine })
          : {
              kind: 'saved',
              link: acknowledged.link,
              at: acknowledged.at,
              previewPending: acknowledged.link.previewPending,
            };
      if (!active()) {
        return;
      }
      if (result.kind === 'conflict') {
        conflict(result.remote);
        return;
      }
      // A failed record write keeps the old baseline; next retry recognizes its own immutable remote head.
      const savedRevision = acknowledged?.revisionId ?? current.revisionId;
      const next = { ...result.link, localRevisionId: savedRevision, previewPending: result.previewPending ?? false };
      acknowledged = { link: next, revisionId: savedRevision, at: result.at };
      await port.persist(next);
      if (!active()) {
        return;
      }
      link = next;
      lastSaved = savedRevision;
      acknowledged = undefined;
      checked = true;
      publish({ kind: 'saved', at: result.at });
    } catch (error) {
      console.error('[sinopia] save failed', error);
      publish({ kind: 'failed' });
    } finally {
      running = false;
      if (state.kind === 'failed') {
        scheduleRetry();
      } else {
        failures = 0;
        schedule();
      }
    }
  };
  return {
    getState: (): SinopiaCadSyncState => state,
    getLink: (): SinopiaCadLink => link,
    subscribe(listener: () => void): () => void {
      return topic.subscribe(listener);
    },
    observe(next: SinopiaCadSyncObservation): void {
      observation = next;
      if (checked) {
        schedule();
      } else {
        void inspect();
      }
    },
    retry(): void {
      clearTimeout(timer);
      if (running) {
        previewRetryOwed = true;
        return;
      }
      deferred = false;
      if (checked) {
        void save();
      } else {
        void inspect();
      }
    },
    async resolve(choice: 'local' | 'remote' | 'defer'): Promise<void> {
      if (choice === 'defer') {
        deferred = true;
        return;
      }
      const selected = state.remote;
      if (!active() || running || observation.busy || selected === undefined) {
        return;
      }
      running = true;
      publish({ kind: 'saving', remote: selected });
      try {
        const latest = await port.read(link);
        if (!active()) {
          return;
        }
        if (latest === undefined) {
          throw new Error('SINOPIA_MODEL_UNAVAILABLE');
        }
        if (latest.head_revision_id !== selected.head_revision_id || latest.snapshot_path !== selected.snapshot_path) {
          conflict(latest);
          return;
        }
        await port.preserve(selected);
        if (!active()) {
          return;
        }
        if (choice === 'local') {
          // Keep the resolution intent in this serialized queue until CAS acknowledges the chosen local bytes.
          // Persisting only the remote baseline here would remount a queue that mistakes the old local head for saved.
          link = { ...link, baseRevisionId: selected.head_revision_id };
          lastSaved = undefined;
          deferred = false;
          publish({ kind: 'idle' });
          return;
        }
        const localHead = await port.apply(selected);
        if (!active()) {
          return;
        }
        lastSaved = localHead;
        observation = { ...observation, revisionId: localHead };
        const next = { ...link, baseRevisionId: selected.head_revision_id, localRevisionId: localHead };
        await port.persist(next);
        if (!active()) {
          return;
        }
        link = next;
        deferred = false;
        publish({ kind: 'saved', at: Date.parse(selected.updated_at) });
      } catch (error) {
        console.error('[sinopia] conflict resolution failed', error);
        publish({ kind: 'failed', remote: selected });
      } finally {
        running = false;
        schedule();
      }
    },
    dispose(): void {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
