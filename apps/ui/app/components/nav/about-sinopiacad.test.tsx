// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutDialog, occtNotice } from '#components/nav/about-sinopiacad.js';
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

  it('should give the Open CASCADE notice with its licence, exception and the exact sources of the module', () => {
    setLanguage(language);
    render(<AboutDialog isOpen onOpenChange={vi.fn()} />);
    const notice = within(
      screen.getByRole('region', { name: language === 'it' ? 'Componenti di terzi' : 'Third-party components' }),
    );
    expect(notice.getByText(/Open CASCADE Technology.+LGPL 2\.1.+libcascade 3\.1\.0/u)).toBeInTheDocument();
    const hrefs = notice.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      occtNotice.source,
      occtNotice.module,
      occtNotice.lgpl,
      occtNotice.exception,
      'https://smlibpy.classcad.ch/docs/javascript',
      'https://github.com/Hopding/pdf-lib',
    ]);
    // The links name the exact build: the OCCT and libcascade commits of the module's provenance file.
    expect(occtNotice.source).toContain('b8f597c677811d1f9f4d8a97f5ae2825c0353a42');
    expect(occtNotice.module).toContain('341fa789f49ce73db76a0209d89ae518cc64a52d');
  });

  it('should close from its close action', () => {
    setLanguage(language);
    const onOpenChange = vi.fn();
    render(<AboutDialog isOpen onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getAllByRole('button', { name: text.close }).at(-1)!);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
