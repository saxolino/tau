import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, CircleAlertIcon } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@taucad/ui/components/dialog';
import { useTranslation } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import type { ExportFile } from '@taucad/types';
import { toast } from '#components/ui/sonner.js';
import { downloadExportArtifactSet } from '#utils/export-artifact-set.utils.js';
import { projectExportFormats } from '#services/project-export.types.js';
import type { PreparedExport, ProjectExportFormat, ProjectExportSketches } from '#services/project-export.types.js';
import type { ProjectExportRows } from '#services/project-export.js';

const isAborted = (signal: AbortSignal): boolean => signal.aborted;

const filesFor = (result: PreparedExport | undefined): ExportFile[] =>
  result === undefined ? [] : (result.files ?? []);

// The photo is taken at the click, so a ready photo row has no files yet.
const canDownload = (format: ProjectExportFormat, result: PreparedExport | undefined): boolean =>
  format === 'png' ? result?.status === 'ready' : filesFor(result).length > 0;

/** The reason a row needs fixing, naming the pieces its check listed. */
const fixMessage = (
  t: Translate,
  format: ProjectExportFormat,
  result: Extract<PreparedExport, { status: 'needsFix' }>,
): string => {
  const names = result.pieces?.join(', ') ?? '';
  if (result.problem === 'invalid' && result.pieces?.length) {
    return format === 'step'
      ? t('export.surfacePieces', { names })
      : t('export.openPieces', { count: result.pieces.length, names });
  }
  if (result.problem === 'names' && result.pieces?.length) {
    return t('export.differentNames', { names });
  }
  return t(`export.errors.${result.problem}`);
};

// STL pieces are closed for printing; STEP pieces get their surfaces corrected for production.
const askAgent = (t: Translate, format: ProjectExportFormat, names: string): { label: string; prompt: string } =>
  format === 'step'
    ? { label: t('export.askSurfaces'), prompt: t('export.surfacePrompt', { names }) }
    : { label: t('export.ask'), prompt: t('export.prompt', { names }) };

const downloadLabel = (t: Translate, format: ProjectExportFormat, hasOpenPieces: boolean): string => {
  if (format === 'stl' && hasOpenPieces) {
    return t('export.anyway');
  }
  return format === 'png' ? t('export.downloadPhoto') : t('export.download', { format: format.toUpperCase() });
};

type ExportDialogProps = {
  readonly name: string;
  readonly pieces: ReadonlyArray<{ name: string }>;
  readonly sketches?: ProjectExportSketches;
  readonly prepare: (
    format: ProjectExportFormat,
    selectedNames: string[] | undefined,
    signal: AbortSignal,
  ) => Promise<PreparedExport>;
  readonly capture: (signal: AbortSignal) => Promise<PreparedExport>;
  readonly onAskAgent: (message: string) => void;
  readonly onOpenChange: (open: boolean) => void;
};

/** Four independent results: a successful GLB never grants a STEP verification badge. */
export function ExportDialogView({
  name,
  pieces,
  sketches,
  prepare,
  capture,
  onAskAgent,
  onOpenChange,
}: ExportDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [selection, setSelection] = useState('all');
  const [attempt, setAttempt] = useState(0);
  const [prepared, setPrepared] = useState<{
    prepare: ExportDialogProps['prepare'];
    selection: string;
    attempt: number;
    rows: ProjectExportRows;
  }>();
  const [downloading, setDownloading] = useState<ProjectExportFormat>();
  const preparationLifetime = useRef<AbortController | undefined>(undefined);
  const rows: ProjectExportRows =
    prepared?.prepare === prepare && prepared.selection === selection && prepared.attempt === attempt
      ? prepared.rows
      : {};

  useEffect(() => {
    const controller = new AbortController();
    preparationLifetime.current = controller;
    const run = async (): Promise<void> => {
      for (const format of projectExportFormats) {
        if (isAborted(controller.signal)) {
          return;
        }
        // oxlint-disable-next-line no-await-in-loop -- Kernel exports share the document and must run serially.
        const result = await prepare(format, selection === 'all' ? undefined : [selection.slice(6)], controller.signal);
        if (!isAborted(controller.signal)) {
          setPrepared((previous) => ({
            prepare,
            selection,
            attempt,
            rows: {
              ...(previous?.prepare === prepare && previous.selection === selection && previous.attempt === attempt
                ? previous.rows
                : {}),
              [format]: result,
            },
          }));
        }
      }
    };
    void run();
    return () => {
      controller.abort();
    };
  }, [prepare, selection, attempt]);

  const download = useCallback(
    async (format: ProjectExportFormat): Promise<void> => {
      const controller = preparationLifetime.current;
      if (!controller || isAborted(controller.signal)) {
        return;
      }
      setDownloading(format);
      try {
        // Capture at the gesture so the PNG shows the camera as it is now.
        const result = format === 'png' ? await capture(controller.signal) : rows[format];
        if (isAborted(controller.signal)) {
          return;
        }
        const files = filesFor(result);
        if (files.length === 0) {
          toast.error(t('export.errors.capture'));
          return;
        }
        await downloadExportArtifactSet(files, {
          singleFileName: `${name}.${format}`,
          archiveName: `${name}-${format}.zip`,
        });
        toast.success(t('export.downloaded', { format: format === 'png' ? t('export.photo') : format.toUpperCase() }));
      } catch {
        toast.error(t('export.errors.prepare'));
      } finally {
        setDownloading(undefined);
      }
    },
    [capture, name, rows, t],
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-130 [&>button:last-child]:hidden'>
        <DialogHeader>
          <DialogTitle className='pr-8 break-words'>{t('export.title', { name })}</DialogTitle>
          <DialogDescription>{t('export.description')}</DialogDescription>
        </DialogHeader>
        {sketches === 'mixed' ? <p className='text-sm text-muted-foreground'>{t('export.sketchesExcluded')}</p> : null}
        <div className='divide-y'>
          {projectExportFormats.map((format) => {
            const result = rows[format];
            const status = result?.status ?? 'checking';
            const openPieces =
              result?.status === 'needsFix' && result.problem === 'invalid' ? result.pieces : undefined;
            const ask = openPieces?.length ? askAgent(t, format, openPieces.join(', ')) : undefined;
            const label = format === 'png' ? t('export.photo') : format.toUpperCase();
            return (
              <section key={format} aria-label={label} className='space-y-2 py-4'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <h3 className='text-sm font-semibold'>{label}</h3>
                  <span
                    role='status'
                    aria-label={`${label}: ${t(`export.${status}`)}`}
                    aria-busy={status === 'checking'}
                    className='flex items-center gap-1.5 text-xs text-muted-foreground'
                  >
                    {status === 'verified' ? <CheckIcon aria-hidden className='size-3.5 text-success' /> : null}
                    {status === 'needsFix' ? <CircleAlertIcon aria-hidden className='size-3.5 text-warning' /> : null}
                    {t(`export.${status}`)}
                  </span>
                </div>
                <p className='text-sm text-muted-foreground'>{t(`export.${format}`)}</p>
                {result?.status === 'needsFix' ? (
                  <p role='alert' aria-label={t('export.needsFix')} className='text-sm'>
                    {fixMessage(t, format, result)}
                  </p>
                ) : null}
                <div className='flex flex-wrap items-center gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    aria-busy={downloading === format}
                    className='pointer-coarse:min-h-11'
                    disabled={!canDownload(format, result) || downloading !== undefined}
                    onClick={() => {
                      void download(format);
                    }}
                  >
                    {downloadLabel(t, format, Boolean(openPieces?.length))}
                  </Button>
                  {ask ? (
                    <Button
                      variant='link'
                      size='sm'
                      className='max-w-full text-left whitespace-normal pointer-coarse:min-h-11'
                      onClick={() => {
                        onAskAgent(ask.prompt);
                      }}
                    >
                      {ask.label}
                    </Button>
                  ) : null}
                  {result?.status === 'needsFix' ? (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='pointer-coarse:min-h-11'
                      onClick={() => {
                        setAttempt((value) => value + 1);
                      }}
                    >
                      {t('common.retry')}
                    </Button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-xs text-muted-foreground'>
          <span>{t('export.units')}</span>
          <span>{t('export.scale')}</span>
          <label className='flex max-w-full min-w-0 items-center gap-2'>
            {t('export.pieces')}
            <select
              className='max-w-full min-w-0 rounded-md border bg-background p-2 text-foreground pointer-coarse:min-h-11'
              value={selection}
              onChange={(event) => {
                setSelection(event.target.value);
              }}
            >
              <option value='all'>{t('export.all')}</option>
              {pieces.map((piece) => (
                <option key={piece.name} value={`piece:${piece.name}`}>
                  {piece.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DialogClose asChild>
          <Button variant='ghost' size='sm' className='justify-self-end pointer-coarse:min-h-11'>
            {t('common.close')}
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
