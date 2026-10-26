import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExportFile } from '@taucad/types/constants';
import { setLanguage } from '#i18n/language.js';
import { bindTranslate } from '#i18n/translate.js';
import type { Language } from '#i18n/language.js';
import type { PreparedExport, ProjectExportFormat } from '#services/project-export.types.js';
import { ExportDialogView } from '#routes/w.$workspace.$project/project-export-dialog-view.js';

const download = vi.hoisted(() => vi.fn());
vi.mock('#utils/export-artifact-set.utils.js', () => ({ downloadExportArtifactSet: download }));
vi.mock('#components/ui/sonner.js', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const file = createExportFile('stl', 'Anellino', new Uint8Array([1]));
const photo = createExportFile('png', 'view', new Uint8Array([137, 80, 78, 71]));
const pieces = [{ name: 'Anellino' }, { name: 'Rametto' }];
const results: Record<ProjectExportFormat, PreparedExport> = {
  step: { status: 'verified', files: [file] },
  stl: { status: 'needsFix', problem: 'invalid', pieces: ['Anellino'], files: [file] },
  glb: { status: 'ready', files: [file] },
  // The photo check only says a snapshot can be taken; the PNG is taken at the click.
  png: { status: 'ready', files: [] },
};
const capture = vi.fn(async (): Promise<PreparedExport> => ({ status: 'ready', files: [photo] }));

describe.each<Language>(['it', 'en'])('export dialog in %s', (language) => {
  it('should explain that sketches stay in the project when mixed-model solids are exported', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    render(
      <ExportDialogView
        name='Collana'
        pieces={pieces}
        sketches='mixed'
        prepare={async (format) => results[format]}
        capture={capture}
        onAskAgent={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText(t('export.sketchesExcluded'))).toBeInTheDocument();
    expect(
      await within(screen.getByRole('region', { name: 'STEP' })).findByText(t('export.verified')),
    ).toBeInTheDocument();
  });
  it('should disable sketch-only 3D downloads with an extrusion reason while retaining the photo', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    const prepare = vi.fn(
      async (format: ProjectExportFormat): Promise<PreparedExport> =>
        format === 'png' ? results.png : { status: 'needsFix', problem: 'sketchOnly' },
    );
    render(
      <ExportDialogView
        name='Profilo'
        pieces={[]}
        sketches='only'
        prepare={prepare}
        capture={capture}
        onAskAgent={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(prepare).toHaveBeenCalledTimes(4);
    });
    for (const format of ['STEP', 'STL', 'GLB']) {
      const row = within(screen.getByRole('region', { name: format }));
      expect(row.getByText(t('export.errors.sketchOnly'))).toBeInTheDocument();
      expect(row.getByRole('button', { name: t('export.download', { format }) })).toBeDisabled();
      expect(row.queryByText(t('export.errors.selection'))).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: t('export.downloadPhoto') }));
    expect(capture).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
  });
  it('should show independent format states, download anyway and prepare an agent draft', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const ask = vi.fn();
    const user = userEvent.setup();
    const prepare = vi.fn(async (format: ProjectExportFormat) => results[format]);
    render(
      <ExportDialogView
        name='Collana'
        pieces={pieces}
        prepare={prepare}
        capture={capture}
        onAskAgent={ask}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: t('export.title', { name: 'Collana' }) })).toBeInTheDocument();
    await waitFor(() => {
      expect(prepare).toHaveBeenCalledTimes(4);
    });
    expect(within(screen.getByRole('region', { name: 'STEP' })).getByRole('status')).toHaveTextContent(
      t('export.verified'),
    );
    expect(within(screen.getByRole('region', { name: 'STL' })).getByRole('status')).toHaveTextContent(
      t('export.needsFix'),
    );
    expect(within(screen.getByRole('region', { name: 'GLB' })).getByRole('status')).toHaveTextContent(
      t('export.ready'),
    );
    expect(screen.getByText(t('export.openPieces', { count: 1, names: 'Anellino' }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('export.anyway') }));
    expect(download).toHaveBeenCalledWith([file], { singleFileName: 'Collana.stl', archiveName: 'Collana-stl.zip' });
    await user.click(screen.getByRole('button', { name: t('export.ask') }));
    expect(ask).toHaveBeenCalledExactlyOnceWith(t('export.prompt', { names: 'Anellino' }));
    expect(screen.queryByText(/coordinate system|provider|save to project/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: t('export.pieces') }), 'piece:Rametto');
    await waitFor(() => {
      expect(prepare).toHaveBeenCalledWith('step', ['Rametto'], expect.any(AbortSignal));
    });
  });
  it('should offer the photo as soon as it can be taken and capture it at the click', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    const prepare = vi.fn(async (format: ProjectExportFormat) => results[format]);
    render(
      <ExportDialogView
        name='Collana'
        pieces={pieces}
        prepare={prepare}
        capture={capture}
        onAskAgent={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    const row = within(screen.getByRole('region', { name: t('export.photo') }));
    expect(await row.findByText(t('export.ready'))).toBeInTheDocument();
    expect(capture).not.toHaveBeenCalled();
    await user.click(row.getByRole('button', { name: t('export.downloadPhoto') }));
    expect(capture).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(download).toHaveBeenCalledWith([photo], { singleFileName: 'Collana.png', archiveName: 'Collana-png.zip' });
  });
  it('should name STEP pieces with surfaces to fix and prepare an agent draft for them', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    const ask = vi.fn();
    const surfaces = 'Marquise, Rametto sinistro';
    const prepare = vi.fn(
      async (format: ProjectExportFormat): Promise<PreparedExport> =>
        format === 'step'
          ? { status: 'needsFix', problem: 'invalid', pieces: ['Marquise', 'Rametto sinistro'] }
          : results[format],
    );
    render(
      <ExportDialogView
        name='Collana'
        pieces={pieces}
        prepare={prepare}
        capture={capture}
        onAskAgent={ask}
        onOpenChange={vi.fn()}
      />,
    );
    const row = within(screen.getByRole('region', { name: 'STEP' }));
    expect(await row.findByText(t('export.surfacePieces', { names: surfaces }))).toBeInTheDocument();
    expect(row.getByRole('button', { name: t('export.download', { format: 'STEP' }) })).toBeDisabled();
    await user.click(row.getByRole('button', { name: t('export.askSurfaces') }));
    expect(ask).toHaveBeenCalledExactlyOnceWith(t('export.surfacePrompt', { names: surfaces }));
  });
  it('should name the pieces whose STEP names differ from the model', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const prepare = vi.fn(
      async (format: ProjectExportFormat): Promise<PreparedExport> =>
        format === 'step'
          ? { status: 'needsFix', problem: 'names', pieces: ['Pietrina più', 'assembly'] }
          : results[format],
    );
    render(
      <ExportDialogView
        name='Collana'
        pieces={pieces}
        prepare={prepare}
        capture={capture}
        onAskAgent={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    const row = within(screen.getByRole('region', { name: 'STEP' }));
    expect(await row.findByText(t('export.differentNames', { names: 'Pietrina più, assembly' }))).toBeInTheDocument();
    expect(row.queryByRole('button', { name: t('export.ask') })).not.toBeInTheDocument();
    expect(row.getByRole('button', { name: t('export.download', { format: 'STEP' }) })).toBeDisabled();
  });
});

describe('export lifecycle', () => {
  it('should keep download disabled while checking and ignore results from an obsolete selection', async () => {
    setLanguage('en');
    const user = userEvent.setup();
    let finish: ((result: PreparedExport) => void) | undefined;
    const prepare = vi.fn(
      async (
        _format: ProjectExportFormat,
        selected: string[] | undefined,
        _signal: AbortSignal,
      ): Promise<PreparedExport> =>
        selected
          ? { status: 'needsFix', problem: 'selection' }
          : new Promise((resolve) => {
              finish = resolve;
            }),
    );
    const view = render(
      <ExportDialogView
        name='Collana'
        pieces={pieces}
        prepare={prepare}
        capture={capture}
        onAskAgent={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Download STEP' })).toBeDisabled();
    const firstSignal = prepare.mock.calls[0]?.[2];
    await user.selectOptions(screen.getByRole('combobox', { name: 'Pieces' }), 'piece:Rametto');
    await act(async () => {
      finish?.({ status: 'verified', files: [file] });
    });
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(firstSignal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Download STEP' })).toBeDisabled();
    view.unmount();
  });
  it('should show a plain correction reason and allow a failed STEP check to be retried', async () => {
    setLanguage('en');
    const user = userEvent.setup();
    const prepare = vi.fn(
      async (format: ProjectExportFormat): Promise<PreparedExport> =>
        format === 'step' ? { status: 'needsFix', problem: 'solids' } : results[format],
    );
    render(
      <ExportDialogView
        name='Collana'
        pieces={pieces}
        prepare={prepare}
        capture={capture}
        onAskAgent={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    const row = within(screen.getByRole('region', { name: 'STEP' }));
    expect(await row.findByText(/number of solids doesn’t match/)).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Download STEP' })).toBeDisabled();
    await user.click(row.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(prepare.mock.calls.filter(([format]) => format === 'step')).toHaveLength(2);
    });
  });
});
