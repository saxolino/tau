import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSelector } from '@xstate/react';
import { joinPath } from '@taucad/utils/path';
import { manualEntryPath } from '@taucad/smlib/manual-operations';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import { useOptionalFileManager } from '#hooks/use-file-manager.js';
import { createManualEditService } from '#services/manual-edit-service.js';
import type { ManualEditSnapshot } from '#services/manual-edit-service.js';

export type ManualEdits = ManualEditSnapshot & {
  commit: (next: ManualDocument) => Promise<boolean>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
};

/** Manual geometry in the selected checkout. Opening or switching sources never writes a file. */
export function useManualEdits(entryPath: string, enabled = true): ManualEdits {
  const fileManager = useOptionalFileManager();
  const parameterFiles = fileManager?.parameterFiles;
  const workbenchFiles = fileManager?.workbenchFiles;
  const contentService = fileManager?.contentService;
  const rootDirectory = useSelector(fileManager?.fileManagerRef, (state) => state?.context.rootDirectory ?? '');
  const service = useMemo(() => {
    const relativePath = manualEntryPath(entryPath);
    const path = joinPath(rootDirectory, relativePath);
    return createManualEditService({
      read: async () => {
        if (!parameterFiles) {
          throw new Error('Il collegamento ai file non è ancora pronto.');
        }
        return (await parameterFiles.exists(path)) ? parameterFiles.readFile(path) : undefined;
      },
      replace: async ({ expected, next }) => {
        if (!parameterFiles || !workbenchFiles) {
          throw new Error('Il collegamento ai file non è ancora pronto.');
        }
        const preconditions = [{ path, expected: expected ?? null }];
        const result =
          next === undefined
            ? await workbenchFiles.deleteFileChecked({ path, preconditions })
            : await parameterFiles.writeFileChecked({ path, preconditions, data: next });
        return result.status;
      },
      watch: (changed) => {
        if (contentService === undefined) {
          throw new Error('Il collegamento ai file non è ancora pronto.');
        }
        return contentService.watchReady({ paths: [relativePath] }, changed);
      },
    });
  }, [contentService, entryPath, parameterFiles, rootDirectory, workbenchFiles]);
  useEffect(() => (enabled ? service.connect() : undefined), [service, enabled]);
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const commit = useCallback(
    async (next: ManualDocument) => service.commit(next, snapshot.document),
    [service, snapshot.document],
  );
  return { ...snapshot, commit, undo: service.undo, redo: service.redo };
}
