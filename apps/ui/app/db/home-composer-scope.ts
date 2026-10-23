import { composerRecordPaths, recordAttachmentsPath } from '#db/composer-record-store.js';

/** One per-device Home composer namespace; an admitted Sinopia account never reads the legacy Tau draft. */
export function homeComposerScope(userId?: string): Readonly<{
  recordPath: string;
  attachmentDirectory: string;
}> {
  const recordPath =
    userId === undefined
      ? composerRecordPaths.newProject
      : `/.tau/composers/sinopia/${encodeURIComponent(userId)}/new-project.json`;
  return { recordPath, attachmentDirectory: recordAttachmentsPath(recordPath) };
}

/** Origin metadata sits beside the exact composer whose attachments it describes. */
export function sinopiaComposerOriginPath(attachmentDirectory: string): string {
  const suffix = '/attachments';
  if (
    !attachmentDirectory.startsWith('/.tau/composers/') ||
    !attachmentDirectory.endsWith(suffix) ||
    attachmentDirectory.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new Error('Invalid composer attachment directory');
  }
  return `${attachmentDirectory.slice(0, -suffix.length)}/sinopia-origin.json`;
}
