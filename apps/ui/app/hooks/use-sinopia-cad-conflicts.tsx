import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@taucad/ui/components/button';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useProject } from '#hooks/use-project.js';
import { useRevisionClient } from '#hooks/use-revision-status.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import { downloadSinopiaCadObject } from '#services/sinopia-cad.js';
import type { SinopiaCadModel } from '#services/sinopia-cad.js';
import { readSinopiaConflicts, sinopiaConflictTopic } from '#services/sinopia-cad-conflicts.js';
import { applySinopiaRemoteSnapshot } from '#services/sinopia-cad-restore.js';
import { formatTime, useTranslation } from '#i18n/translate.js';
import { toast } from '#components/ui/sonner.js';

/** Object URLs have one mounted consumer and are revoked on account, path and project changes. */
export function useSinopiaCadPreview(model: SinopiaCadModel | undefined): string | undefined {
  const session = useSinopiaSession();
  const userId = session.status === 'signed-in' ? session.user.id : undefined;
  const [preview, setPreview] = useState<{ path: string; userId: string; url: string }>();
  useEffect(() => {
    if (model?.thumbnail_path === undefined || model.thumbnail_path === null || userId !== model.user_id) {
      return;
    }
    const thumbnailPath = model.thumbnail_path;
    let stopped = false;
    let url: string | undefined;
    const load = async (): Promise<void> => {
      try {
        const blob = await downloadSinopiaCadObject(model, thumbnailPath);
        if (stopped) {
          return;
        }
        url = URL.createObjectURL(blob);
        setPreview({ path: thumbnailPath, userId: model.user_id, url });
      } catch {
        /* An unavailable preview leaves its labelled placeholder. */
      }
    };
    void load();
    return () => {
      stopped = true;
      if (url !== undefined) {
        URL.revokeObjectURL(url);
      }
    };
  }, [model, userId]);
  return preview !== undefined && preview.path === model?.thumbnail_path && preview.userId === userId
    ? preview.url
    : undefined;
}

/** Mounted inside the existing Versions owner: the other device's losing copies remain visible and recoverable. */
export function SinopiaConflictVersions(): React.JSX.Element | undefined {
  const { projectId } = useProject();
  const fileManager = useFileManager();
  const revision = useRevisionClient();
  const session = useSinopiaSession();
  const userId = session.status === 'signed-in' ? session.user.id : undefined;
  const { t, language } = useTranslation();
  const [restoring, setRestoring] = useState<string>();
  const scope = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    scope.current = abort;
    return () => {
      abort.abort();
    };
  }, [projectId, userId]);
  const { data = [], refetch } = useQuery({
    queryKey: ['sinopia-cad-conflicts', userId, projectId],
    enabled: userId !== undefined,
    queryFn: async () => (userId === undefined ? [] : readSinopiaConflicts(fileManager.recordFiles, projectId, userId)),
  });
  useEffect(
    () =>
      sinopiaConflictTopic.subscribe((changed) => {
        if (changed === projectId) {
          void refetch();
        }
      }),
    [projectId, refetch],
  );
  if (userId === undefined || data.length === 0) {
    return undefined;
  }
  return (
    <section aria-label={t('sinopiaSync.retainedTitle')} className='border-b p-3'>
      <h3 className='mb-2 text-xs font-medium'>{t('sinopiaSync.retainedTitle')}</h3>
      <ul className='space-y-2'>
        {data.map((model) => (
          <li key={model.snapshot_path} className='flex items-center justify-between gap-2 text-xs'>
            <span>{t('sinopiaSync.retained', { time: formatTime(Date.parse(model.updated_at), language) })}</span>
            <Button
              size='xs'
              variant='outline'
              disabled={restoring !== undefined || revision === undefined}
              onClick={async () => {
                if (revision === undefined) {
                  return;
                }
                setRestoring(model.id);
                const abort = scope.current;
                const active = (): boolean => {
                  const current = sinopiaSession().getState();
                  return (
                    abort !== undefined &&
                    !abort.signal.aborted &&
                    current.status === 'signed-in' &&
                    current.user.id === model.user_id
                  );
                };
                try {
                  await applySinopiaRemoteSnapshot({ model, fileManager, revision, active });
                  toast.success(t('sinopiaSync.restoreReady'));
                } catch {
                  toast.error(t('sinopiaSync.restoreFailed'));
                } finally {
                  setRestoring(undefined);
                }
              }}
            >
              {t('sinopiaSync.restore')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
