// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '@taucad/ui/utils/keys';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { DictationButton } from '#components/dictation/dictation-controls.js';
import { setLanguage } from '#i18n/language.js';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('dictation gesture', () => {
  it('should start and finish dictation with the design shortcut while an input has focus', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    setPlatform('mac');
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(async () => true);
    const controls = (phase: 'idle' | 'recording') => (
      <KeyboardProvider>
        <TooltipProvider>
          <input aria-label='Message' />
          <DictationButton phase={phase} onStart={start} onStop={stop} />
        </TooltipProvider>
      </KeyboardProvider>
    );
    const view = render(controls('idle'));
    screen.getByRole('textbox').focus();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'm', metaKey: true, shiftKey: true });
    expect(start).toHaveBeenCalledOnce();
    view.rerender(controls('recording'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'm', metaKey: true, shiftKey: true });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('should stop a held recording even when permission arrives after release', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    setPlatform('mac');
    setLanguage('it');
    vi.stubGlobal('PointerEvent', MouseEvent);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    const ready = Promise.withResolvers<void>();
    const start = vi.fn(async () => ready.promise);
    const stop = vi.fn(async () => true);
    render(
      <KeyboardProvider>
        <TooltipProvider>
          <DictationButton phase='idle' onStart={start} onStop={stop} />
        </TooltipProvider>
      </KeyboardProvider>,
    );
    const button = screen.getByRole('button', { name: 'Detta' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Shift+Meta+m');
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    now += 500;
    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    expect(stop).not.toHaveBeenCalled();
    await act(async () => {
      ready.resolve();
      await ready.promise;
    });
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
