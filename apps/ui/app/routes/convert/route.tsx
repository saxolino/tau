import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { asKnownArtifact } from '@taucad/runtime';
import { Cpu, Download, Upload, RotateCcw } from 'lucide-react';
import { fromSafeAsync } from '#lib/xstate.lib.js';
import { projectToManifest } from '@taucad/types';
import type { ProjectLoadInput, ProjectRetrievedEvent } from '#machines/project.machine.js';
import { Button, buttonVariants } from '@taucad/ui/components/button';
import { CadViewer } from '@taucad/viewer/cad/cad-viewer';
import {
  FloatingPanel,
  FloatingPanelContent,
  FloatingPanelContentHeader,
  FloatingPanelContentTitle,
  FloatingPanelContentBody,
} from '#components/ui/floating-panel.js';
import { Dropzone, DropzoneEmptyState } from '#components/ui/dropzone.js';
import { FormatsList } from '#routes/convert/formats-list.js';
import {
  getFormatFromFilename,
  formatFileSize,
  isConfiguredConverterFormat,
} from '#components/geometry/converter/converter-utils.js';
import { Converter } from '#components/geometry/converter/converter.js';
import { ChatViewerControls } from '#routes/w.$workspace.$project/chat-viewer-controls.js';
import { useCookie } from '#hooks/use-cookie.js';
import { cookieName } from '#constants/cookie.constants.js';
import { cn } from '@taucad/ui/utils/cn';
import { Loader } from '@taucad/ui/components/loader';
import { ProjectProvider, useProject } from '#hooks/use-project.js';
import { GraphicsProvider, useGraphicsSelector } from '@taucad/viewer/hooks/use-graphics';
import { ToolPage } from '#components/layout/tool-page.js';
import { PageNotice } from '#components/layout/page-notice.js';
import { createConverterSource } from '@taucad/converter/contracts';
import type { ConverterExportFormat, ConverterImportFormat, ConverterRuntimeClient } from '@taucad/converter/runtime';
import { createConverterClient } from '#runtime/converter-client-options.js';
import { beginConverterOperation, createActiveConverterClient } from '#routes/convert/converter-client-lifecycle.js';
import { getLanguage } from '#i18n/language.js';
import { translate, useTranslation } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';

// React hoists the title, so a language other than the server's replaces its text instead of failing hydration.
export const meta: MetaFunction = () => [{ title: `${translate(getLanguage(), 'convert.title')} · SinopiaCAD` }];

type UploadedFileInfo = {
  name: string;
  format: ConverterImportFormat;
  size: number;
};

/** Why a file could not be converted; `detail` is the cause, shown only behind the notice's details. */
type ConversionError = {
  readonly reason: 'start' | 'unsupported' | 'unreadable' | 'tooMany';
  readonly detail: string;
};

/** None of the chosen files is in a format the converter opens. */
class UnsupportedModelError extends Error {
  public override readonly name = 'UnsupportedModelError';
}

const converterViewId = 'converter-main';
const defaultConverterExportFormats: ConverterExportFormat[] = ['stl'];
const maxConverterFiles = 100;

function ConverterContent(): React.JSX.Element {
  const { t } = useTranslation();
  const { projectRef, viewGraphics } = useProject();

  useEffect(() => {
    projectRef.send({ type: 'createViewGraphics', viewId: converterViewId });
    return () => {
      projectRef.send({ type: 'destroyViewGraphics', viewId: converterViewId });
    };
  }, [projectRef]);

  const graphicsRef = viewGraphics.get(converterViewId);
  if (!graphicsRef) {
    return (
      <ToolPage title={t('convert.title')} subtitle={t('convert.subtitle')}>
        <p role='status' className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader /> {t('convert.preparing')}
        </p>
      </ToolPage>
    );
  }

  return (
    <GraphicsProvider graphicsRef={graphicsRef}>
      <ConverterContentInner />
    </GraphicsProvider>
  );
}

/**
 * Isolated viewer that owns all graphics-machine selectors, the CadViewer and the viewer bar.
 * Memoised so that UI-only state changes in the parent (format selection, cookie updates, etc.) never cause the
 * WebGL canvas to re-render.
 */
export const ConverterViewer = memo(function ({
  glbData,
  hash,
  fileName,
}: {
  readonly glbData: Uint8Array<ArrayBuffer>;
  readonly hash: string;
  readonly fileName: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const enableSurfaces = useGraphicsSelector((state) => state.context.enableSurfaces);
  const enableLines = useGraphicsSelector((state) => state.context.enableLines);
  const enableGizmo = useGraphicsSelector((state) => state.context.enableGizmo);
  const enableGrid = useGraphicsSelector((state) => state.context.enableGrid);
  const enableAxes = useGraphicsSelector((state) => state.context.enableAxes);
  const enableMatcap = useGraphicsSelector((state) => state.context.enableMatcap);
  const upDirection = useGraphicsSelector((state) => state.context.upDirection);

  const artifact = useMemo(() => ({ mimeType: 'model/gltf-binary', content: glbData }) as const, [glbData]);

  return (
    <div data-viewer-frame className='fullscreen:bg-background absolute inset-0'>
      <div role='img' aria-label={t('convert.preview', { name: fileName })} className='absolute inset-0'>
        <CadViewer
          enableZoom
          enablePan
          upDirection={upDirection}
          enableMatcap={enableMatcap}
          enableLines={enableLines}
          enableAxes={enableAxes}
          enableGrid={enableGrid}
          enableGizmo={enableGizmo}
          enableSurfaces={enableSurfaces}
          artifact={artifact}
          artifactHash={hash}
        />
      </div>

      {/* Keep the viewer bar clear of the export panel, with safe centring on narrow screens. */}
      <div className='in-fullscreen:right-2 @container/viewer pointer-events-none absolute right-2 bottom-2 left-2 z-10 flex flex-col items-center-safe md:right-84'>
        <ChatViewerControls shouldEnableCapture={false} />
      </div>
    </div>
  );
});

/**
 * The export panel. From md up it is always open beside the viewer. Below md it folds away behind a «Formati» toggle,
 * so the viewer and its bar stay in reach, and opens under the toggle over the viewer.
 */
export function ConverterExportPanel({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  const { t } = useTranslation();
  const [isOpenOnPhone, setIsOpenOnPhone] = useState(false);
  const panelId = useId();
  return (
    <>
      <Button
        variant='overlay'
        aria-expanded={isOpenOnPhone}
        aria-controls={panelId}
        className='absolute top-2 right-2 z-10 md:hidden'
        onClick={() => {
          setIsOpenOnPhone((isOpen) => !isOpen);
        }}
      >
        <Download />
        {t('convert.panel.toggle')}
      </Button>
      <div
        id={panelId}
        className={cn(
          'absolute top-2 right-2 bottom-2 z-10 flex gap-2',
          // Below the toggle, inset from every edge.
          'max-md:top-12 max-md:left-2',
          !isOpenOnPhone && 'max-md:hidden',
        )}
      >
        <FloatingPanel isOpen side='right' className='rounded-md border'>
          <FloatingPanelContent className='w-80 max-md:w-full'>
            <FloatingPanelContentHeader className='px-3 text-foreground'>
              <FloatingPanelContentTitle>{t('convert.panel.title')}</FloatingPanelContentTitle>
            </FloatingPanelContentHeader>
            {children}
          </FloatingPanelContent>
        </FloatingPanel>
      </div>
    </>
  );
}

function ConverterContentInner(): React.JSX.Element {
  const { t, language } = useTranslation();
  const yourFileHeadingId = useId();
  const [uploadedFile, setUploadedFile] = useState<UploadedFileInfo | undefined>(undefined);
  const [glbData, setGlbData] = useState<Uint8Array<ArrayBuffer> | undefined>(undefined);
  const [glbHash, setGlbHash] = useState<string | undefined>(undefined);
  const [runtimeDocument, setRuntimeDocument] = useState<ReturnType<ConverterRuntimeClient['open']> | undefined>();
  const documentRef = useRef<ReturnType<ConverterRuntimeClient['open']> | undefined>(undefined);
  const pendingDocumentRef = useRef<ReturnType<ConverterRuntimeClient['open']> | undefined>(undefined);
  const [client, setClient] = useState<ConverterRuntimeClient | undefined>(undefined);
  const [converterImportFormats, setConverterImportFormats] = useState<ConverterImportFormat[]>([]);
  const [converterExportFormats, setConverterExportFormats] = useState<ConverterExportFormat[]>([]);
  const [selectedFormats, setSelectedFormats] = useCookie<ConverterExportFormat[]>(
    cookieName.converterOutputFormats,
    defaultConverterExportFormats,
  );
  const [useZipForMultiple, setUseZipForMultiple] = useCookie<boolean>(cookieName.converterMultifileZip, true);
  const [isConverting, setIsConverting] = useState(false);
  const [openingFileName, setOpeningFileName] = useState<string>();
  const [conversionError, setConversionError] = useState<ConversionError>();
  const conversionGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    let runtimeClient: ConverterRuntimeClient | undefined;
    let unsubscribe: (() => void) | undefined;
    const connectConverter = async (): Promise<void> => {
      try {
        const createdClient = await createActiveConverterClient(createConverterClient, () => active);
        if (!createdClient) {
          return;
        }
        runtimeClient = createdClient;
        unsubscribe = createdClient.on('capabilities', (capabilities) => {
          if (!active) {
            return;
          }
          setConverterImportFormats([
            ...new Set(
              capabilities.registrations
                .flatMap((registration) => (registration.kind === 'kernel' ? registration.extensions : []))
                .filter((format) => isConfiguredConverterFormat(format)),
            ),
          ] as ConverterImportFormat[]);
          setConverterExportFormats([
            ...new Set(
              capabilities.routes
                .map((route) => route.targetFormat)
                .filter((format) => isConfiguredConverterFormat(format)),
            ),
          ]);
        });
        await createdClient.connect();
        if (!active) {
          unsubscribe();
          createdClient.terminate();
          return;
        }
        setClient(createdClient);
      } catch (error) {
        unsubscribe?.();
        runtimeClient?.terminate();
        if (active) {
          setConversionError({
            reason: 'start',
            detail: `Could not start the converter: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    };
    void connectConverter();
    return () => {
      active = false;
      conversionGeneration.current += 1;
      pendingDocumentRef.current?.close();
      pendingDocumentRef.current = undefined;
      documentRef.current?.close();
      documentRef.current = undefined;
      unsubscribe?.();
      runtimeClient?.terminate();
    };
  }, []);

  useEffect(() => {
    if (converterExportFormats.length > 0) {
      setSelectedFormats((formats) => {
        const configuredFormats = formats.filter((format) => converterExportFormats.includes(format));
        return configuredFormats.length === formats.length ? formats : configuredFormats;
      });
    }
  }, [converterExportFormats, setSelectedFormats]);

  const handleFileSelect = useCallback(
    async (files: File[]) => {
      const isCurrentOperation = beginConverterOperation(conversionGeneration);
      pendingDocumentRef.current?.close();
      pendingDocumentRef.current = undefined;
      setOpeningFileName(files[0]?.name);
      setIsConverting(true);
      setConversionError(undefined);
      try {
        if (!client) {
          throw new Error('The converter runtime is still loading');
        }
        const entryFile = files.find((file) => {
          try {
            return converterImportFormats.includes(getFormatFromFilename(file.name));
          } catch {
            return false;
          }
        });
        if (!entryFile) {
          throw new UnsupportedModelError('No supported model file was selected');
        }
        setOpeningFileName(entryFile.name);
        const format = getFormatFromFilename(entryFile.name);
        const entries = await Promise.all(
          files.map(
            async (file) => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())] as const,
          ),
        );
        if (!isCurrentOperation()) {
          return;
        }
        const nextSource = createConverterSource(entries, entryFile.webkitRelativePath || entryFile.name);
        const opened = client.open({ source: nextSource, watch: false });
        pendingDocumentRef.current = opened;
        const outcome = await opened.evaluation();
        if (!isCurrentOperation() || outcome.superseded) {
          return;
        }
        if (!outcome.evaluation.success) {
          throw new Error(outcome.evaluation.issues.map((issue) => issue.message).join('\n'));
        }
        const view = opened.view();
        const preview = await view.rendering();
        view.close();
        if (!isCurrentOperation() || preview.superseded) {
          return;
        }
        if (!preview.rendering.success) {
          throw new Error(preview.rendering.issues.map((issue) => issue.message).join('\n'));
        }
        const artifact = asKnownArtifact(preview.rendering.artifact);
        if (artifact?.mimeType !== 'model/gltf-binary') {
          throw new Error(`Converter returned unsupported preview media: ${preview.rendering.artifact.mimeType}`);
        }
        setUploadedFile({ name: entryFile.name, format, size: entryFile.size });
        documentRef.current?.close();
        documentRef.current = opened;
        pendingDocumentRef.current = undefined;
        setRuntimeDocument(opened);
        setGlbData(artifact.content);
        setGlbHash(preview.rendering.hash);
      } catch (error) {
        if (isCurrentOperation()) {
          setConversionError(fileConversionError(error));
        }
      } finally {
        if (pendingDocumentRef.current && isCurrentOperation()) {
          pendingDocumentRef.current.close();
          pendingDocumentRef.current = undefined;
        }
        if (isCurrentOperation()) {
          setIsConverting(false);
        }
      }
    },
    [client, converterImportFormats],
  );

  const handleFormatToggle = useCallback(
    (format: ConverterExportFormat) => {
      setSelectedFormats((previous) => {
        if (previous.includes(format)) {
          return previous.filter((f) => f !== format);
        }

        return [...previous, format];
      });
    },
    [setSelectedFormats],
  );

  const handleReset = useCallback(() => {
    conversionGeneration.current += 1;
    pendingDocumentRef.current?.close();
    pendingDocumentRef.current = undefined;
    setIsConverting(false);
    setConversionError(undefined);
    setUploadedFile(undefined);
    documentRef.current?.close();
    documentRef.current = undefined;
    setRuntimeDocument(undefined);
    setGlbData(undefined);
    setGlbHash(undefined);
  }, []);

  const handleClearFormats = useCallback(() => {
    setSelectedFormats([]);
  }, [setSelectedFormats]);

  const handleZipToggle = useCallback(
    (useZip: boolean) => {
      setUseZipForMultiple(useZip);
    },
    [setUseZipForMultiple],
  );

  const handleFileDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        void handleFileSelect(acceptedFiles);
      }
    },
    [handleFileSelect],
  );

  const exportFormat = useCallback(
    async (format: ConverterExportFormat) => {
      if (!runtimeDocument) {
        throw new Error('No model is loaded');
      }
      const result = await runtimeDocument.export(format);
      if (!result.success) {
        throw new Error(result.issues.map((issue) => issue.message).join('\n'));
      }
      return [...result.files];
    },
    [runtimeDocument],
  );

  const hasModel = glbData !== undefined;

  return (
    <div className='h-full overflow-y-auto'>
      <ToolPage
        className='min-h-full'
        title={t('convert.title')}
        subtitle={t('convert.subtitle')}
        action={
          hasModel ? (
            <Button variant='outline' onClick={handleReset}>
              <RotateCcw />
              {t('convert.convertAnother')}
            </Button>
          ) : undefined
        }
      >
        {conversionError ? <ConversionNotice error={conversionError} fileName={openingFileName} /> : undefined}

        <div
          className={cn(
            'relative',
            (isConverting || hasModel) && 'min-h-144 flex-1 overflow-hidden rounded-xl border bg-muted',
          )}
        >
          {isConverting || hasModel ? (
            <>
              {glbData && glbHash ? (
                <ConverterViewer glbData={glbData} hash={glbHash} fileName={uploadedFile?.name ?? ''} />
              ) : undefined}
              {isConverting ? (
                <div
                  role='status'
                  aria-label={t('convert.opening')}
                  aria-busy='true'
                  className={cn(
                    'absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-4 text-center',
                    hasModel ? 'bg-background/90' : 'bg-muted',
                  )}
                >
                  <Loader className='size-5 text-muted-foreground' />
                  <span className='max-w-full text-sm font-medium break-all'>{openingFileName}</span>
                  <span className='text-sm text-muted-foreground'>{t('convert.opening')}</span>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      conversionGeneration.current += 1;
                      setIsConverting(false);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : (
                <ConverterExportPanel>
                  <FloatingPanelContentBody className='flex min-h-0 flex-col justify-between gap-4 bg-sidebar p-3'>
                    <div className='space-y-5'>
                      {uploadedFile ? (
                        <div className='space-y-1'>
                          <p className='truncate text-sm font-medium'>{uploadedFile.name}</p>
                          <p className='text-xs text-muted-foreground'>
                            <span className='font-mono'>{uploadedFile.format.toUpperCase()}</span> ·{' '}
                            <span className='tabular-nums'>{formatFileSize(uploadedFile.size, language)}</span>
                          </p>
                        </div>
                      ) : undefined}
                      <Converter
                        availableFormats={converterExportFormats}
                        exportFormat={exportFormat}
                        selectedFormats={selectedFormats}
                        shouldUseZipForMultiple={useZipForMultiple}
                        uploadedFile={uploadedFile}
                        onFormatToggle={handleFormatToggle}
                        onClearSelection={handleClearFormats}
                        onZipToggle={handleZipToggle}
                      />
                    </div>
                    <Dropzone
                      className='w-full rounded-xl bg-card text-wrap max-md:hidden'
                      maxFiles={maxConverterFiles}
                      onDrop={handleFileDrop}
                      onError={(error) => {
                        setConversionError({ reason: 'tooMany', detail: error.message });
                      }}
                    >
                      <DropzoneEmptyState>
                        <div className='flex flex-col items-center gap-1 py-1 text-wrap'>
                          <Upload aria-hidden className='size-4 text-muted-foreground' />
                          <span className='text-sm font-medium'>{t('convert.openAnother')}</span>
                          <span className='text-xs font-normal text-muted-foreground'>{t('convert.dropAnother')}</span>
                        </div>
                      </DropzoneEmptyState>
                    </Dropzone>
                  </FloatingPanelContentBody>
                </ConverterExportPanel>
              )}
            </>
          ) : (
            <div className='grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]'>
              <section aria-labelledby={yourFileHeadingId} className='min-w-0 space-y-3'>
                <h2 id={yourFileHeadingId} className='text-sm font-medium'>
                  {t('convert.yourFile')}
                </h2>
                {/* The home's card (E1, 1 px border, no dashes); the whole card opens the picker. */}
                <Dropzone
                  className='min-h-58 gap-4 rounded-xl border-border bg-card p-7 text-wrap shadow-xs'
                  maxFiles={maxConverterFiles}
                  disabled={!client}
                  onDrop={handleFileDrop}
                  onError={(error) => {
                    setConversionError({ reason: 'tooMany', detail: error.message });
                  }}
                >
                  <DropzoneEmptyState>
                    <div className='flex flex-col items-center gap-4 text-center'>
                      <span className='flex size-10 items-center justify-center rounded-lg border bg-muted'>
                        <Upload aria-hidden className='size-5 text-muted-foreground' />
                      </span>
                      <span className={buttonVariants()}>{t('convert.choose')}</span>
                      <span className='space-y-1 text-sm font-normal text-muted-foreground'>
                        <span className='block'>{t('convert.dropHere')}</span>
                        <span className='block'>{t('convert.linkedFiles')}</span>
                      </span>
                    </div>
                  </DropzoneEmptyState>
                </Dropzone>
                <p className='flex items-center gap-2 text-xs text-muted-foreground'>
                  <Cpu aria-hidden className='size-3.5' /> {t('convert.onThisComputer')}
                </p>
              </section>
              <div className='min-w-0 space-y-3'>
                {!client && conversionError ? undefined : (
                  <FormatsList formats={converterImportFormats} isLoading={!client} />
                )}
                <p className='border-t pt-4 text-xs leading-relaxed text-muted-foreground'>{t('convert.outputHint')}</p>
              </div>
            </div>
          )}
        </div>
      </ToolPage>
    </div>
  );
}

/**
 * What stopped the conversion and how to recover; the cause stays behind the notice's details.
 *
 * @returns The notice, with a reload when the converter itself did not start.
 */
function ConversionNotice({
  error,
  fileName,
}: {
  readonly error: ConversionError;
  readonly fileName: string | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { title, message } = describeConversionError(error, fileName ?? '', t);
  return (
    <PageNotice title={title} message={message} detail={error.detail}>
      {error.reason === 'start' ? (
        <Button
          variant='outline'
          onClick={() => {
            globalThis.location.reload();
          }}
        >
          {t('common.reload')}
        </Button>
      ) : undefined}
    </PageNotice>
  );
}

/**
 * Classify a file the converter could not open: a format it does not read, or a file it could not read.
 *
 * @param error - What opening the file threw.
 * @returns The conversion error, with the cause as its detail.
 */
function fileConversionError(error: unknown): ConversionError {
  return {
    reason: error instanceof UnsupportedModelError ? 'unsupported' : 'unreadable',
    detail: error instanceof Error ? `Failed to process file: ${error.message}` : 'Failed to process file',
  };
}

/**
 * The notice for a file that could not be converted: what went wrong and how to fix it, never the cause itself.
 *
 * @param error - Why the conversion stopped.
 * @param fileName - The file the person chose.
 * @param t - The translator.
 * @returns The notice's title and message.
 */
function describeConversionError(
  error: ConversionError,
  fileName: string,
  t: Translate,
): { readonly title: string; readonly message: string } {
  switch (error.reason) {
    case 'start': {
      return { title: t('convert.errors.startTitle'), message: t('convert.errors.startMessage') };
    }
    case 'unsupported': {
      return {
        title: t('convert.errors.unsupportedTitle'),
        message: t('convert.errors.unsupportedMessage', { name: fileName }),
      };
    }
    case 'unreadable': {
      return {
        title: t('convert.errors.unreadableTitle'),
        message: t('convert.errors.unreadableMessage', { name: fileName }),
      };
    }
    case 'tooMany': {
      return {
        title: t('convert.errors.tooManyTitle'),
        message: t('convert.errors.tooManyMessage', { max: maxConverterFiles }),
      };
    }
  }
}

export default function ConverterRoute(): React.JSX.Element {
  // Provide a minimal project context so downstream components can use graphics/cad state
  const converterProject = {
    ...projectToManifest({
      name: 'Converter',
      description: 'Transient project context for the converter page',
      tags: [],
      assets: { main: { entryPath: 'converter.glb' } },
    }),
    id: 'converter',
  };

  return (
    <ProjectProvider
      projectId={converterProject.id}
      input={{ shouldLoadModelOnStart: false }}
      provide={{
        actors: {
          loadProjectActor: fromSafeAsync<ProjectRetrievedEvent, ProjectLoadInput>(async () => {
            return {
              type: 'projectRetrieved',
              project: converterProject,
            };
          }),
        },
      }}
    >
      <ConverterContent />
    </ProjectProvider>
  );
}
