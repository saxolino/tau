// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutDialog } from '#components/nav/about-sinopiacad.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';

const words = {
  it: {
    title: 'Informazioni',
    description: 'SinopiaCAD — basato su Tau (taucad/tau), licenza Apache-2.0.',
    license: 'Licenza Apache-2.0',
    source: 'Codice sorgente di Tau',
    privacy: 'Informativa privacy',
    terms: 'Condizioni d’uso',
    close: 'Chiudi',
  },
  en: {
    title: 'About',
    description: 'SinopiaCAD — based on Tau (taucad/tau), Apache-2.0 licence.',
    license: 'Apache-2.0 licence',
    source: 'Tau source code',
    privacy: 'Privacy notice',
    terms: 'Terms of use',
    close: 'Close',
  },
} as const satisfies Record<Language, Record<string, string>>;

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe.each(['it', 'en'] as const)('AboutDialog in %s', (language) => {
  const text = words[language];

  it('should credit Tau under Apache-2.0 and link the licence and Sinopia’s legal pages', () => {
    setLanguage(language);
    render(<AboutDialog isOpen onOpenChange={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: text.title })).toBeInTheDocument();
    expect(screen.getByText(text.description)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: text.license })).toHaveAttribute(
      'href',
      'https://www.apache.org/licenses/LICENSE-2.0',
    );
    expect(screen.getByRole('link', { name: text.source })).toHaveAttribute('href', 'https://github.com/taucad/tau');
    expect(screen.getByRole('link', { name: text.privacy })).toHaveAttribute(
      'href',
      'https://sinopialab.com/privacy-policy',
    );
    expect(screen.getByRole('link', { name: text.terms })).toHaveAttribute(
      'href',
      'https://sinopialab.com/beta/condizioni',
    );
  });

  it('should close from its close action', () => {
    setLanguage(language);
    const onOpenChange = vi.fn();
    render(<AboutDialog isOpen onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getAllByRole('button', { name: text.close }).at(-1)!);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
