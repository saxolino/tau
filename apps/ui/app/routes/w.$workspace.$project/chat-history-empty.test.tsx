// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

const selection = vi.hoisted(() => ({ piece: undefined as undefined | { node: { id: string } } }));
vi.mock('#hooks/use-selected-piece.js', () => ({ useSelectedPiece: () => selection.piece }));
vi.mock('#components/chat/assistant-suggestions.js', () => ({
  AssistantStarts: () => <div data-testid='assistant-starts' />,
}));

const { ChatHistoryEmpty } = await import('#routes/w.$workspace.$project/chat-history-empty.js');

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
  selection.piece = undefined;
});

describe('ChatHistoryEmpty', () => {
  // SinopiaCAD: an empty conversation offers the three starts, not a greeting (Fable 26 ott §2.3).
  it.each([
    ['it', 'Da dove partiamo?', /Costruisco il CAD a pezzi/u, /Seleziona un pezzo nel modello/u],
    ['en', 'Where do we start?', /I build the CAD in pieces/u, /Select a piece in the model/u],
  ] as const)('offers the three starts in %s, and the selection hint while nothing is selected', (...row) => {
    const [language, title, text, hint] = row;
    setLanguage(language);
    const { unmount } = render(<ChatHistoryEmpty />);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByTestId('assistant-starts')).toBeInTheDocument();
    expect(screen.getByText(hint)).toBeInTheDocument();
    unmount();
    selection.piece = { node: { id: 'frame' } };
    render(<ChatHistoryEmpty />);
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });
});
