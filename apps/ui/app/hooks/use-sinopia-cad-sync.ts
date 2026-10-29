import { base64ToUint8Array } from 'uint8array-extras';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useSelector } from '@xstate/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { Topic } from '@taucad/events';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useProject } from '#hooks/use-project.js';
import { useRevisionClient, useRevisionStatus } from '#hooks/use-revision-status.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
import {
  archiveSinopiaRevision,
  getSinopiaCadModel,
  linkSinopiaCadModel,
  readSinopiaCadLink,
  saveSinopiaCadRevision,
  sinopiaCadLocalId,
  writeSinopiaCadLink,
  inferSinopiaCadEngine,
  patchSinopiaCadThumbnail,
  moveSinopiaCadModel,
  reconcileSinopiaCadLink,
  sinopiaCadSnapshotContentKey,
  sourceFromRecognition,
} from '#services/sinopia-cad.js';
import { leggiRecordRiconoscimento, percorsoRiconoscimento } from '#services/riconoscimento-record.js';
import type { SinopiaCadEngine, SinopiaCadLink, SinopiaCadRecordFiles } from '#services/sinopia-cad.js';
import { createSinopiaCadSync } from '#services/sinopia-cad-sync.js';
import type { SinopiaCadSyncState } from '#services/sinopia-cad-sync.js';
import { preserveSinopiaConflict } from '#services/sinopia-cad-conflicts.js';
import { applySinopiaRemoteSnapshot } from '#services/sinopia-cad-restore.js';
import {
  readSinopiaCadThumbnail,
  sinopiaCadThumbnailReady,
  sinopiaCadThumbnailRequested,
} from '#services/sinopia-cad-thumbnail.js';

const linkKey = (userId: string | undefined, projectId: string): readonly unknown[] => [
  'sinopia-cad-link',
  userId,
  projectId,
];
const idleState: SinopiaCadSyncState = { kind: 'idle' };
const failedState: SinopiaCadSyncState = { kind: 'failed' };
const foreignState: SinopiaCadSyncState = { kind: 'foreign' };
const linkingState: SinopiaCadStatus = { kind: 'linking' };
const linkFailedState: SinopiaCadStatus = { kind: 'linkFailed' };
const noSubscribe = (): (() => void) => () => undefined;
const idle = (): SinopiaCadSyncState => idleState;

/** The save status in the top bar: the acknowledged Sinopia copy, or the link a model made before it still needs. */
export type SinopiaCadStatus = Omit<SinopiaCadSyncState, 'kind'> &
  Readonly<{ kind: SinopiaCadSyncState['kind'] | 'linking' | 'linkFailed' }>;
/** A link creation in flight or failed, per account and local project; absent once the link is persisted. */
export type SinopiaCadLinking = 'linking' | 'failed';

/* One creation per account and local project in this document, shared by the status and the send dialog, so a
   re-render, a StrictMode replay or a second gesture joins the attempt in flight instead of starting another. */
const linkings = new Map<string, SinopiaCadLinking>();
const linkingChanged = new Topic<void>({ name: 'SinopiaCadSync.linking' });
const linkingKey = (userId: string | undefined, projectId: string): string => `${userId ?? ''}:${projectId}`;
const subscribeLinking = (listener: () => void): (() => void) => linkingChanged.subscribe(listener);

async function startLinking(input: {
  userId: string;
  projectId: string;
  name: string;
  files: Pick<SinopiaCadRecordFiles, 'readFile' | 'exists' | 'writeFile'>;
  queryClient: QueryClient;
}): Promise<void> {
  const key = linkingKey(input.userId, input.projectId);
  if (linkings.get(key) === 'linking') {
    return;
  }
  linkings.set(key, 'linking');
  linkingChanged.emit();
  try {
    const link = await linkSinopiaCadModel({
      files: input.files,
      localProjectId: input.projectId,
      userId: input.userId,
      name: input.name,
    });
    sinopiaCadLocalId.set(link.userId, link.modelId, input.projectId);
    const current = sinopiaSession().getState();
    if (current.status === 'signed-in' && current.user.id === link.userId) {
      input.queryClient.setQueryData(linkKey(link.userId, input.projectId), link);
    }
    linkings.delete(key);
  } catch (error) {
    console.error('[sinopia] model link failed', error);
    linkings.set(key, 'failed');
  }
  linkingChanged.emit();
}

function useLinkQuery() {
  const { projectId } = useProject();
  const { recordFiles } = useFileManager();
  const session = useSinopiaSession();
  const userId = session.status === 'signed-in' ? session.user.id : undefined;
  return useQuery({
    queryKey: linkKey(userId, projectId),
    enabled: userId !== undefined,
    queryFn: async () => {
      await requireSinopiaUser(userId);
      const link = await readSinopiaCadLink(recordFiles, `/projects/${projectId}`);
      if (link !== undefined && link.userId !== userId) {
        throw new Error('SINOPIA_OWNER_MISMATCH');
      }
      if (link === undefined) {
        return null;
      }
      // A model moved to another project (an interrupted «cambia», another device): the link follows the row. Any
      // failure of this check (offline, a refused read) keeps the stored link: it must never turn the link itself into a
      // failure, which would also switch off the conflict protection. The next open checks again.
      try {
        return await reconcileSinopiaCadLink(recordFiles, `/projects/${projectId}`, link);
      } catch {
        return link;
      }
    },
    staleTime: Infinity,
  });
}

/**
 * «Progetto Sinopia: cambia»: move the open model to another project of the account (`moveSinopiaCadModel`), then
 * publish the new link so the save status and the send dialog follow it. A piece built from a Sinopia part that goes
 * back to the project of its recognition gets its origin (image and part) back from the record.
 */
export function useMoveSinopiaCadModel(): (link: SinopiaCadLink, targetProjectId: string) => Promise<SinopiaCadLink> {
  const { projectId } = useProject();
  const { recordFiles } = useFileManager();
  const queryClient = useQueryClient();
  return useCallback(
    async (link: SinopiaCadLink, targetProjectId: string): Promise<SinopiaCadLink> => {
      let record: Parameters<typeof sourceFromRecognition>[0]['record'] | undefined;
      try {
        const lettura = leggiRecordRiconoscimento(
          await recordFiles.readFile(`/projects/${projectId}/${percorsoRiconoscimento}`),
        );
        record = lettura.stato === 'ok' ? lettura.record : undefined;
      } catch {
        record = undefined;
      }
      const source =
        record === undefined
          ? undefined
          : await sourceFromRecognition({ record, targetProjectId, userId: link.userId });
      const moved = await moveSinopiaCadModel({
        link,
        targetProjectId,
        files: recordFiles,
        localProjectId: projectId,
        ...(source === undefined ? {} : { source }),
      });
      const current = sinopiaSession().getState();
      if (current.status === 'signed-in' && current.user.id === moved.userId) {
        queryClient.setQueryData(linkKey(moved.userId, projectId), moved);
      }
      void queryClient.invalidateQueries({ queryKey: ['sinopia-send-model', moved.userId, moved.modelId] });
      return moved;
    },
    [projectId, queryClient, recordFiles],
  );
}

/** The shared persisted link for the top bar's send gesture; no remote writes or second sync lifecycle. */
export function useSinopiaCadLink(): SinopiaCadLink | undefined {
  const query = useLinkQuery();
  const session = useSinopiaSession();
  return session.status === 'signed-in' && query.data?.userId === session.user.id ? query.data : undefined;
}

/**
 * A model made before the Sinopia link existed (it has no link record) joins Sinopia through the creation path new
 * models use: a project named after the model, in accessories, and the persisted link. The save status starts it
 * when the owner opens the model; the send dialog offers it as its gesture while the model is still unlinked.
 */
export function useSinopiaCadLinking(): Readonly<{
  name: string;
  state: SinopiaCadLinking | undefined;
  isUnlinked: boolean;
  start: () => void;
}> {
  const { projectId, projectRef } = useProject();
  const name = useSelector(projectRef, (snapshot) => snapshot.context.project?.name ?? '').trim();
  const { recordFiles } = useFileManager();
  const queryClient = useQueryClient();
  const linkQuery = useLinkQuery();
  const session = useSinopiaSession();
  const userId = session.status === 'signed-in' ? session.user.id : undefined;
  const key = linkingKey(userId, projectId);
  const state = useSyncExternalStore(
    subscribeLinking,
    () => linkings.get(key),
    () => undefined,
  );
  const isUnlinked = userId !== undefined && linkQuery.isSuccess && linkQuery.data === null;
  const start = useCallback(() => {
    if (userId !== undefined && name !== '') {
      void startLinking({ userId, projectId, name, files: recordFiles, queryClient });
    }
  }, [name, projectId, queryClient, recordFiles, userId]);
  return { name, state, isUnlinked, start };
}

/** The save status's share of linking: it starts once the project's root answers; a failure waits for «Riprova». */
function useLinkOnOpen(
  link: SinopiaCadLink | undefined,
  isReady: boolean,
): Readonly<{ status: SinopiaCadStatus | undefined; start: () => void }> {
  const { isUnlinked, state, start } = useSinopiaCadLinking();
  const shouldLink = isUnlinked && state === undefined && isReady;
  useEffect(() => {
    if (shouldLink) {
      start();
    }
  }, [shouldLink, start]);
  if (link !== undefined || state === undefined) {
    return { status: undefined, start };
  }
  return { status: state === 'linking' ? linkingState : linkFailedState, start };
}

/** Mount once in the save status. Revisions, account changes and unmount all fence the serialized remote queue. */
export function useSinopiaCadSync(): {
  link: SinopiaCadLink | undefined;
  state: SinopiaCadStatus;
  retry: () => void;
  resolve: (choice: 'local' | 'remote' | 'defer') => Promise<void>;
} {
  const { projectId, projectRef, geometryUnits, mainEntryPath } = useProject();
  const name = useSelector(projectRef, (snapshot) => snapshot.context.project?.name ?? '');
  const selectedEngine = useSelector(geometryUnits.get(mainEntryPath), (snapshot) => snapshot?.context.activeKernelId);
  const engine: SinopiaCadEngine | undefined =
    selectedEngine === 'smlib' ||
    selectedEngine === 'picovoxel' ||
    selectedEngine === 'replicad' ||
    selectedEngine === 'manifold'
      ? selectedEngine
      : undefined;
  const fileManager = useFileManager();
  const revision = useRevisionClient();
  const revisionStatus = useRevisionStatus();
  const linkQuery = useLinkQuery();
  const queryClient = useQueryClient();
  const session = useSinopiaSession();
  const userId = session.status === 'signed-in' ? session.user.id : undefined;
  const link = linkQuery.data?.userId === userId ? (linkQuery.data ?? undefined) : undefined;
  const createController = useCallback(() => {
    if (link === undefined || revision === undefined) {
      return undefined;
    }
    const abort = new AbortController();
    const active = (): boolean => {
      const current = sinopiaSession().getState();
      return !abort.signal.aborted && current.status === 'signed-in' && current.user.id === link.userId;
    };
    const persist = async (next: SinopiaCadLink): Promise<void> => {
      if (!active()) {
        throw new Error('SINOPIA_SCOPE_CHANGED');
      }
      await writeSinopiaCadLink(fileManager.recordFiles, `/projects/${projectId}`, next);
      // A model adopted by «find or create» opens here from now on.
      sinopiaCadLocalId.set(next.userId, next.modelId, projectId);
      if (active()) {
        queryClient.setQueryData(linkKey(next.userId, projectId), next);
      }
    };
    const sync = createSinopiaCadSync(link, {
      active,
      read: getSinopiaCadModel,
      persist,
      preserve: async (remote) => preserveSinopiaConflict(fileManager.recordFiles, projectId, remote),
      apply: async (model) => applySinopiaRemoteSnapshot({ model, fileManager, revision, active }),
      matchesBase: async (baseline, revisionId) =>
        baseline.baseContentKey !== undefined &&
        (await sinopiaCadSnapshotContentKey(await revision.snapshot(revisionId))) === baseline.baseContentKey,
      save: async (baseline, observation) => {
        const current = revision.status();
        let thumbnail: Uint8Array<ArrayBuffer> | undefined;
        if (
          current?.headRevisionId === observation.revisionId &&
          current.checkoutId !== undefined &&
          current.checkoutRoot !== undefined &&
          !current.dirty &&
          !current.minting
        ) {
          const stamp = {
            projectId,
            userId: link.userId,
            revisionId: observation.revisionId,
            checkoutId: current.checkoutId,
            checkoutRoot: current.checkoutRoot,
          };
          thumbnail = await readSinopiaCadThumbnail(fileManager.recordFiles, stamp);
          if (thumbnail === undefined) {
            sinopiaCadThumbnailRequested.emit(stamp);
          }
        }
        /* Nothing new to save, only the preview Sinopia still lacks: patched onto the remote head this local revision
           stands for (the same commit, or another commit of the same files opened from Sinopia). */
        if (
          baseline.baseRevisionId !== null &&
          (baseline.localRevisionId ?? baseline.baseRevisionId) === observation.revisionId
        ) {
          return patchSinopiaCadThumbnail({
            link: baseline,
            revisionId: baseline.baseRevisionId,
            thumbnail,
            signal: abort.signal,
            isCurrent: () =>
              active() &&
              revision.status()?.headRevisionId === observation.revisionId &&
              revision.status()?.checkoutId === current?.checkoutId,
          });
        }
        const immutable = await revision.snapshot(observation.revisionId);
        const main = immutable[mainEntryPath];
        const actual =
          main === undefined ? undefined : inferSinopiaCadEngine(new TextDecoder().decode(base64ToUint8Array(main)));
        if (!active()) {
          throw new Error('SINOPIA_SCOPE_CHANGED');
        }
        try {
          return await saveSinopiaCadRevision({
            link: baseline,
            revisionId: observation.revisionId,
            engine: actual ?? observation.engine,
            name: observation.name,
            snapshot: await archiveSinopiaRevision(immutable),
            contentKey: await sinopiaCadSnapshotContentKey(immutable),
            thumbnail,
            signal: abort.signal,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'SINOPIA_MODEL_MOVED' && active()) {
            // Moved to another project by another device: the link follows the row, and the queue remounts on it.
            const repaired = await reconcileSinopiaCadLink(fileManager.recordFiles, `/projects/${projectId}`, baseline);
            if (active() && repaired.projectId !== baseline.projectId) {
              queryClient.setQueryData(linkKey(repaired.userId, projectId), repaired);
            }
          }
          throw error;
        }
      },
    });
    return { sync, abort, link };
  }, [fileManager, link, mainEntryPath, projectId, queryClient, revision]);
  const [mounted, setMounted] = useState<ReturnType<typeof createController>>();
  useEffect(() => {
    const next = createController();
    // oxlint-disable-next-line react/set-state-in-effect -- A committed project/account scope owns this queue, including StrictMode effect replay.
    setMounted(next);
    return () => {
      next?.abort.abort();
      next?.sync.dispose();
    };
  }, [createController]);
  const controller = mounted?.link === link ? mounted : undefined;
  useEffect(
    () =>
      sinopiaCadThumbnailReady.subscribe((stamp) => {
        if (controller?.sync.getState().remote !== undefined) {
          return;
        }
        if (
          stamp.projectId === projectId &&
          stamp.userId === userId &&
          stamp.revisionId === revision?.status()?.headRevisionId
        ) {
          // Every open renders a thumbnail; Sinopia gets it only while its copy has none (`previewPending`).
          controller?.sync.refreshPreview();
        }
      }),
    [controller, projectId, revision, userId],
  );
  // A hidden tab may be closing: what is waiting goes to Sinopia now, not after the debounce.
  useEffect(() => {
    if (controller === undefined) {
      return;
    }
    const flushWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') {
        controller.sync.flush();
      }
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    globalThis.addEventListener('pagehide', flushWhenHidden);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      globalThis.removeEventListener('pagehide', flushWhenHidden);
    };
  }, [controller]);
  // Edits not in a revision yet: the top bar says them even before the revision exists.
  const unsaved = revisionStatus !== undefined && (revisionStatus.dirty || revisionStatus.minting);
  const busy =
    revisionStatus === undefined ||
    unsaved ||
    revisionStatus.restore.busy ||
    revisionStatus.restore.asking ||
    revisionStatus.attention > 0;
  useEffect(() => {
    controller?.sync.observe({ revisionId: revisionStatus?.headRevisionId, engine, name, busy, unsaved });
  }, [busy, controller, engine, name, revisionStatus?.headRevisionId, unsaved]);
  const state = useSyncExternalStore(
    controller?.sync.subscribe ?? noSubscribe,
    controller?.sync.getState ?? idle,
    idle,
  );
  // Only once the project's root answers is a missing link record authoritative.
  const linking = useLinkOnOpen(link, revisionStatus !== undefined);
  // Another account's link: «Riprova» could never help, so it is said once, in its own words.
  const linkFailure = linkQuery.error?.message === 'SINOPIA_OWNER_MISMATCH' ? foreignState : failedState;
  return {
    link,
    state: linkQuery.isError ? linkFailure : (linking.status ?? state),
    retry: () => {
      if (linkQuery.isError) {
        void linkQuery.refetch();
      } else if (linking.status === linkFailedState) {
        linking.start();
      } else {
        controller?.sync.retry();
      }
    },
    resolve: async (choice) => controller?.sync.resolve(choice),
  };
}
