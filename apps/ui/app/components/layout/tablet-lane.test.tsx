import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabletLane } from '#components/layout/tablet-lane.js';
import { CadPhoneNotice } from '#components/layout/cad-phone-notice.js';
import { setLanguage } from '#i18n/language.js';

describe('TabletLane', () => {
  beforeEach(() => {
    setLanguage('it');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setLanguage('it');
  });

  it('should keep the top bar reachable and close using Escape or the veil', () => {
    const close = vi.fn();
    render(
      <>
        <button type='button'>Misure</button>
        <TabletLane label='Agente' side='right' onClose={close}>
          <textarea aria-label='Messaggio' />
        </TabletLane>
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'Agente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Misure' })).not.toHaveAttribute('aria-hidden');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole('button', { name: 'Chiudi' })[0]!);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('should keep the composer above the visual keyboard and remove viewport listeners', () => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 900, offsetTop: 0 });
    const remove = vi.spyOn(viewport, 'removeEventListener');
    vi.stubGlobal('visualViewport', viewport);
    const { unmount } = render(
      <TabletLane label='Agente' side='right' onClose={vi.fn()}>
        <textarea aria-label='Messaggio' />
      </TabletLane>,
    );
    const panel = screen.getByRole('dialog', { name: 'Agente' });
    expect(panel.style.maxHeight).toBe('900px');
    act(() => {
      Object.assign(viewport, { height: 420, offsetTop: 30 });
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(panel.style.maxHeight).toBe('450px');
    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['it', 'SinopiaCAD lavora su computer e tablet da 7 pollici in su.', 'Apri Sinopia'],
    ['en', 'SinopiaCAD works on computers and tablets from 7 inches up.', 'Open Sinopia'],
  ] as const)('should explain the phone limit in %s', (language, text, link) => {
    setLanguage(language);
    render(<CadPhoneNotice />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: link })).toHaveAttribute('href', 'https://sinopialab.com');
  });
});
