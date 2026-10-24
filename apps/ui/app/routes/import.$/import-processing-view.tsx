import { Check } from 'lucide-react';
import { ToolPage } from '#components/layout/tool-page.js';
import { Loader } from '@taucad/ui/components/loader';
import { formatFileSize } from '#components/geometry/converter/converter-utils.js';
import { Progress } from '@taucad/ui/components/progress';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey } from '#i18n/translate.js';

type ImportProcessingViewProperties = {
  readonly title: string;
  readonly phase: 'download' | 'extract' | 'read' | 'create';
  readonly source: 'github' | 'local';
  readonly localOperation?: 'read' | 'extract';
  readonly progress?: { processed: number; total: number };
  readonly downloadProgress?: { loaded: number; total: number };
  readonly isComplete?: boolean;
  readonly onCancel?: () => void;
};

function ProgressStep({
  state,
  label,
  detail,
  value,
}: {
  readonly state: 'done' | 'active' | 'todo';
  readonly label: string;
  readonly detail?: string;
  readonly value?: number;
}): React.JSX.Element {
  return (
    <li className='flex flex-col gap-2 py-3' aria-current={state === 'active' ? 'step' : undefined}>
      <div className='flex flex-wrap items-center justify-between gap-3 text-sm'>
        <span className='flex items-center gap-2'>
          {state === 'done' ? (
            <Check aria-hidden className='size-4' />
          ) : state === 'active' ? (
            <Loader className='size-4' />
          ) : (
            <span aria-hidden className='size-4 rounded-full border' />
          )}
          <span className={cn(state === 'todo' && 'text-muted-foreground')}>{label}</span>
        </span>
        {detail ? <span className='text-xs text-muted-foreground tabular-nums'>{detail}</span> : undefined}
      </div>
      {state === 'active' ? <Progress value={value} aria-label={label} className='h-1 bg-muted' /> : undefined}
    </li>
  );
}

function DownloadStep({
  isDownloading,
  progress,
}: {
  readonly isDownloading: boolean;
  readonly progress: { loaded: number; total: number };
}): React.JSX.Element {
  const { t, language } = useTranslation();
  const detail =
    progress.loaded > 0
      ? isDownloading && progress.total > 0
        ? `${formatFileSize(progress.loaded, language)} / ${formatFileSize(progress.total, language)}`
        : formatFileSize(progress.loaded, language)
      : undefined;
  return (
    <ProgressStep
      state={isDownloading ? 'active' : 'done'}
      label={isDownloading ? t('import.progress.downloading') : t('import.progress.downloaded')}
      detail={detail}
      value={progress.total > 0 ? (progress.loaded / progress.total) * 100 : undefined}
    />
  );
}

const fileStepLabels = {
  extract: {
    done: 'import.progress.extract.done',
    active: 'import.progress.extract.active',
    todo: 'import.progress.extract.todo',
  },
  read: { done: 'import.progress.read.done', active: 'import.progress.read.active', todo: 'import.progress.read.todo' },
} as const satisfies Record<'extract' | 'read', Record<'done' | 'active' | 'todo', PlainMessageKey>>;

/** Shows only progress reported by the import machines, with one active step. */
export function ImportProcessingView({
  title,
  phase,
  source,
  localOperation = 'read',
  progress = { processed: 0, total: 0 },
  downloadProgress = { loaded: 0, total: 0 },
  isComplete = false,
  onCancel,
}: ImportProcessingViewProperties): React.JSX.Element {
  const { t } = useTranslation();
  const isExtracting = source === 'github' || localOperation === 'extract';
  const fileStepState = phase === 'download' ? 'todo' : phase === 'create' ? 'done' : 'active';
  const fileStepLabel = t(fileStepLabels[isExtracting ? 'extract' : 'read'][fileStepState]);
  const statusLabel = isComplete ? t('import.progress.complete') : t('import.progress.importing');

  return (
    <ToolPage title={t('import.title')}>
      <section
        role='status'
        aria-label={statusLabel}
        aria-busy={!isComplete}
        className='grid gap-4 border-y py-6 md:grid-cols-[12rem_minmax(0,1fr)]'
      >
        <h2 className='flex items-center gap-2 self-start text-sm font-medium'>
          {isComplete ? <Check aria-hidden className='size-4 shrink-0' /> : undefined}
          {statusLabel}
        </h2>
        <div className='max-w-xl min-w-0 space-y-4'>
          <p className='text-sm font-medium break-all'>{title}</p>
          {isComplete ? (
            <p className='text-sm'>{t('import.progress.opening')}</p>
          ) : (
            <>
              <ol className='divide-y'>
                {source === 'github' ? (
                  <DownloadStep isDownloading={phase === 'download'} progress={downloadProgress} />
                ) : undefined}
                <ProgressStep
                  state={fileStepState}
                  label={fileStepLabel}
                  detail={
                    progress.total > 0
                      ? t('import.progress.count', { processed: progress.processed, total: progress.total })
                      : undefined
                  }
                  value={progress.total > 0 ? (progress.processed / progress.total) * 100 : undefined}
                />
                <ProgressStep
                  state={phase === 'create' ? 'active' : 'todo'}
                  label={phase === 'create' ? t('import.progress.creating') : t('import.progress.create')}
                />
              </ol>
              {onCancel ? (
                <Button variant='outline' onClick={onCancel}>
                  {t('import.progress.cancel')}
                </Button>
              ) : undefined}
            </>
          )}
        </div>
      </section>
    </ToolPage>
  );
}
