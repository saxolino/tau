import { describe, expect, it, vi } from 'vitest';
import { serializeManualDocument } from '@taucad/smlib/manual-operations';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import { sha256BytesSync } from '@taucad/utils/hash';
import { createManualEditService } from '#services/manual-edit-service.js';
import type { ManualEditAuthority } from '#services/manual-edit-service.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const moved = (distance: number): ManualDocument => ({
  version: 1,
  operations: [{ id: 'move-body', type: 'translate', target: { name: 'Body' }, delta: [distance, 0, 0] }],
});
const encoded = (document: ManualDocument): Uint8Array<ArrayBuffer> =>
  encoder.encode(serializeManualDocument(document));

function fixture(initial?: Uint8Array<ArrayBuffer>) {
  let bytes = initial;
  let changed = (): void => undefined;
  let loseReply = false;
  const closed = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  ready.resolve();
  const dispose = vi.fn();
  const replace = vi.fn<ManualEditAuthority['replace']>(async ({ expected, next }) => {
    if (decoder.decode(expected) !== decoder.decode(bytes) || (expected === undefined) !== (bytes === undefined)) {
      return 'conflict';
    }
    bytes = next;
    changed();
    if (loseReply) {
      loseReply = false;
      throw new Error('Write reply lost');
    }
    return 'applied';
  });
  const authority: ManualEditAuthority = {
    read: async () => bytes,
    replace,
    watch: (listener) => {
      changed = listener;
      return { ready: ready.promise, closed: closed.promise, dispose };
    },
  };
  const service = createManualEditService(authority);
  const disconnect = service.connect();
  return {
    service,
    authority,
    disconnect,
    dispose,
    closed,
    bytes: () => bytes,
    external: (next: Uint8Array<ArrayBuffer> | undefined, notify = true): void => {
      bytes = next;
      if (notify) {
        changed();
      }
    },
    loseReply: (): void => {
      loseReply = true;
    },
  };
}

describe('manual edit persistence', () => {
  it('should expose the digest of exact foreign formatting and restore missing provenance on undo', async () => {
    const bytes = encoder.encode('{ "version": 1, "operations": [] }');
    const test = fixture(bytes);
    try {
      await test.service.reload();
      expect(test.service.getSnapshot().contentDigest).toBe(`sha256:${sha256BytesSync(bytes)}`);
      await test.service.commit(moved(3), test.service.getSnapshot().document);
      expect(test.service.getSnapshot().contentDigest).toBe(`sha256:${sha256BytesSync(encoded(moved(3)))}`);
      await test.service.undo();
      expect(test.service.getSnapshot().contentDigest).toBe(`sha256:${sha256BytesSync(bytes)}`);
    } finally {
      test.disconnect();
    }
  });
  it('should open without writing and restore the previous absence through undo and redo', async () => {
    const test = fixture();
    try {
      await test.service.reload();
      expect(test.service.getSnapshot().document).toEqual({ version: 1, operations: [] });
      expect(test.authority.replace).not.toHaveBeenCalled();
      expect(await test.service.commit(moved(12), test.service.getSnapshot().document)).toBe(true);
      await test.service.reload();
      expect(test.bytes()).toEqual(encoded(moved(12)));
      expect(test.service.getSnapshot().canUndo).toBe(true);
      expect(await test.service.undo()).toBe(true);
      expect(test.bytes()).toBeUndefined();
      expect(test.service.getSnapshot().canRedo).toBe(true);
      expect(await test.service.redo()).toBe(true);
      expect(test.bytes()).toEqual(encoded(moved(12)));
    } finally {
      test.disconnect();
    }
  });

  it('should undo an edited operation and discard redo when a new edit is committed', async () => {
    const test = fixture(encoded(moved(5)));
    try {
      await test.service.reload();
      await test.service.commit(moved(15), test.service.getSnapshot().document);
      await test.service.undo();
      expect(test.bytes()).toEqual(encoded(moved(5)));
      await test.service.commit(moved(25), test.service.getSnapshot().document);
      expect(test.service.getSnapshot().canRedo).toBe(false);
      expect(test.bytes()).toEqual(encoded(moved(25)));
    } finally {
      test.disconnect();
    }
  });

  it('should retain saved geometry after reopening without reconstructing a second undo history', async () => {
    const test = fixture();
    await test.service.reload();
    await test.service.commit(moved(9), test.service.getSnapshot().document);
    test.disconnect();
    const reopened = createManualEditService(test.authority);
    const disconnect = reopened.connect();
    try {
      await reopened.reload();
      expect(reopened.getSnapshot().document).toEqual(moved(9));
      expect(reopened.getSnapshot().canUndo).toBe(false);
      expect(reopened.getSnapshot().canRedo).toBe(false);
    } finally {
      disconnect();
    }
  });

  it('should refuse a stale draft and clear local history when an agent changes the sidecar', async () => {
    const test = fixture();
    try {
      await test.service.reload();
      await test.service.commit(moved(1), test.service.getSnapshot().document);
      const oldDocument = test.service.getSnapshot().document;
      test.external(encoded(moved(20)));
      await test.service.reload();
      expect(test.service.getSnapshot().canUndo).toBe(false);
      expect(await test.service.commit(moved(2), oldDocument)).toBe(false);
      expect(test.service.getSnapshot().error).toContain('partenza è cambiato');
      expect(test.bytes()).toEqual(encoded(moved(20)));
    } finally {
      test.disconnect();
    }
  });

  it('should check authoritative bytes even when an external change has not been observed', async () => {
    const test = fixture();
    try {
      await test.service.reload();
      const oldDocument = test.service.getSnapshot().document;
      test.external(encoded(moved(40)), false);
      expect(await test.service.commit(moved(3), oldDocument)).toBe(false);
      expect(test.bytes()).toEqual(encoded(moved(40)));
      expect(test.service.getSnapshot().document).toEqual(moved(40));
      expect(test.service.getSnapshot().error).toContain('cambiate altrove');
    } finally {
      test.disconnect();
    }
  });

  it('should preserve invalid foreign bytes and refuse commits and undo until repaired', async () => {
    const test = fixture();
    try {
      await test.service.reload();
      await test.service.commit(moved(2), test.service.getSnapshot().document);
      const invalid = encoder.encode('{"version":9000}');
      test.external(invalid);
      expect(await test.service.reload()).toBe(false);
      expect(test.service.getSnapshot().canUndo).toBe(false);
      expect(await test.service.commit(moved(3), test.service.getSnapshot().document)).toBe(false);
      expect(await test.service.undo()).toBe(false);
      expect(test.bytes()).toEqual(invalid);
    } finally {
      test.disconnect();
    }
  });

  it('should reconcile a committed write after its reply is lost and preserve undo', async () => {
    const test = fixture();
    try {
      await test.service.reload();
      test.loseReply();
      expect(await test.service.commit(moved(7), test.service.getSnapshot().document)).toBe(true);
      await test.service.reload();
      expect(test.service.getSnapshot().error).toBeUndefined();
      expect(test.service.getSnapshot().canUndo).toBe(true);
      await test.service.undo();
      expect(test.bytes()).toBeUndefined();
    } finally {
      test.disconnect();
    }
  });

  it('should reject writes after closure and reconnect safely when React replays an effect', async () => {
    const test = fixture();
    await test.service.reload();
    test.disconnect();
    expect(test.dispose).toHaveBeenCalledOnce();
    expect(await test.service.commit(moved(1), test.service.getSnapshot().document)).toBe(false);
    expect(test.bytes()).toBeUndefined();
    const disconnect = test.service.connect();
    try {
      await test.service.reload();
      expect(await test.service.commit(moved(8), test.service.getSnapshot().document)).toBe(true);
      expect(test.bytes()).toEqual(encoded(moved(8)));
    } finally {
      disconnect();
    }
  });

  it('should refuse mutations after its watch closes even if an old refresh finishes later', async () => {
    const test = fixture();
    try {
      await test.service.reload();
      const pendingRead = Promise.withResolvers<Uint8Array<ArrayBuffer> | undefined>();
      test.authority.read = async () => pendingRead.promise;
      const refreshing = test.service.reload();
      await Promise.resolve();
      test.closed.resolve();
      await Promise.resolve();
      pendingRead.resolve(undefined);
      await refreshing;
      expect(await test.service.commit(moved(4), test.service.getSnapshot().document)).toBe(false);
      expect(test.bytes()).toBeUndefined();
      expect(test.authority.replace).not.toHaveBeenCalled();
    } finally {
      test.disconnect();
    }
  });

  it('should limit undo to the last fifty successful edits', async () => {
    const test = fixture();
    try {
      await test.service.reload();
      for (let distance = 1; distance <= 52; distance += 1) {
        // oxlint-disable-next-line no-await-in-loop -- Each draft is based on the preceding saved document.
        expect(await test.service.commit(moved(distance), test.service.getSnapshot().document)).toBe(true);
      }
      for (let index = 0; index < 50; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- Undo is deliberately sequential.
        expect(await test.service.undo()).toBe(true);
      }
      expect(test.bytes()).toEqual(encoded(moved(2)));
      expect(test.service.getSnapshot().canUndo).toBe(false);
      expect(test.service.getSnapshot().canRedo).toBe(true);
    } finally {
      test.disconnect();
    }
  });
});
