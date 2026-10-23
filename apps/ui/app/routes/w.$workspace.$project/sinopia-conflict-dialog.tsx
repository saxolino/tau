import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@taucad/ui/components/dialog';
import { Button } from '@taucad/ui/components/button';
import { useTranslation } from '#i18n/translate.js';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useProject } from '#hooks/use-project.js';
import { useSinopiaCadPreview } from '#hooks/use-sinopia-cad-conflicts.js';
import type { SinopiaCadModel } from '#services/sinopia-cad.js';

/** Two private previews and three explicit choices. Closing defers and never overwrites a head. */
export function SinopiaConflictDialog({
  remote,
  isOpen,
  isBusy,
  onOpenChange,
  resolve,
}: {
  readonly remote: SinopiaCadModel | undefined;
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly resolve: (choice: 'local' | 'remote' | 'defer') => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { projectId } = useProject();
  const { recordFiles } = useFileManager();
  const remotePreview = useSinopiaCadPreview(remote);
  const [localPreview, setLocalPreview] = useState<{ projectId: string; url: string }>();
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let disposed = false;
    let url: string | undefined;
    const read = async (): Promise<void> => {
      try {
        const path = `/projects/${projectId}/thumbnail.webp`;
        if (!(await recordFiles.exists(path))) {
          return;
        }
        const bytes = await recordFiles.readFile(path);
        if (disposed) {
          return;
        }
        url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
        setLocalPreview({ projectId, url });
      } catch {
        /* A missing local preview leaves its labelled placeholder. */
      }
    };
    void read();
    return () => {
      disposed = true;
      if (url !== undefined) {
        URL.revokeObjectURL(url);
      }
    };
  }, [isOpen, projectId, recordFiles]);
  const choose = (choice: 'local' | 'remote' | 'defer'): void => {
    if (choice === 'defer') {
      onOpenChange(false);
    }
    void resolve(choice);
  };
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!isBusy) {
          onOpenChange(next);
          if (!next) {
            choose('defer');
          }
        }
      }}
    >
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('sinopiaSync.conflictTitle')}</DialogTitle>
          <DialogDescription>{t('sinopiaSync.conflictDescription')}</DialogDescription>
        </DialogHeader>
        <div className='grid grid-cols-2 gap-3'>
          {[
            {
              label: t('sinopiaSync.local'),
              url: localPreview?.projectId === projectId ? localPreview.url : undefined,
            },
            { label: t('sinopiaSync.remote'), url: remotePreview },
          ].map(({ label, url }) => (
            <figure key={label} className='space-y-2'>
              <div className='flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border bg-muted text-center text-xs text-muted-foreground'>
                {url === undefined ? (
                  t('sinopiaSync.noPreview')
                ) : (
                  <img src={url} alt={label} className='size-full object-contain' />
                )}
              </div>
              <figcaption className='text-xs font-medium'>{label}</figcaption>
            </figure>
          ))}
        </div>
        <DialogFooter className='flex-wrap'>
          <Button
            variant='ghost'
            disabled={isBusy}
            onClick={() => {
              choose('defer');
            }}
          >
            {t('sinopiaSync.defer')}
          </Button>
          <Button
            variant='outline'
            disabled={isBusy}
            onClick={() => {
              choose('remote');
            }}
          >
            {t('sinopiaSync.keepRemote')}
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => {
              choose('local');
            }}
          >
            {t('sinopiaSync.keepLocal')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
