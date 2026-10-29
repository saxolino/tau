/* eslint-disable @typescript-eslint/naming-convention -- Fake Supabase HTTP rows retain their wire column names. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSinopiaCadSync } from '#services/sinopia-cad-sync.js';
import type { SinopiaCadSyncObservation, SinopiaCadSyncPort } from '#services/sinopia-cad-sync.js';
import type { SinopiaCadLink, SinopiaCadModel } from '#services/sinopia-cad.js';

const first = 'a'.repeat(40);
const second = 'b'.repeat(40);
const third = 'c'.repeat(40);
const fourth = 'd'.repeat(40);
const link: SinopiaCadLink = {
  modelId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
  baseRevisionId: first,
};
const remote: SinopiaCadModel = {
  id: link.modelId,
  project_id: link.projectId,
  user_id: link.userId,
  name: 'Ring',
  engine: 'smlib',
  head_revision_id: second,
  snapshot_path: `projects/${link.projectId}/cad/${link.modelId}/saves/remote/model.zip`,
  thumbnail_path: null,
  snapshot_bytes: 12,
  updated_at: '2026-10-23T10:00:00Z',
};
const ports = () => ({
  active: vi.fn(() => true),
  read: vi.fn<SinopiaCadSyncPort['read']>(async () => undefined),
  save: vi.fn<SinopiaCadSyncPort['save']>(async (baseline, observation) => ({
    kind: 'saved',
    link: { ...baseline, baseRevisionId: observation.revisionId },
    at: 123,
  })),
  persist: vi.fn<SinopiaCadSyncPort['persist']>(async () => undefined),
  preserve: vi.fn<SinopiaCadSyncPort['preserve']>(async () => undefined),
  apply: vi.fn<SinopiaCadSyncPort['apply']>(async () => ({ revisionId: third })),
});
const observation = (revisionId = second): SinopiaCadSyncObservation => ({
  revisionId,
  engine: 'smlib',
  name: 'Ring',
  busy: false,
});
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Sinopia revision queue', () => {
  it('debounces real revisions for 2000 ms and persists only acknowledged heads', async () => {
    const port = ports();
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation());
    await settle();
    await vi.advanceTimersByTimeAsync(1999);
    expect(port.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(port.save).toHaveBeenCalledOnce();
    expect(port.persist).toHaveBeenCalledWith({
      ...link,
      baseRevisionId: second,
      localRevisionId: second,
      previewPending: false,
    });
    expect(sync.getState()).toEqual({ kind: 'saved', at: 123 });
    sync.dispose();
  });
  it('coalesces edits and blocks dirty or restoring checkouts', async () => {
    const port = ports();
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation());
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    sync.observe({ ...observation(third), busy: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(port.save).not.toHaveBeenCalled();
    sync.observe(observation(third));
    await vi.advanceTimersByTimeAsync(2000);
    expect(port.save.mock.calls[0]?.[1].revisionId).toBe(third);
    sync.dispose();
  });
  it('serializes overlapping saves and follows with the newest revision', async () => {
    const port = ports();
    let finish: (() => void) | undefined;
    port.save.mockImplementationOnce(async (baseline, current) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { kind: 'saved', link: { ...baseline, baseRevisionId: current.revisionId }, at: 1 };
    });
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation());
    await vi.advanceTimersByTimeAsync(2000);
    sync.observe(observation(third));
    await vi.advanceTimersByTimeAsync(4000);
    expect(port.save).toHaveBeenCalledOnce();
    finish?.();
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(port.save).toHaveBeenCalledTimes(2);
    expect(port.save.mock.calls[1]?.[0].baseRevisionId).toBe(second);
    sync.dispose();
  });
  it('detects remote divergence on open without waiting for an edit', async () => {
    const port = ports();
    port.read.mockResolvedValue(remote);
    const sync = createSinopiaCadSync(link, port);
    // A revision of this computer Sinopia does not have, and a newer copy there: a real conflict.
    sync.observe(observation(fourth));
    await settle();
    expect(sync.getState().kind).toBe('conflict');
    await vi.advanceTimersByTimeAsync(5000);
    expect(port.save).not.toHaveBeenCalled();
    sync.dispose();
  });
  it('defers indefinitely and preserves the losing remote before explicitly keeping the local revision', async () => {
    const port = ports();
    port.read.mockResolvedValue(remote);
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation(fourth));
    await settle();
    await sync.resolve('defer');
    sync.observe(observation(fourth));
    await vi.advanceTimersByTimeAsync(5000);
    expect(port.persist).not.toHaveBeenCalled();
    await sync.resolve('local');
    expect(port.preserve).toHaveBeenCalledWith(remote);
    await vi.advanceTimersByTimeAsync(2000);
    expect(port.save).toHaveBeenCalledWith(
      expect.objectContaining({ baseRevisionId: second }),
      expect.objectContaining({ revisionId: fourth }),
    );
    sync.dispose();
  });
  it('keeps remote through the filesystem/revision owner and acknowledges the new local revision', async () => {
    const port = ports();
    port.read.mockResolvedValue(remote);
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation(fourth));
    await settle();
    await sync.resolve('remote');
    expect(port.preserve).toHaveBeenCalledWith(remote);
    expect(port.apply).toHaveBeenCalledWith(remote);
    expect(port.persist).toHaveBeenCalledWith({ ...link, baseRevisionId: second, localRevisionId: third });
    await vi.advanceTimersByTimeAsync(5000);
    expect(port.save).not.toHaveBeenCalled();
    sync.dispose();
  });
  it('asks again if another device changed after the decision was drawn', async () => {
    const port = ports();
    port.read.mockResolvedValueOnce(remote).mockResolvedValueOnce({ ...remote, head_revision_id: third });
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation());
    await settle();
    await sync.resolve('local');
    expect(sync.getState().remote?.head_revision_id).toBe(third);
    expect(port.preserve).not.toHaveBeenCalled();
    sync.dispose();
  });
  it('offers retry and does not poison the queue after an upload failure', async () => {
    const port = ports();
    port.save.mockRejectedValueOnce(new Error('offline'));
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation());
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.getState().kind).toBe('failed');
    sync.retry();
    await settle();
    expect(sync.getState().kind).toBe('saved');
    sync.dispose();
  });
  it('retries only the local record after remote CAS succeeded but baseline persistence failed', async () => {
    const port = ports();
    port.persist.mockRejectedValueOnce(new Error('disk'));
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation());
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.getState().kind).toBe('failed');
    sync.retry();
    await settle();
    expect(port.save).toHaveBeenCalledOnce();
    expect(port.persist).toHaveBeenCalledTimes(2);
    expect(sync.getState().kind).toBe('saved');
    sync.dispose();
  });
  it.each(['dispose', 'account'] as const)('fences pending completions after %s', async (reason) => {
    const port = ports();
    let finish: (() => void) | undefined;
    port.save.mockImplementationOnce(async (baseline) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { kind: 'saved', link: baseline, at: 1 };
    });
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation());
    await vi.advanceTimersByTimeAsync(2000);
    if (reason === 'dispose') {
      sync.dispose();
    } else {
      port.active.mockReturnValue(false);
    }
    finish?.();
    await settle();
    expect(port.persist).not.toHaveBeenCalled();
    sync.dispose();
  });

  describe('29 ott: what the top bar says and when it saves', () => {
    it('never says «Salvato su Sinopia» over work that only exists on this computer (difetto 2)', async () => {
      const port = ports();
      const sync = createSinopiaCadSync({ ...link, baseRevisionId: second, localRevisionId: second }, port);
      sync.observe(observation(second));
      await settle();
      expect(sync.getState().kind).toBe('saved');
      // Edits not in a revision yet (the five-minute window used to hide them behind «Salvato»).
      sync.observe({ ...observation(second), busy: true, unsaved: true });
      expect(sync.getState().kind).toBe('pending');
      // A revision of them, not yet uploaded.
      sync.observe(observation(third));
      expect(sync.getState().kind).toBe('pending');
      await vi.advanceTimersByTimeAsync(2000);
      expect(sync.getState().kind).toBe('saved');
      sync.dispose();
    });
    it('saves at once when the tab is hidden, without the debounce (difetto 2)', async () => {
      const port = ports();
      const sync = createSinopiaCadSync({ ...link, baseRevisionId: second, localRevisionId: second }, port);
      sync.observe(observation(second));
      await settle();
      // Hidden while the close cut is still minting: the revision that comes out goes up immediately.
      sync.observe({ ...observation(second), busy: true, unsaved: true });
      sync.flush();
      sync.observe(observation(third));
      await settle();
      expect(port.save).toHaveBeenCalledOnce();
      expect(port.save.mock.calls[0]?.[1].revisionId).toBe(third);
      sync.dispose();
    });
    it('sends a late preview only while Sinopia has none, not on every open (difetto 6)', async () => {
      const port = ports();
      const saved = createSinopiaCadSync({ ...link, baseRevisionId: second, localRevisionId: second }, port);
      saved.observe(observation(second));
      await settle();
      saved.refreshPreview();
      await vi.advanceTimersByTimeAsync(5000);
      expect(port.save).not.toHaveBeenCalled();
      expect(saved.getState().kind).toBe('saved');
      saved.dispose();
      const missing = createSinopiaCadSync(
        { ...link, baseRevisionId: second, localRevisionId: second, previewPending: true },
        port,
      );
      missing.observe(observation(second));
      await vi.advanceTimersByTimeAsync(2000);
      expect(port.save).toHaveBeenCalledOnce();
      missing.refreshPreview();
      await vi.advanceTimersByTimeAsync(5000);
      // Acknowledged with a preview: nothing more until a new revision.
      expect(port.save).toHaveBeenCalledOnce();
      missing.dispose();
    });
    it('takes the newer Sinopia copy by itself when nothing changed here (difetto 8)', async () => {
      const port = ports();
      port.read.mockResolvedValue(remote);
      const sync = createSinopiaCadSync(link, port);
      sync.observe(observation(first));
      await settle();
      expect(port.apply).toHaveBeenCalledWith(remote);
      expect(port.preserve).not.toHaveBeenCalled();
      expect(port.persist).toHaveBeenCalledWith({ ...link, baseRevisionId: second, localRevisionId: third });
      expect(sync.getState()).toEqual({ kind: 'saved', at: Date.parse(remote.updated_at) });
      await vi.advanceTimersByTimeAsync(5000);
      expect(port.save).not.toHaveBeenCalled();
      sync.dispose();
    });
    it('counts another commit of the same files as «nothing changed» (difetti 7–8)', async () => {
      const port = ports();
      port.read.mockResolvedValue(remote);
      const matchesBase = vi.fn<NonNullable<SinopiaCadSyncPort['matchesBase']>>(async () => true);
      const sync = createSinopiaCadSync({ ...link, baseContentKey: 'e'.repeat(64) }, { ...port, matchesBase });
      // The model opened from Sinopia on this computer: its first revision has another id, the same content.
      sync.observe(observation(fourth));
      await settle();
      expect(matchesBase).toHaveBeenCalledWith(expect.objectContaining({ modelId: link.modelId }), fourth);
      expect(port.apply).toHaveBeenCalledWith(remote);
      expect(sync.getState().kind).toBe('saved');
      sync.dispose();
    });
    it('waits for edits in flight before deciding, and asks when there are some', async () => {
      const port = ports();
      port.read.mockResolvedValue(remote);
      const sync = createSinopiaCadSync(link, port);
      sync.observe({ ...observation(first), busy: true, unsaved: true });
      await settle();
      expect(port.apply).not.toHaveBeenCalled();
      expect(sync.getState().kind).toBe('conflict');
      sync.dispose();
    });
    it.each([
      ['tooLarge', new Error('ARCHIVE_TOO_LARGE')],
      ['tooLarge', new Error('The revision is too large to preview.')],
      ['deleted', new Error('SINOPIA_MODEL_DELETED')],
      ['foreign', new Error('SINOPIA_OWNER_MISMATCH')],
    ] as const)(
      'stops on a permanent refusal (%s) instead of retrying every minute (difetti 12, 28)',
      async (kind, error) => {
        const port = ports();
        port.save.mockRejectedValue(error);
        const sync = createSinopiaCadSync(link, port);
        sync.observe(observation());
        await vi.advanceTimersByTimeAsync(2000);
        expect(sync.getState().kind).toBe(kind);
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(port.save).toHaveBeenCalledOnce();
        if (kind === 'tooLarge') {
          // A new revision may fit again: it is tried once more.
          sync.observe(observation(third));
          await vi.advanceTimersByTimeAsync(2000);
          expect(port.save).toHaveBeenCalledTimes(2);
        }
        sync.dispose();
      },
    );
    it('a «too large» refusal is about the revision that was sent, not the one minted while it was in flight', async () => {
      const port = ports();
      let refuse: (error: Error) => void = () => undefined;
      port.save.mockImplementationOnce(
        async () =>
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
      );
      const sync = createSinopiaCadSync(link, port);
      sync.observe(observation(second));
      await vi.advanceTimersByTimeAsync(2000);
      expect(port.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ revisionId: second }));
      // The person keeps working: a smaller revision is minted while the upload of the big one is still in flight.
      sync.observe(observation(third));
      refuse(new Error('ARCHIVE_TOO_LARGE'));
      await settle();
      expect(sync.getState().kind).toBe('tooLarge');
      // The refusal was about `second`: `third` is a new revision and is tried, not kept «too large» for nothing.
      sync.observe(observation(third));
      await vi.advanceTimersByTimeAsync(2000);
      expect(port.save).toHaveBeenCalledTimes(2);
      expect(port.save).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ revisionId: third }));
      expect(sync.getState().kind).toBe('saved');
      sync.dispose();
    });
    it('does not claim a failed save when Sinopia is unreachable and nothing waits to be saved (difetto 28)', async () => {
      const port = ports();
      port.read.mockRejectedValue(new TypeError('Failed to fetch'));
      const saved = { ...link, baseRevisionId: second, localRevisionId: second };
      const idle = createSinopiaCadSync(saved, port);
      idle.observe(observation(second));
      await settle();
      expect(idle.getState().kind).toBe('unreachable');
      idle.observe(observation(third));
      expect(idle.getState().kind).toBe('failed');
      idle.dispose();
    });
    it('works on the model the part already became instead of making a second one (difetto 10)', async () => {
      const port = ports();
      const adopted: SinopiaCadLink = {
        ...link,
        modelId: '00000000-0000-4000-8000-000000000009',
        baseRevisionId: null,
      };
      port.save.mockRejectedValueOnce(Object.assign(new Error('SINOPIA_ORIGIN_TAKEN'), { adopted }));
      port.read.mockImplementation(async (current) =>
        current.modelId === adopted.modelId ? { ...remote, id: adopted.modelId } : undefined,
      );
      const sync = createSinopiaCadSync({ ...link, baseRevisionId: null }, port);
      sync.observe(observation());
      await vi.advanceTimersByTimeAsync(2000);
      expect(port.persist).toHaveBeenCalledWith(adopted);
      expect(sync.getLink()).toEqual(adopted);
      // Checked again on the adopted model: its copy and this computer's differ, so the person chooses.
      expect(port.read).toHaveBeenLastCalledWith(adopted);
      expect(sync.getState().kind).toBe('conflict');
      sync.dispose();
    });
  });
});
