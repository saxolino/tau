// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatHistoryEmpty } from '#routes/w.$workspace.$project/chat-history-empty.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('ChatHistoryEmpty', () => {
  // SinopiaCAD: the agent's empty state in the design's words (UI-UX-SinopiaCAD §2.4).
  it.each([
    ['it', 'Dimmi cosa vuoi fare', /Posso partire da un’immagine/u],
    ['en', 'Tell me what you want to make', /I can start from an image/u],
  ] as const)('renders one concise invitation in %s without the old tips panel', (language, title, text) => {
    setLanguage(language);
    render(<ChatHistoryEmpty />);

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText('Tips for best results')).not.toBeInTheDocument();
  });
});
