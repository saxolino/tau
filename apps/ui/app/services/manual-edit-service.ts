import { Topic } from '@taucad/events';
import { sha256BytesSync } from '@taucad/utils/hash';
import { parseManualDocument, serializeManualDocument } from '@taucad/smlib/manual-operations';
import type { ManualDocument } from '@taucad/smlib/manual-operations';

type Bytes = Uint8Array<ArrayBuffer>;
type StoredRecord = Readonly<{ bytes: Bytes | undefined; document: ManualDocument }>;
type HistoryEntry = Readonly<{ before: StoredRecord; after: StoredRecord }>;

/** The selected checkout owns all reads, checked mutations and notifications. */
export type ManualEditAuthority = {
  read: () => Promise<Bytes | undefined>;
  replace: (input: {
    expected: Bytes | undefined;
    next: Bytes | undefined;
  }) => Promise<'applied' | 'unchanged' | 'conflict'>;
  watch: (changed: () => void) => {
    ready: Promise<void>;
    closed: Promise<unknown>;
    dispose: () => void;
  };
};

export type ManualEditSnapshot = Readonly<{
  document: ManualDocument | undefined;
  /** Exact stored bytes, for correlation with a successful runtime source revision. */
  contentDigest: string | undefined;
  loading: boolean;
  saving: boolean;
  error: string | undefined;
  canUndo: boolean;
  canRedo: boolean;
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const historyLimit = 50;
const emptyDocument = (): ManualDocument => ({ version: 1, operations: [] });
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const sameBytes = (left: Bytes | undefined, right: Bytes | undefined): boolean => {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.length === right.length && left.every((byte, i) => byte === right[i]);
};

export type ManualEditService = {
  getSnapshot: () => ManualEditSnapshot;
  subscribe: (listener: () => void) => () => void;
  connect: () => () => void;
  reload: () => Promise<boolean>;
  commit: (next: ManualDocument, base: ManualDocument | undefined) => Promise<boolean>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
};

/**
 * One manual sidecar, with a bounded local undo stack. The sidecar is the sole durable
 * model: history stores checked replacements, never source edits or global revisions.
 * Foreign bytes invalidate local undo, so it cannot roll back an agent's changes.
 */
export function createManualEditService(authority: ManualEditAuthority): ManualEditService {
  const changes = new Topic<void>({ name: 'manual-edits' });
  let snapshot: ManualEditSnapshot = {
    document: undefined,
    contentDigest: undefined,
    loading: true,
    saving: false,
    error: undefined,
    canUndo: false,
    canRedo: false,
  };
  let current: StoredRecord | undefined;
  let undoEntries: HistoryEntry[] = [];
  let redoEntries: HistoryEntry[] = [];
  let generation = 0;
  let connected = false;
  let writable = false;
  let tail: Promise<void> = Promise.resolve();

  const publish = (patch: Partial<ManualEditSnapshot>): void => {
    snapshot = {
      ...snapshot,
      ...patch,
      canUndo: writable && undoEntries.length > 0,
      canRedo: writable && redoEntries.length > 0,
    };
    changes.emit();
  };

  const assertConnected = (expectedGeneration: number): void => {
    if (!connected || generation !== expectedGeneration) {
      throw new Error('Il progetto è stato chiuso.');
    }
  };

  const readRecord = async (): Promise<StoredRecord> => {
    const bytes = await authority.read();
    return { bytes, document: bytes === undefined ? emptyDocument() : parseManualDocument(decoder.decode(bytes)) };
  };

  const refresh = async (expectedGeneration: number): Promise<void> => {
    const next = await readRecord();
    assertConnected(expectedGeneration);
    if (current === undefined || !sameBytes(current.bytes, next.bytes)) {
      current = next;
      undoEntries = [];
      redoEntries = [];
    }
    writable = true;
    publish({
      document: current.document,
      contentDigest: current.bytes === undefined ? 'missing' : `sha256:${sha256BytesSync(current.bytes)}`,
      loading: false,
      error: undefined,
    });
  };

  const enqueue = async (work: (expectedGeneration: number) => Promise<void>, saving = false): Promise<boolean> => {
    const expectedGeneration = generation;
    const run = async (): Promise<boolean> => {
      try {
        assertConnected(expectedGeneration);
        if (saving) {
          publish({ saving: true, error: undefined });
        }
        await work(expectedGeneration);
        return true;
      } catch (error) {
        if (connected && generation === expectedGeneration) {
          publish({ loading: false, error: messageOf(error) });
        }
        return false;
      } finally {
        if (saving && connected && generation === expectedGeneration) {
          publish({ saving: false });
        }
      }
    };
    const previous = tail;
    const result = (async () => {
      await previous;
      return run();
    })();
    tail = (async () => {
      await result;
    })();
    return result;
  };

  const reload = async (): Promise<boolean> =>
    enqueue(async (expectedGeneration) => {
      // A failed read cannot leave old geometry writable over unreadable foreign bytes.
      writable = false;
      await refresh(expectedGeneration);
    });

  const replace = async (next: StoredRecord, expectedGeneration: number): Promise<void> => {
    if (current === undefined || !writable) {
      throw new Error('Attendi il caricamento delle modifiche manuali.');
    }
    const before = current;
    let outcome: 'applied' | 'unchanged' | 'conflict';
    try {
      outcome = await authority.replace({ expected: before.bytes, next: next.bytes });
    } catch (error) {
      // A provider may commit and lose its reply. Recover from the same authority,
      // not by blindly retrying a whole-file write.
      writable = false;
      const recovered = await authority.read();
      assertConnected(expectedGeneration);
      if (!sameBytes(recovered, next.bytes)) {
        writable = false;
        await refresh(expectedGeneration);
        throw error;
      }
      writable = true;
      outcome = 'applied';
    }
    assertConnected(expectedGeneration);
    if (outcome === 'conflict') {
      writable = false;
      await refresh(expectedGeneration);
      throw new Error('Le modifiche sono cambiate altrove. Rivedi il risultato prima di applicare il tuo disegno.');
    }
    current = next;
    publish({
      document: next.document,
      contentDigest: next.bytes === undefined ? 'missing' : `sha256:${sha256BytesSync(next.bytes)}`,
      error: undefined,
    });
  };

  return {
    getSnapshot: (): ManualEditSnapshot => snapshot,
    subscribe: (listener: () => void): (() => void) => changes.subscribe(listener),
    /** Connect before reading, to close the initial read/watch race. Supports React effect replay. */
    connect: (): (() => void) => {
      const ownerGeneration = ++generation;
      connected = true;
      writable = false;
      publish({ loading: true, saving: false, error: undefined });
      let watch: ReturnType<ManualEditAuthority['watch']>;
      try {
        watch = authority.watch(() => {
          if (connected && generation === ownerGeneration) {
            // `reload` absorbs rejection and reports it through the observable snapshot.
            void reload();
          }
        });
      } catch (error) {
        publish({ loading: false, error: messageOf(error) });
        return () => {
          if (generation === ownerGeneration) {
            connected = false;
            generation += 1;
          }
        };
      }
      void enqueue(async (expectedGeneration) => {
        await watch.ready;
        assertConnected(expectedGeneration);
        await refresh(expectedGeneration);
      });
      const onClosed = (): void => {
        if (connected && generation === ownerGeneration) {
          // Fence pending reads as well as future writes. Otherwise a refresh
          // admitted before closure can restore writable after losing the watch.
          connected = false;
          writable = false;
          generation += 1;
          publish({ loading: false, error: 'Il collegamento ai file è stato interrotto. Riapri il progetto.' });
        }
      };
      const observeClosure = async (): Promise<void> => {
        try {
          await watch.closed;
        } catch {
          // A rejected lifetime is also a closed observation connection.
        }
        onClosed();
      };
      void observeClosure();
      return () => {
        if (generation === ownerGeneration) {
          connected = false;
          writable = false;
          generation += 1;
        }
        watch.dispose();
      };
    },
    reload,
    /** `base` is the exact document shown to the editor that produced this draft. */
    commit: async (next: ManualDocument, base: ManualDocument | undefined): Promise<boolean> =>
      enqueue(async (expectedGeneration) => {
        if (current === undefined || !writable || current.document !== base) {
          throw new Error('Il disegno di partenza è cambiato. Ricarica le modifiche prima di applicarle.');
        }
        const bytes = encoder.encode(serializeManualDocument(next));
        const validated = parseManualDocument(decoder.decode(bytes));
        if (sameBytes(bytes, current.bytes)) {
          return;
        }
        const before = current;
        const after = { bytes, document: validated };
        await replace(after, expectedGeneration);
        undoEntries = [...undoEntries, { before, after }].slice(-historyLimit);
        redoEntries = [];
        publish({});
      }, true),
    undo: async (): Promise<boolean> =>
      enqueue(async (expectedGeneration) => {
        const entry = undoEntries.at(-1);
        if (entry === undefined) {
          return;
        }
        await replace(entry.before, expectedGeneration);
        undoEntries = undoEntries.slice(0, -1);
        redoEntries = [...redoEntries, entry];
        publish({});
      }, true),
    redo: async (): Promise<boolean> =>
      enqueue(async (expectedGeneration) => {
        const entry = redoEntries.at(-1);
        if (entry === undefined) {
          return;
        }
        await replace(entry.after, expectedGeneration);
        redoEntries = redoEntries.slice(0, -1);
        undoEntries = [...undoEntries, entry];
        publish({});
      }, true),
  };
}
