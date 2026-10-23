import { classify } from '@taucad/filesystem/path-registry';
import type { RevisionStatusProjection } from '@taucad/revisions';
import { importSinopiaCadModel } from '#services/sinopia-cad.js';
import type { SinopiaCadModel } from '#services/sinopia-cad.js';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
export type SinopiaCadRestoreFiles = {
  deleteFile: (path: string, options: { source: 'user' }) => Promise<void>;
  writeFiles: (files: Record<string, { content: Uint8Array<ArrayBuffer> }>) => Promise<void>;
};
export type SinopiaCadRestoreRevision = {
  status: () => RevisionStatusProjection | undefined;
  saveRevision: () => Promise<void>;
  snapshot: (revisionId: string) => Promise<Readonly<Record<string, string>>>;
};

/** Apply a validated remote snapshot through the existing filesystem and revision owners. Old local bytes stay in Versions. */
export async function applySinopiaRemoteSnapshot(input: {
  model: SinopiaCadModel;
  fileManager: SinopiaCadRestoreFiles;
  revision: SinopiaCadRestoreRevision;
  active: () => boolean;
}): Promise<string> {
  const { model, fileManager, revision, active } = input;
  const imported = await importSinopiaCadModel(model);
  if (!active()) {
    throw new Error('SINOPIA_SCOPE_CHANGED');
  }
  await revision.saveRevision();
  const before = revision.status();
  if (
    before?.dirty !== false ||
    before.minting ||
    before.restore.busy ||
    before.restore.asking ||
    before.attention > 0
  ) {
    throw new Error('SINOPIA_CHECKOUT_BUSY');
  }
  const assertCheckout = (): void => {
    const current = revision.status();
    if (
      !active() ||
      current?.checkoutId !== before.checkoutId ||
      current?.checkoutRoot !== before.checkoutRoot ||
      current?.headRevisionId !== before.headRevisionId ||
      current?.restore.busy === true ||
      current?.restore.asking === true
    ) {
      throw new Error('SINOPIA_SCOPE_CHANGED');
    }
  };
  const snapshot = before.headRevisionId === undefined ? {} : await revision.snapshot(before.headRevisionId);
  await requireSinopiaUser(model.user_id);
  if (!active()) {
    throw new Error('SINOPIA_SCOPE_CHANGED');
  }
  // Both complete versions are retained before the first mutation. Filesystem events reconcile manifest and entry owners.
  for (const path of Object.keys(snapshot)) {
    assertCheckout();
    if (classify(path).versioned && imported.files[path] === undefined) {
      // oxlint-disable-next-line no-await-in-loop -- Each delete is acknowledged by the filesystem owner before the replacement batch.
      await fileManager.deleteFile(path, { source: 'user' });
    }
  }
  assertCheckout();
  await requireSinopiaUser(model.user_id);
  assertCheckout();
  await fileManager.writeFiles(
    Object.fromEntries(Object.entries(imported.files).filter(([path]) => classify(path).versioned)),
  );
  await revision.saveRevision();
  const settled = revision.status();
  if (settled?.headRevisionId === undefined || settled.dirty || settled.minting || settled.attention > 0) {
    throw new Error('SINOPIA_RESTORE_NOT_CONFIRMED');
  }
  return settled.headRevisionId;
}
