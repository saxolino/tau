import { useId, useMemo } from 'react';
import { Button } from '@taucad/ui/components/button';
import { ToolPage } from '#components/layout/tool-page.js';
import { FileSelector, createStaticDataSource } from '#components/files/file-selector.js';
import { ImportViewer } from '#routes/import.$/import-viewer.js';
import { formatFileSize } from '#components/geometry/converter/converter-utils.js';
import type { FileMap } from '#utils/file-reader.utils.js';
import { useTranslation } from '#i18n/translate.js';

type ImportMainFileViewProperties = {
  readonly title: string;
  readonly subtitle: string;
  readonly requestedMainFileWarning?: string;
  readonly files: FileMap;
  readonly selectedMainFile: string | undefined;
  readonly owner?: string;
  readonly repo?: string;
  readonly onSelectMainFile: (file: string) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

/**
 * Shared main file selection view used by both GitHub and disk imports.
 */
export function ImportMainFileView({
  title,
  subtitle,
  requestedMainFileWarning,
  files,
  selectedMainFile,
  owner = '',
  repo = '',
  onSelectMainFile,
  onConfirm,
  onCancel,
}: ImportMainFileViewProperties): React.JSX.Element {
  const { t, language } = useTranslation();
  const mainFileLabelId = useId();
  let byteLength = 0;
  for (const file of files.values()) {
    byteLength += file.content.byteLength;
  }
  const size = formatFileSize(byteLength, language);
  const dataSource = useMemo(() => createStaticDataSource([...files.keys()].map((path) => ({ path }))), [files]);

  return (
    <ToolPage title={t('import.title')}>
      <div className='space-y-4'>
        <div className='flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1'>
          <div className='space-y-1'>
            <h2 className='text-base font-medium'>{title}</h2>
            <p className='text-sm break-all text-muted-foreground'>{subtitle}</p>
          </div>
          <p className='text-xs text-muted-foreground tabular-nums'>
            {files.size === 1
              ? t('import.review.filesOne', { size })
              : t('import.review.filesMany', { count: files.size, size })}
          </p>
          {requestedMainFileWarning ? (
            <p role='alert' className='pt-2 text-sm'>
              {requestedMainFileWarning}
            </p>
          ) : undefined}
        </div>
        <div className='grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]'>
          {/* Left: the model as it will open */}
          <div className='h-[60vh] min-h-0 min-w-0 overflow-hidden rounded-xl border bg-muted'>
            <ImportViewer files={files} mainFile={selectedMainFile} owner={owner} repo={repo} />
          </div>

          {/* Right: the file the project opens */}
          <div className='flex min-w-0 flex-col gap-4'>
            <div role='group' aria-labelledby={mainFileLabelId} className='space-y-2'>
              <span id={mainFileLabelId} className='block text-sm font-medium'>
                {t('import.review.fileToOpen')}
              </span>
              <FileSelector
                dataSource={dataSource}
                selectedFile={selectedMainFile}
                placeholder={t('import.review.placeholder')}
                title={t('import.review.pickerTitle')}
                description={t('import.review.pickerDescription')}
                searchPlaceholder={t('import.review.search')}
                emptyMessage={t('import.review.noFiles')}
                onSelect={onSelectMainFile}
              />
              {selectedMainFile ? (
                <p className='text-xs break-all text-muted-foreground'>{selectedMainFile}</p>
              ) : undefined}
            </div>

            <Button className='w-full' disabled={!selectedMainFile} onClick={onConfirm}>
              {t('import.review.confirm')}
            </Button>

            <Button variant='outline' className='w-full' onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <p className='text-xs text-muted-foreground'>{t('import.review.copy')}</p>
          </div>
        </div>
      </div>
    </ToolPage>
  );
}
