import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base64ToUint8Array } from 'uint8array-extras';
import { getActiveGroupValues, parameterEntryPath, readProjectManifestBytes } from '@taucad/types';
import { requireParameterRecord } from '@taucad/parameters';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@taucad/ui/components/dialog';
import { Button } from '@taucad/ui/components/button';
import { CadPreviewViewer } from '#components/cad-preview.js';
import { CadPreviewProvider, useCadPreview } from '#hooks/use-cad-preview.js';
import { useProject } from '#hooks/use-project.js';
import { useRevisionClient } from '#hooks/use-revision-status.js';
import type { RevisionCard } from '#hooks/use-revisions.js';
import { useTranslation, formatNumber } from '#i18n/translate.js';

/** Decode the exact stored tree, including binary assets, without consulting current project files. */
export function decodeRevisionPreview(encoded: Readonly<Record<string, string>>): {
  files: Record<string, { content: Uint8Array<ArrayBuffer> }>;
  mainFile: string;
} {
  const files = Object.fromEntries(
    Object.entries(encoded).map(([path, content]) => [path, { content: base64ToUint8Array(content) }]),
  );
  const manifest = files['tau.json'];
  if (manifest === undefined) {
    throw new Error('The revision has no project manifest.');
  }
  const parsed = readProjectManifestBytes(manifest.content);
  if (!parsed.success || parsed.issue !== undefined) {
    throw new Error('The revision manifest is unreadable.');
  }
  const mainFile = parsed.data.assets.main.entryPath;
  if (files[mainFile] === undefined) {
    throw new Error('The revision has no model entry.');
  }
  return { files, mainFile };
}

/** Scalar measurements with producer-authored titles; identifiers and paths stay internal. */
function PreviewModel({
  files,
  mainFile,
}: {
  readonly files: Record<string, { content: Uint8Array<ArrayBuffer> }>;
  readonly mainFile: string;
}): React.JSX.Element {
  const { t, language } = useTranslation();
  const { parameterManifest, status } = useCadPreview();
  const measures = useMemo(() => {
    let overrides: Record<string, unknown> = {};
    let units: Readonly<Record<string, string>> = {};
    const bytes = files[parameterEntryPath(mainFile)]?.content;
    if (bytes !== undefined) {
      try {
        const record = requireParameterRecord(bytes);
        overrides = getActiveGroupValues(record);
        units = record.groups[record.activeGroup]?.units ?? {};
      } catch {
        // The runtime owns invalid-record reporting. Historical bytes are never repaired here.
      }
    }
    const rows: Array<{ pointer: string; title: string; value: number; unit: string }> = [];
    const objectOf = (value: unknown): Record<string, unknown> =>
      value !== null && typeof value === 'object' ? Object.fromEntries<unknown>(Object.entries(value)) : {};
    const visit = ({
      defaults,
      stored,
      schema,
      pointer,
      depth,
    }: {
      readonly defaults: unknown;
      readonly stored: unknown;
      readonly schema: unknown;
      readonly pointer: string;
      readonly depth: number;
    }): void => {
      if (depth > 64 || rows.length >= 1000) {
        return;
      }
      const value = stored ?? defaults;
      if (typeof value === 'number') {
        const title: unknown = Reflect.get(objectOf(schema), 'title');
        const binding = parameterManifest?.bindings[pointer];
        rows.push({
          pointer,
          title: typeof title === 'string' ? title : t('versions.measures'),
          value,
          unit: units[pointer] ?? binding?.unit ?? '',
        });
      } else if (value !== null && typeof value === 'object') {
        const base = objectOf(defaults);
        const saved = objectOf(stored);
        const properties = objectOf(Reflect.get(objectOf(schema), 'properties'));
        for (const key of new Set([...Object.keys(base), ...Object.keys(saved)])) {
          visit({
            defaults: Reflect.get(base, key),
            stored: Reflect.get(saved, key),
            schema: Reflect.get(properties, key),
            pointer: `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
            depth: depth + 1,
          });
        }
      }
    };
    visit({
      defaults: parameterManifest?.defaults,
      stored: overrides,
      schema: parameterManifest?.schema,
      pointer: '',
      depth: 0,
    });
    return rows;
  }, [files, mainFile, parameterManifest, t]);
  if (status === 'error') {
    return (
      <p role='alert' className='p-4 text-sm'>
        {t('versions.previewError')}
      </p>
    );
  }
  return (
    <div className='flex min-h-0 flex-1 flex-col sm:flex-row'>
      <aside
        aria-label={t('versions.readOnly')}
        className='max-h-48 shrink-0 overflow-y-auto border-b p-4 sm:max-h-none sm:w-64 sm:border-r sm:border-b-0'
      >
        <p className='mb-3 text-xs font-medium text-muted-foreground'>{t('versions.readOnly')}</p>
        {measures.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('versions.noMeasures')}</p>
        ) : (
          <dl className='space-y-2'>
            {measures.map((row) => (
              <div key={row.pointer} className='flex flex-wrap justify-between gap-x-3 text-sm'>
                <dt>{row.title}</dt>
                <dd className='font-mono tabular-nums'>
                  {formatNumber(row.value, language)} {row.unit}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </aside>
      <div className='relative min-h-48 min-w-0 flex-1'>
        {status === 'loading' || status === 'idle' ? (
          <p role='status' aria-busy='true' className='absolute top-3 left-3 z-10 text-sm'>
            {t('versions.previewLoading')}
          </p>
        ) : null}
        <CadPreviewViewer enablePan enableZoom className='size-full' />
      </div>
    </div>
  );
}

/** A modal read-only viewport over an isolated memory mount. Closing it returns to the untouched latest model. */
export function RevisionPreview({
  revision,
  onClose,
}: {
  readonly revision: RevisionCard;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { projectId } = useProject();
  const client = useRevisionClient();
  const { t } = useTranslation();
  const { data, isError } = useQuery({
    queryKey: ['revision-preview', projectId, revision.revisionId],
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      if (client === undefined) {
        throw new Error('The revision service is unavailable.');
      }
      return decodeRevisionPreview(await client.snapshot(revision.revisionId));
    },
  });
  const name = revision.n === undefined ? t('versions.unnamed') : t('versions.revision', { number: revision.n });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className='flex h-[min(90dvh,60rem)] w-[min(96vw,90rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none [&>[data-slot=dialog-close]]:hidden'>
        <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3'>
          <DialogTitle className='text-sm font-medium'>{t('versions.viewTitle', { revision: name })}</DialogTitle>
          <Button variant='outline' size='sm' onClick={onClose}>
            {t('versions.backToLatest')}
          </Button>
        </div>
        <DialogDescription className='sr-only'>{t('versions.readOnly')}</DialogDescription>
        {isError ? (
          <p role='alert' className='p-4 text-sm'>
            {t('versions.previewError')}
          </p>
        ) : data === undefined ? (
          <p role='status' aria-busy='true' className='p-4 text-sm'>
            {t('versions.previewLoading')}
          </p>
        ) : (
          <CadPreviewProvider projectId={projectId} mainFile={data.mainFile} files={data.files}>
            <PreviewModel files={data.files} mainFile={data.mainFile} />
          </CadPreviewProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}
