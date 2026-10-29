/* eslint-disable @typescript-eslint/naming-convention -- Fake Supabase HTTP rows retain their wire column names. */
import { mock } from 'vitest-mock-extended';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevisionStatusProjection } from '@taucad/revisions';
import type { SinopiaCadRestoreRevision, SinopiaCadRestoreFiles } from '#services/sinopia-cad-restore.js';
import type { SinopiaCadModel } from '#services/sinopia-cad.js';
import { applySinopiaRemoteSnapshot } from '#services/sinopia-cad-restore.js';

const transport = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('#services/sinopia-cad.js', () => ({ importSinopiaCadModel: transport.download }));
vi.mock('#lib/sinopia-data-client.js', () => ({ requireSinopiaUser: async () => undefined }));
const model: SinopiaCadModel = {
  id: '00000000-0000-4000-8000-000000000001',
  project_id: '00000000-0000-4000-8000-000000000002',
  user_id: '00000000-0000-4000-8000-000000000003',
  name: 'Ring',
  engine: 'smlib',
  head_revision_id: 'b'.repeat(40),
  snapshot_path: 'immutable',
  snapshot_bytes: 1,
  thumbnail_path: null,
  updated_at: '2026-10-23T10:00:00Z',
};
const create = () => {
  const status = mock<RevisionStatusProjection>({
    headRevisionId: 'a'.repeat(40),
    checkoutId: 'one',
    checkoutRoot: '/projects/one',
    dirty: false,
    minting: false,
    attention: 0,
    restore: { busy: false, asking: false, removedPathCount: 0, dirty: false, revisionNumber: undefined },
  });
  let current: RevisionStatusProjection = status;
  let cuts = 0;
  const revision = mock<SinopiaCadRestoreRevision>({
    status: () => current,
    snapshot: vi.fn(async () => ({ 'old.ts': 'old', 'main.ts': 'local' })),
    saveRevision: vi.fn(async () => {
      cuts += 1;
      if (cuts === 2) {
        current = { ...current, headRevisionId: 'c'.repeat(40) };
      }
    }),
  });
  const fileManager = mock<SinopiaCadRestoreFiles>({
    deleteFile: vi.fn(async () => undefined),
    writeFiles: vi.fn(async () => undefined),
  });
  return {
    revision,
    fileManager,
    status,
    setCurrent: (next: RevisionStatusProjection) => {
      current = next;
    },
  };
};
beforeEach(() => {
  transport.download.mockReset();
  transport.download.mockResolvedValue({
    files: { 'main.ts': { content: new Uint8Array([1]) }, '.tau/sinopia.json': { content: new Uint8Array([2]) } },
    link: { baseContentKey: 'f'.repeat(64) },
  });
});

describe('remote snapshot restore authority', () => {
  it('records the losing local state before mutations, excludes records, and confirms the replacement through revisions', async () => {
    const owner = create();
    const result = await applySinopiaRemoteSnapshot({ ...owner, model, active: () => true });
    // The new local head and the content it holds, so the queue knows the next identical revision is not a change.
    expect(result).toEqual({ revisionId: 'c'.repeat(40), contentKey: 'f'.repeat(64) });
    expect(owner.revision.saveRevision).toHaveBeenCalledTimes(2);
    expect(owner.fileManager.deleteFile).toHaveBeenCalledWith('old.ts', { source: 'user' });
    expect(owner.fileManager.writeFiles).toHaveBeenCalledWith({ 'main.ts': { content: new Uint8Array([1]) } });
    expect(vi.mocked(owner.revision.saveRevision).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(owner.fileManager.deleteFile).mock.invocationCallOrder[0]!,
    );
  });
  it('fences a closed project or different account while download is pending', async () => {
    const owner = create();
    let active = true;
    transport.download.mockImplementationOnce(async () => {
      active = false;
      return { files: {} };
    });
    await expect(applySinopiaRemoteSnapshot({ ...owner, model, active: () => active })).rejects.toThrow(
      'SINOPIA_SCOPE_CHANGED',
    );
    expect(owner.fileManager.deleteFile).not.toHaveBeenCalled();
    expect(owner.fileManager.writeFiles).not.toHaveBeenCalled();
  });
  it('refuses a checkout that moved while the immutable local snapshot was being read', async () => {
    const owner = create();
    vi.mocked(owner.revision.snapshot).mockImplementationOnce(async () => {
      owner.setCurrent({ ...owner.status, checkoutId: 'other' });
      return { 'old.ts': 'local' };
    });
    await expect(applySinopiaRemoteSnapshot({ ...owner, model, active: () => true })).rejects.toThrow(
      'SINOPIA_SCOPE_CHANGED',
    );
    expect(owner.fileManager.deleteFile).not.toHaveBeenCalled();
    expect(owner.fileManager.writeFiles).not.toHaveBeenCalled();
  });
  it('stops before a second mutation when the account scope changes after a delete; the local revision remains recorded', async () => {
    const owner = create();
    let active = true;
    vi.mocked(owner.fileManager.deleteFile).mockImplementationOnce(async () => {
      active = false;
    });
    await expect(applySinopiaRemoteSnapshot({ ...owner, model, active: () => active })).rejects.toThrow(
      'SINOPIA_SCOPE_CHANGED',
    );
    expect(owner.revision.saveRevision).toHaveBeenCalledOnce();
    expect(owner.fileManager.writeFiles).not.toHaveBeenCalled();
  });
});
