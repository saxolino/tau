import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UploadCard } from '#routes/import.$/upload-card.js';
import { setLanguage } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import { bindTranslate } from '#i18n/translate.js';

describe.each<Language>(['it', 'en'])('UploadCard in %s', (language) => {
  it('should offer a model, a folder or a ZIP from the computer, in words a designer uses', () => {
    setLanguage(language);
    const t = bindTranslate(language);
    render(
      <UploadCard
        onDataTransfer={vi.fn()}
        onFilesSelected={vi.fn()}
        onFolderSelected={vi.fn()}
        onZipSelected={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: t('import.choose') })).toBeEnabled();
    expect(screen.getByRole('button', { name: t('import.chooseFolder') })).toBeEnabled();
    expect(screen.getByText(t('import.dropHere'))).toBeVisible();
    expect(screen.getByText(t('import.formats'))).toBeVisible();
    expect(screen.queryByText(/\.scad|\.kcl|\.py|Sources/u)).not.toBeInTheDocument();
  });

  it('should let the file picker choose the 3D models the project opens, beside ZIP archives', () => {
    setLanguage(language);
    const t = bindTranslate(language);
    render(
      <UploadCard
        onDataTransfer={vi.fn()}
        onFilesSelected={vi.fn()}
        onFolderSelected={vi.fn()}
        onZipSelected={vi.fn()}
      />,
    );

    const accepted = screen.getByLabelText(t('import.filesInput')).getAttribute('accept')?.split(',') ?? [];
    expect(accepted).toEqual(
      expect.arrayContaining(['.zip', '.step', '.stp', '.3dm', '.stl', '.obj', '.mtl', '.glb', '.gltf', '.igs']),
    );
  });
});
