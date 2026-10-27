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
import type { PlainMessageKey, Translate } from '#i18n/translate.js';
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
    return isExact(format)
      ? t('export.surfacePieces', { names })
      : t(result.pieces.length === 1 ? 'export.openPiecesOne' : 'export.openPieces', {
          count: result.pieces.length,
          names,
        });
  }
  if (result.problem === 'names' && result.pieces?.length) {
    return t('export.differentNames', { names });
  }
  if (result.problem === 'volume' && result.pieces?.length) {
    return t('export.volumePieces', { names });
  }
  return t(`export.errors.${result.problem}` as PlainMessageKey);
};

/** STEP and IGES carry exact surfaces: their invalid pieces get their surfaces corrected; STL pieces get closed. */
const isExact = (format: ProjectExportFormat): boolean => format === 'step' || format === 'iges';

/** The row's name: the format, the photo, the PDF sheet. */
const formatLabel = (t: Translate, format: ProjectExportFormat): string => {
  if (format === 'png') {
    return t('export.photo');
  }
  return format === 'pdf' ? t('export.sheet') : format.toUpperCase();
};

// STL pieces are closed for printing; STEP pieces get their surfaces corrected for production.
const askAgent = (t: Translate, format: ProjectExportFormat, names: string): { label: string; prompt: string } =>
  isExact(format)
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
  /** The rows to offer, in order: IGES, DXF and the PDF sheet only for models the delivery can write. */
  readonly formats?: readonly ProjectExportFormat[];
  /**
   * Rows prepared only when asked: IGES needs OpenCASCADE (LGPL), whose WebAssembly module then loads in its own
   * worker; opening Esporta never loads it.
   */
  readonly onDemand?: readonly ProjectExportFormat[];
  /** The delivery to Sinopia (E3a), under the rows: it reads the files the rows prepared for this selection. */
  readonly delivery?: (state: { rows: ProjectExportRows; selectedNames: string[] | undefined }) => React.ReactNode;
};

/** IGES is prepared at the click: it is the one format that loads OpenCASCADE. */
const onDemandFormats: readonly ProjectExportFormat[] = ['iges'];

/** Independent results: a successful GLB never grants a STEP verification badge. */
export function ExportDialogView({
  name,
  pieces,
  sketches,
  prepare,
  capture,
  onAskAgent,
  onOpenChange,
  formats = projectExportFormats,
  onDemand = onDemandFormats,
  delivery,
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
  const [requested, setRequested] = useState<{ key: string; formats: readonly ProjectExportFormat[] }>();
  const preparationLifetime = useRef<AbortController | undefined>(undefined);
  // The automatic checks of this selection: a format asked for later waits for them (exports run one at a time).
  const automaticRun = useRef<Promise<void>>(Promise.resolve());
  const requestKey = `${selection}:${String(attempt)}`;
  const isRequested = (format: ProjectExportFormat): boolean =>
    requested?.key === requestKey && requested.formats.includes(format);
  const rows: ProjectExportRows =
    prepared?.prepare === prepare && prepared.selection === selection && prepared.attempt === attempt
      ? prepared.rows
      : {};

  useEffect(() => {
    const controller = new AbortController();
    preparationLifetime.current = controller;
    const run = async (): Promise<void> => {
      for (const format of formats.filter((candidate) => !onDemand.includes(candidate))) {
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
    automaticRun.current = run();
    return () => {
      controller.abort();
    };
  }, [prepare, selection, attempt, formats, onDemand]);

  /** Prepare a row asked for at the click, after the automatic checks of the same selection. */
  const prepareOnDemand = async (format: ProjectExportFormat): Promise<void> => {
    const controller = preparationLifetime.current;
    if (!controller || isAborted(controller.signal)) {
      return;
    }
    setRequested((previous) => ({
      key: requestKey,
      formats: [...(previous?.key === requestKey ? previous.formats : []), format],
    }));
    await automaticRun.current;
    if (isAborted(controller.signal)) {
      return;
    }
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
  };

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
        toast.success(t('export.downloaded', { format: formatLabel(t, format) }));
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
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground'>
          <label className='flex max-w-full min-w-0 items-center gap-2 text-foreground'>
            {t('export.pieces')}
            <select
              className='h-8 max-w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground pointer-coarse:min-h-11'
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
          <span>{t('export.units')}</span>
          <span aria-hidden>·</span>
          <span>{t('export.scale')}</span>
        </div>
        {sketches === 'mixed' ? <p className='text-sm text-muted-foreground'>{t('export.sketchesExcluded')}</p> : null}
        <div className='divide-y rounded-md border'>
          {formats.map((format) => {
            const result = rows[format];
            const waiting = result === undefined && onDemand.includes(format) && !isRequested(format);
            const status = waiting ? 'onDemand' : (result?.status ?? 'checking');
            const openPieces =
              result?.status === 'needsFix' && result.problem === 'invalid' ? result.pieces : undefined;
            const ask = openPieces?.length ? askAgent(t, format, openPieces.join(', ')) : undefined;
            const label = formatLabel(t, format);
            return (
              <section
                key={format}
                aria-label={label}
                className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2'
              >
                <div className='flex min-w-0 items-baseline gap-2'>
                  <h3 className='shrink-0 text-sm font-semibold'>{label}</h3>
                  <p className='min-w-0 truncate text-xs text-muted-foreground' title={t(`export.${format}`)}>
                    {t(`export.${format}`)}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <span
                    role='status'
                    aria-label={`${label}: ${t(`export.${status}`)}`}
                    aria-busy={status === 'checking'}
                    className='flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground'
                  >
                    {status === 'verified' ? <CheckIcon aria-hidden className='size-3.5 text-success' /> : null}
                    {status === 'needsFix' ? <CircleAlertIcon aria-hidden className='size-3.5 text-warning' /> : null}
                    {t(`export.${status}`)}
                  </span>
                  {waiting ? (
                    <Button
                      variant='outline'
                      size='xs'
                      className='pointer-coarse:min-h-11'
                      onClick={() => {
                        void prepareOnDemand(format);
                      }}
                    >
                      {t('export.prepareFormat', { format: label })}
                    </Button>
                  ) : (
                    <Button
                      variant='outline'
                      size='xs'
                      aria-busy={downloading === format}
                      className='pointer-coarse:min-h-11'
                      disabled={!canDownload(format, result) || downloading !== undefined}
                      onClick={() => {
                        void download(format);
                      }}
                    >
                      {downloadLabel(t, format, Boolean(openPieces?.length))}
                    </Button>
                  )}
                </div>
                {result?.status === 'needsFix' ? (
                  <div className='col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1'>
                    <p role='alert' aria-label={t('export.needsFix')} className='min-w-0 text-xs text-pretty'>
                      {fixMessage(t, format, result)}
                    </p>
                    {ask ? (
                      <Button
                        variant='link'
                        size='xs'
                        className='h-auto max-w-full text-left whitespace-normal pointer-coarse:min-h-11'
                        onClick={() => {
                          onAskAgent(ask.prompt);
                        }}
                      >
                        {ask.label}
                      </Button>
                    ) : null}
                    <Button
                      variant='ghost'
                      size='xs'
                      className='pointer-coarse:min-h-11'
                      onClick={() => {
                        setAttempt((value) => value + 1);
                      }}
                    >
                      {t('common.retry')}
                    </Button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        {delivery?.({ rows, selectedNames: selection === 'all' ? undefined : [selection.slice(6)] })}
        <DialogClose asChild>
          <Button variant='ghost' size='sm' className='justify-self-end pointer-coarse:min-h-11'>
            {t('common.close')}
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
