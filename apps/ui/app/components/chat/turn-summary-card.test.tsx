// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnSummaryCard } from '#components/chat/turn-summary-card.js';
import { setLanguage } from '#i18n/language.js';
vi.mock('#hooks/use-project.js', () => ({ useProject: vi.fn() }));
vi.mock('#hooks/use-revision-status.js', () => ({ useRevisionClient: vi.fn() }));
vi.mock('#hooks/use-revisions.js', () => ({
  useTurnRevision: vi.fn(),
  useRevisionChanges: vi.fn(),
  useRevisionCards: vi.fn(),
}));
beforeEach(() => {
  setLanguage('it');
});
describe('turn summary', () => {
  it('should disclose the exact change and select the identified model piece', () => {
    const onSelect = vi.fn();
    render(
      <TurnSummaryCard
        revision={3}
        changes={[
          {
            id: 'wall',
            name: 'Castone marquise',
            pieceId: 'bezel',
            field: 'Parete',
            before: '0,3 mm',
            after: '0,4 mm',
            owned: true,
          },
        ]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('Cosa ho cambiato · Rev 3'));
    expect(screen.getByText(/0,3 mm → 0,4 mm/u)).toBeInTheDocument();
    expect(screen.getByText('tuo valore')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Castone marquise' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pieceId: 'bezel' }));
  });
  it('should disclose an honest fallback without making up a revision number', () => {
    setLanguage('en');
    render(<TurnSummaryCard changes={[]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText('What I changed'));
    expect(screen.getByText('Model changes')).toBeInTheDocument();
    expect(screen.queryByText(/Rev/u)).not.toBeInTheDocument();
  });
});
