/* eslint-disable @typescript-eslint/naming-convention -- Fake Supabase HTTP rows retain their wire column names. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSinopiaCadSync } from '#services/sinopia-cad-sync.js';
import type { SinopiaCadSyncObservation, SinopiaCadSyncPort } from '#services/sinopia-cad-sync.js';
import type { SinopiaCadLink, SinopiaCadModel } from '#services/sinopia-cad.js';

const first = 'a'.repeat(40);
const second = 'b'.repeat(40);
const third = 'c'.repeat(40);
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
  apply: vi.fn<SinopiaCadSyncPort['apply']>(async () => third),
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
    sync.observe(observation(first));
    await settle();
    expect(sync.getState().kind).toBe('conflict');
    await vi.advanceTimersByTimeAsync(5000);
    expect(port.save).not.toHaveBeenCalled();
    sync.dispose();
  });
  it('defers indefinitely and preserves the losing remote before explicitly keeping an unchanged local revision', async () => {
    const port = ports();
    port.read.mockResolvedValue(remote);
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation(first));
    await settle();
    await sync.resolve('defer');
    sync.observe(observation(first));
    await vi.advanceTimersByTimeAsync(5000);
    expect(port.persist).not.toHaveBeenCalled();
    await sync.resolve('local');
    expect(port.preserve).toHaveBeenCalledWith(remote);
    await vi.advanceTimersByTimeAsync(2000);
    expect(port.save).toHaveBeenCalledWith(
      expect.objectContaining({ baseRevisionId: second }),
      expect.objectContaining({ revisionId: first }),
    );
    sync.dispose();
  });
  it('keeps remote through the filesystem/revision owner and acknowledges the new local revision', async () => {
    const port = ports();
    port.read.mockResolvedValue(remote);
    const sync = createSinopiaCadSync(link, port);
    sync.observe(observation(first));
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
});
