// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor, createAsyncLogic } from 'xstate';
import type { Actor } from 'xstate';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { GraphicsProvider } from '@taucad/viewer/hooks/use-graphics';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { graphicsMachine } from '@taucad/viewer/machines/graphics.machine';
import { ConverterExportPanel, ConverterViewer } from '#routes/convert/route.js';
import { FormatsList } from '#routes/convert/formats-list.js';
import { setLanguage } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import { bindTranslate } from '#i18n/translate.js';

vi.mock('@taucad/viewer/cad/cad-viewer', () => ({
  CadViewer: () => <div role='img' aria-label='Model' />,
}));
vi.mock('#components/geometry/cad/capture-view-control.js', () => ({
  CaptureViewControl: () => <button type='button' aria-label='Capture view to chat' />,
}));
vi.mock('@taucad/viewer/cad/grid-control', () => ({
  GridSizeIndicator: () => <button type='button' aria-label='Grid 10 mm, units and grid' />,
}));
vi.mock('@taucad/viewer/cad/viewer-settings', () => ({
  ViewerSettings: () => <button type='button' aria-label='Viewer settings' />,
}));

let activeActor: Actor<typeof graphicsMachine> | undefined;

afterEach(() => {
  activeActor?.stop();
  activeActor = undefined;
});

const renderViewer = (): void => {
  activeActor = createActor(
    graphicsMachine.provide({
      actors: { probeWebGpu: createAsyncLogic({ run: async () => false }) },
    }),
    { input: {} },
  ).start();
  render(
    <KeyboardProvider>
      <TooltipProvider>
        <GraphicsProvider graphicsRef={activeActor}>
          <ConverterViewer
            glbData={new Uint8Array([0x67, 0x6c, 0x54, 0x46])}
            hash='bracket-hash'
            fileName='bracket.step'
          />
        </GraphicsProvider>
      </TooltipProvider>
    </KeyboardProvider>,
  );
};

describe('ConverterViewer', () => {
  it('should show the viewer bar without Capture, in the frame the shortcuts target', () => {
    renderViewer();

    const bar = screen.getByRole('group', { name: 'Viewer controls' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual([
      'Grid 10 mm, units and grid',
      'Section view',
      'Measure',
      'Fit view',
      'Enter fullscreen',
      'Viewer settings',
    ]);
    expect(bar.closest('[data-viewer-frame]')).toContainElement(screen.getByRole('img', { name: 'Model' }));
  });

  it('should centre the bar in a label container clear of the export panel from md up', () => {
    renderViewer();

    const surface = screen.getByRole('group', { name: 'Viewer controls' }).closest('[data-slot="viewer-controls"]')!;
    const strip = surface.parentElement!;
    // Safe centring: a bar wider than the strip starts at its left edge rather than centring off the screen.
    expect(strip).toHaveClass(
      'pointer-events-none',
      'right-2',
      'md:right-84',
      'flex-col',
      'items-center-safe',
      '@container/viewer',
    );
    expect(strip).not.toHaveClass('items-center', 'right-84');
    expect(strip.lastElementChild).toBe(surface);
  });
});

describe.each<Language>(['it', 'en'])('ConverterExportPanel in %s', (language) => {
  it('should fold away below md behind a Formats toggle, and stay open from md up', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <ConverterExportPanel>
          <button type='button'>Export STEP</button>
        </ConverterExportPanel>
      </TooltipProvider>,
    );
    expect(screen.getByText(t('convert.panel.title'))).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: t('convert.panel.toggle') });
    const panel = document.querySelector<HTMLElement>(`[id="${toggle.getAttribute('aria-controls')}"]`);

    expect(toggle).toHaveClass('md:hidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveClass('max-md:hidden');
    expect(panel).not.toHaveClass('hidden');
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Export STEP' }));

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveClass('max-md:hidden');

    await user.click(toggle);

    expect(panel).toHaveClass('max-md:hidden');
  });
});

describe.each<Language>(['it', 'en'])('FormatsList in %s', (language) => {
  it('should list the formats a designer opens by their codes, searchable in the interface language', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    render(<FormatsList formats={['step', '3dm', 'stl']} isLoading={false} />);

    expect(screen.getByRole('heading', { name: t('convert.inputFormats') })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['STEP', '3DM', 'STL']);

    await user.type(screen.getByRole('searchbox', { name: t('convert.searchFormats') }), 'zzz');

    expect(screen.getByRole('status')).toHaveTextContent(t('convert.noFormat'));
  });
});
