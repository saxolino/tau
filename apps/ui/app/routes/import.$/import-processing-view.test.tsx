import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImportProcessingView } from '#routes/import.$/import-processing-view.js';
import { setLanguage } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import { bindTranslate } from '#i18n/translate.js';

describe.each<Language>(['it', 'en'])('ImportProcessingView in %s', (language) => {
  it('should show one active step and only reported progress through repository import', () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const { rerender } = render(<ImportProcessingView title='owner/model' source='github' phase='download' />);

    expect(screen.getByRole('heading', { level: 1, name: t('import.title') })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: t('import.progress.importing') })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar', { name: t('import.progress.downloading') })).not.toHaveAttribute(
      'aria-valuenow',
    );
    expect(screen.queryByText(/\d+ \/ \d+ file/u)).not.toBeInTheDocument();

    rerender(
      <ImportProcessingView
        title='owner/model'
        source='github'
        phase='extract'
        downloadProgress={{ loaded: 2048, total: 2048 }}
        progress={{ processed: 2, total: 5 }}
      />,
    );

    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('progressbar', { name: t('import.progress.extract.active') })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(
      within(screen.getByRole('list')).getByText(t('import.progress.count', { processed: 2, total: 5 })),
    ).toBeVisible();
    expect(screen.getByText(t('import.progress.downloaded'))).toBeVisible();
    expect(screen.getByText('2 KB')).toBeVisible();

    rerender(
      <ImportProcessingView title='owner/model' source='github' phase='create' progress={{ processed: 5, total: 5 }} />,
    );

    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('progressbar', { name: t('import.progress.creating') })).toBeVisible();
    expect(screen.getByText(t('import.progress.extract.done'))).toBeVisible();

    rerender(<ImportProcessingView title='owner/model' source='github' phase='create' isComplete />);

    expect(screen.getByRole('status', { name: t('import.progress.complete') })).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('heading', { name: t('import.progress.complete') })).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('should read a local file without a download step and offer to cancel', () => {
    setLanguage(language);
    const t = bindTranslate(language);
    render(
      <ImportProcessingView
        title='anello'
        source='local'
        phase='read'
        progress={{ processed: 1, total: 3 }}
        onCancel={() => undefined}
      />,
    );

    expect(screen.queryByText(t('import.progress.downloading'))).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: t('import.progress.read.active') })).toBeVisible();
    expect(screen.getByRole('button', { name: t('import.progress.cancel') })).toBeEnabled();
  });
});
