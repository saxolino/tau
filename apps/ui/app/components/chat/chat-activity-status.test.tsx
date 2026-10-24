// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatActivityStatus } from '#components/chat/chat-activity-status.js';
import { setLanguage } from '#i18n/language.js';
describe('modelling status', () => {
  it('should keep a visible stop action beside the activity in both languages', () => {
    setLanguage('it');
    const stop = vi.fn();
    const view = render(
      <ChatActivityStatus cue={{ kind: 'working', sentence: 'Applico la modifica…' }} onStop={stop} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Applico la modifica…');
    fireEvent.click(screen.getByRole('button', { name: 'Ferma' }));
    expect(stop).toHaveBeenCalledOnce();
    setLanguage('en');
    view.rerender(<ChatActivityStatus cue={{ kind: 'working', sentence: 'Applying the change…' }} onStop={stop} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });
});
