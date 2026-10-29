import { Topic } from '@taucad/events';
import type { SinopiaCadEngine, SinopiaCadLink, SinopiaCadModel } from '#services/sinopia-cad.js';

/**
 * A save that can never succeed by retrying, each with its own sentence: the model is over Sinopia's size limits
 * (`tooLarge`), was deleted on Sinopia (`deleted`), or belongs to another Sinopia account (`foreign`). A queue in one of
 * them stops until something changes (a new revision for `tooLarge`); it never retries every minute in silence.
 */
export type SinopiaCadPermanentFailure = 'tooLarge' | 'deleted' | 'foreign';

/**
 * The state describes the acknowledged Sinopia copy, independently of local revision minting.
 *
 * `pending`: work on this computer that is not on Sinopia yet (edits not yet in a revision, or a revision not yet
 * saved). `unreachable`: Sinopia did not answer, and there is nothing waiting to be saved here.
 */
export type SinopiaCadSyncState = Readonly<{
  kind:
    | 'idle'
    | 'loading'
    | 'saving'
    | 'saved'
    | 'pending'
    | 'failed'
    | 'unreachable'
    | 'conflict'
    | SinopiaCadPermanentFailure;
  at?: number;
  remote?: SinopiaCadModel;
}>;
export type SinopiaCadSyncObservation = Readonly<{
  revisionId: string | undefined;
  engine: SinopiaCadEngine | undefined;
  name: string;
  busy: boolean;
  /** Edits on this computer that are not in a revision yet (dirty or minting): the head alone does not show them. */
  unsaved?: boolean;
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
  apply: (remote: SinopiaCadModel) => Promise<Readonly<{ revisionId: string; contentKey?: string }>>;
  /** Whether a local revision holds exactly the content of the link's acknowledged Sinopia copy (another commit of it). */
  matchesBase?: (link: SinopiaCadLink, revisionId: string) => Promise<boolean>;
  active: () => boolean;
}>;

export type SinopiaCadSync = Readonly<{
  getState: () => SinopiaCadSyncState;
  getLink: () => SinopiaCadLink;
  subscribe: (listener: () => void) => () => void;
  observe: (next: SinopiaCadSyncObservation) => void;
  retry: () => void;
  /** The page is going away (hidden tab, closing): save what is waiting now, without the debounce. */
  flush: () => void;
  /** A late preview is ready: send it only if Sinopia still has none (`previewPending`), never again on every open. */
  refreshPreview: () => void;
  resolve: (choice: 'local' | 'remote' | 'defer') => Promise<void>;
  dispose: () => void;
}>;

const messageOf = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

/**
 * The failures retrying cannot fix. `ARCHIVE_TOO_LARGE` (256 MiB archive ceiling), the revision owner's 64 MiB snapshot
 * refusal and the storage's own size refusal (HTTP 413) are `tooLarge`; a row deleted on Sinopia is `deleted`; a model
 * of another account is `foreign`.
 */
export function permanentSinopiaCadFailure(error: unknown): SinopiaCadPermanentFailure | undefined {
  const message = messageOf(error);
  const status =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? String((error as { statusCode: unknown }).statusCode)
      : undefined;
  if (
    message === 'ARCHIVE_TOO_LARGE' ||
    /too large|exceeded the maximum allowed size|payload too large/iu.test(message) ||
    status === '413'
  ) {
    return 'tooLarge';
  }
  if (message === 'SINOPIA_MODEL_DELETED') {
    return 'deleted';
  }
  if (message === 'SINOPIA_OWNER_MISMATCH') {
    return 'foreign';
  }
  return undefined;
}

/**
 * The link a save handed back instead of saving: the part this model starts from already is another model of the
 * account (`SinopiaCadOriginTakenError` of `ensureSinopiaCadModel`). Read by shape, so the queue stays free of Supabase.
 */
const adoptedLinkOf = (error: unknown): SinopiaCadLink | undefined =>
  typeof error === 'object' && error !== null && 'adopted' in error
    ? (error as { adopted: SinopiaCadLink }).adopted
    : undefined;

const isPermanent = (kind: SinopiaCadSyncState['kind']): kind is SinopiaCadPermanentFailure =>
  kind === 'tooLarge' || kind === 'deleted' || kind === 'foreign';

/** One serialized queue per mounted project/account. Its pure port makes races and debounce testable without a network. */
export function createSinopiaCadSync(initialLink: SinopiaCadLink, port: SinopiaCadSyncPort): SinopiaCadSync {
  let link = initialLink;
  let state: SinopiaCadSyncState = { kind: 'loading' };
  let view: SinopiaCadSyncState = state;
  let observation: SinopiaCadSyncObservation = { revisionId: undefined, engine: undefined, name: '', busy: true };
  let lastSaved = initialLink.localRevisionId ?? initialLink.baseRevisionId ?? undefined;
  let running = false;
  let disposed = false;
  let deferred = false;
  let checked = false;
  let urgent = false;
  let failures = 0;
  let previewRetryOwed = initialLink.previewPending === true;
  /** The revision a `tooLarge` refusal was about: a new revision may be small enough again. */
  let refusedRevision: string | undefined;
  /** A newer copy on Sinopia seen on open, waiting for the local state to settle before conflict or adoption. */
  let diverged: SinopiaCadModel | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const topic = new Topic<void>({ name: 'SinopiaCadSync.state' });
  let acknowledged: { link: SinopiaCadLink; revisionId: string; at: number } | undefined;
  const active = (): boolean => !disposed && port.active();
  const hasLocalWork = (): boolean =>
    observation.unsaved === true || (observation.revisionId !== undefined && observation.revisionId !== lastSaved);
  /* What the top bar shows: the acknowledged state, unless this computer holds work Sinopia does not have yet. «Salvato
     su Sinopia» is never said over edits that only exist here. */
  const derive = (): SinopiaCadSyncState => {
    if ((state.kind === 'saved' || state.kind === 'idle') && hasLocalWork()) {
      return state.at === undefined ? { kind: 'pending' } : { kind: 'pending', at: state.at };
    }
    if (state.kind === 'failed' && state.remote === undefined && !hasLocalWork() && !observation.busy) {
      return { kind: 'unreachable' };
    }
    return state;
  };
  const refresh = (): void => {
    const next = derive();
    if (next.kind !== view.kind || next.at !== view.at || next.remote !== view.remote) {
      view = next;
      topic.emit();
    }
  };
  const publish = (next: SinopiaCadSyncState): void => {
    if (!active()) {
      return;
    }
    state = next;
    view = derive();
    topic.emit();
  };
  const conflict = (remote: SinopiaCadModel): void => {
    deferred = true;
    publish({ kind: 'conflict', remote });
  };
  const fail = (error: unknown, remote?: SinopiaCadModel): void => {
    const permanent = permanentSinopiaCadFailure(error);
    if (permanent === 'tooLarge') {
      refusedRevision = observation.revisionId;
    }
    publish(
      permanent === undefined ? { kind: 'failed', ...(remote === undefined ? {} : { remote }) } : { kind: permanent },
    );
  };
  const schedule = (): void => {
    clearTimeout(timer);
    if (state.kind === 'tooLarge' && observation.revisionId !== refusedRevision) {
      // A new revision: it may fit again.
      refusedRevision = undefined;
      publish({ kind: lastSaved === undefined ? 'idle' : 'saved' });
    }
    if (
      !active() ||
      running ||
      deferred ||
      isPermanent(state.kind) ||
      observation.busy ||
      observation.revisionId === undefined ||
      observation.engine === undefined ||
      (observation.revisionId === lastSaved && !previewRetryOwed)
    ) {
      return;
    }
    if (urgent) {
      void save();
      return;
    }
    timer = setTimeout(() => {
      void save();
    }, 2000);
  };
  const scheduleRetry = (): void => {
    clearTimeout(timer);
    if (!active() || deferred || isPermanent(state.kind)) {
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
  const settle = (): void => {
    if (!checked && state.kind !== 'failed' && !isPermanent(state.kind)) {
      // A link adopted after a save (find or create) is checked again before anything is saved to it.
      void inspect();
      return;
    }
    if (state.kind === 'failed') {
      scheduleRetry();
    } else if (!isPermanent(state.kind)) {
      failures = 0;
      schedule();
    }
  };
  /**
   * A newer copy on Sinopia (another device saved since this one): with no work of its own here the remote copy is
   * simply taken, as a new local revision (the old one stays in Versions); only real local work asks «quale tieni?».
   */
  const decide = async (): Promise<void> => {
    const remote = diverged;
    if (remote === undefined || running || !active()) {
      return;
    }
    if (observation.unsaved === true) {
      diverged = undefined;
      conflict(remote);
      return;
    }
    if (observation.busy || observation.revisionId === undefined) {
      return;
    }
    running = true;
    const seen = observation;
    const local = observation.revisionId;
    try {
      const unchanged =
        local === lastSaved || (port.matchesBase === undefined ? false : await port.matchesBase(link, local));
      if (!active()) {
        return;
      }
      if (observation !== seen) {
        // The checkout moved while this was checked: decide again on the new state.
        return;
      }
      diverged = undefined;
      if (!unchanged) {
        conflict(remote);
        return;
      }
      publish({ kind: 'saving' });
      const applied = await port.apply(remote);
      if (!active()) {
        return;
      }
      const { baseContentKey: _previous, ...rest } = link;
      const next: SinopiaCadLink = {
        ...rest,
        baseRevisionId: remote.head_revision_id,
        localRevisionId: applied.revisionId,
        ...(applied.contentKey === undefined ? {} : { baseContentKey: applied.contentKey }),
      };
      lastSaved = applied.revisionId;
      observation = { ...observation, revisionId: applied.revisionId };
      await port.persist(next);
      if (!active()) {
        return;
      }
      link = next;
      publish({ kind: 'saved', at: Date.parse(remote.updated_at) });
    } catch (error) {
      console.error('[sinopia] taking the newer Sinopia copy failed', error);
      diverged = undefined;
      conflict(remote);
    } finally {
      running = false;
      if (diverged === undefined) {
        settle();
      } else {
        void decide();
      }
    }
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
        diverged = remote;
        return;
      }
      publish({
        kind: lastSaved === undefined ? 'idle' : 'saved',
        ...(remote === undefined ? {} : { at: Date.parse(remote.updated_at) }),
      });
    } catch (error) {
      console.error('[sinopia] model check failed', error);
      fail(error);
    } finally {
      running = false;
      if (diverged === undefined) {
        settle();
      } else {
        void decide();
      }
    }
  };
  const save = async (): Promise<void> => {
    clearTimeout(timer);
    if (!active() || running || deferred || observation.busy || isPermanent(state.kind)) {
      return;
    }
    const current = observation;
    if (current.revisionId === undefined || current.engine === undefined) {
      return;
    }
    running = true;
    urgent = false;
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
      const adopted = adoptedLinkOf(error);
      if (adopted === undefined) {
        console.error('[sinopia] save failed', error);
        fail(error);
      } else {
        // Find or create: this piece already is that model on Sinopia. Work on it from now on; its newer copy there
        // makes the next check ask which version to keep, instead of a second model of the same part.
        try {
          await port.persist(adopted);
          if (active()) {
            link = adopted;
            lastSaved = undefined;
            previewRetryOwed = false;
            checked = false;
            publish({ kind: 'loading' });
          }
        } catch (persistError) {
          console.error('[sinopia] adopting the existing model failed', persistError);
          fail(persistError);
        }
      }
    } finally {
      running = false;
      settle();
    }
  };
  return {
    getState: (): SinopiaCadSyncState => view,
    getLink: (): SinopiaCadLink => link,
    subscribe(listener: () => void): () => void {
      return topic.subscribe(listener);
    },
    observe(next: SinopiaCadSyncObservation): void {
      observation = next;
      if (active()) {
        refresh();
      }
      if (diverged !== undefined) {
        void decide();
      } else if (checked) {
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
    flush(): void {
      urgent = true;
      if (checked && !running) {
        schedule();
      }
    },
    refreshPreview(): void {
      if (!active() || deferred || isPermanent(state.kind) || (link.previewPending !== true && !previewRetryOwed)) {
        return;
      }
      previewRetryOwed = true;
      if (!running && checked) {
        clearTimeout(timer);
        void save();
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
        const { baseContentKey: _previous, ...rest } = link;
        if (choice === 'local') {
          // Keep the resolution intent in this serialized queue until CAS acknowledges the chosen local bytes.
          // Persisting only the remote baseline here would remount a queue that mistakes the old local head for saved.
          link = { ...rest, baseRevisionId: selected.head_revision_id };
          lastSaved = undefined;
          deferred = false;
          publish({ kind: 'idle' });
          return;
        }
        const applied = await port.apply(selected);
        if (!active()) {
          return;
        }
        lastSaved = applied.revisionId;
        observation = { ...observation, revisionId: applied.revisionId };
        const next: SinopiaCadLink = {
          ...rest,
          baseRevisionId: selected.head_revision_id,
          localRevisionId: applied.revisionId,
          ...(applied.contentKey === undefined ? {} : { baseContentKey: applied.contentKey }),
        };
        await port.persist(next);
        if (!active()) {
          return;
        }
        link = next;
        deferred = false;
        publish({ kind: 'saved', at: Date.parse(selected.updated_at) });
      } catch (error) {
        console.error('[sinopia] conflict resolution failed', error);
        fail(error, selected);
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
