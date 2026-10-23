import { base64ToUint8Array } from 'uint8array-extras';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useSelector } from '@xstate/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useProject } from '#hooks/use-project.js';
import { useRevisionClient, useRevisionStatus } from '#hooks/use-revision-status.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
import {
  archiveSinopiaRevision,
  getSinopiaCadModel,
  readSinopiaCadLink,
  saveSinopiaCadRevision,
  writeSinopiaCadLink,
  inferSinopiaCadEngine,
  patchSinopiaCadThumbnail,
} from '#services/sinopia-cad.js';
import type { SinopiaCadEngine, SinopiaCadLink } from '#services/sinopia-cad.js';
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
const noSubscribe = (): (() => void) => () => undefined;
const idle = (): SinopiaCadSyncState => idleState;

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
      return link ?? null;
    },
    staleTime: Infinity,
  });
}

/** The shared persisted link for the top bar's send gesture; no remote writes or second sync lifecycle. */
export function useSinopiaCadLink(): SinopiaCadLink | undefined {
  const query = useLinkQuery();
  const session = useSinopiaSession();
  return session.status === 'signed-in' && query.data?.userId === session.user.id ? query.data : undefined;
}

/** Mount once in the save status. Revisions, account changes and unmount all fence the serialized remote queue. */
export function useSinopiaCadSync(): {
  link: SinopiaCadLink | undefined;
  state: SinopiaCadSyncState;
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
        if (baseline.baseRevisionId === observation.revisionId) {
          return patchSinopiaCadThumbnail({
            link: baseline,
            revisionId: observation.revisionId,
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
        return saveSinopiaCadRevision({
          link: baseline,
          revisionId: observation.revisionId,
          engine: actual ?? observation.engine,
          name: observation.name,
          snapshot: await archiveSinopiaRevision(immutable),
          thumbnail,
          signal: abort.signal,
        });
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
          controller?.sync.retry();
        }
      }),
    [controller, projectId, revision, userId],
  );
  const busy =
    revisionStatus === undefined ||
    revisionStatus.dirty ||
    revisionStatus.minting ||
    revisionStatus.restore.busy ||
    revisionStatus.restore.asking ||
    revisionStatus.attention > 0;
  useEffect(() => {
    controller?.sync.observe({ revisionId: revisionStatus?.headRevisionId, engine, name, busy });
  }, [busy, controller, engine, name, revisionStatus?.headRevisionId]);
  const state = useSyncExternalStore(
    controller?.sync.subscribe ?? noSubscribe,
    controller?.sync.getState ?? idle,
    idle,
  );
  return {
    link,
    state: linkQuery.isError ? failedState : state,
    retry: () => {
      if (linkQuery.isError) {
        void linkQuery.refetch();
      } else {
        controller?.sync.retry();
      }
    },
    resolve: async (choice) => controller?.sync.resolve(choice),
  };
}
