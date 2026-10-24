// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import type { SinopiaSignInResult } from '#lib/sinopia-session.js';
import { SinopiaSecondFactor } from '#components/auth/sinopia/sinopia-second-factor.js';

const verifySecondFactor = vi.hoisted(() => vi.fn<(code: string) => Promise<SinopiaSignInResult>>());
const signOut = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('#lib/sinopia-session.js', () => ({
  sinopiaSession: () => ({ verifySecondFactor, signOut }),
}));

const user = { id: 'user-sinopia', email: 'pilota@sinopialab.com' };

const words = {
  it: {
    confirm: 'Conferma',
    code: 'Codice di verifica',
    wrong: 'Codice non valido o scaduto. Riprova con il codice attuale dell’app.',
    signOut: 'Esci e accedi con un altro account',
    title: 'Inserisci il codice dell’app di autenticazione',
  },
  en: {
    confirm: 'Confirm',
    code: 'Verification code',
    wrong: 'Invalid or expired code. Try again with the app’s current code.',
    signOut: 'Sign out and use another account',
    title: 'Enter the code from your authenticator app',
  },
} as const satisfies Record<Language, Record<string, string>>;

beforeEach(() => {
  verifySecondFactor.mockReset();
  signOut.mockReset();
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe.each(['it', 'en'] as const)('SinopiaSecondFactor in %s', (language) => {
  const text = words[language];
  beforeEach(() => {
    setLanguage(language);
  });

  it("should confirm the account with the authenticator's six digits", async () => {
    verifySecondFactor.mockResolvedValue({ ok: true });
    const actor = userEvent.setup();
    render(<SinopiaSecondFactor user={user} />);
    const confirmButton = screen.getByRole('button', { name: text.confirm });
    expect(screen.getByRole('heading', { level: 1, name: text.title })).toBeInTheDocument();
    expect(confirmButton).toBeDisabled();

    await actor.type(screen.getByLabelText(text.code), '12 34-567');

    expect(screen.getByLabelText(text.code)).toHaveValue('123456');
    await actor.click(confirmButton);
    expect(verifySecondFactor).toHaveBeenCalledWith('123456');
  });

  it('should explain a wrong code in the language of the screen and clear it', async () => {
    verifySecondFactor.mockResolvedValue({
      ok: false,
      code: 'secondFactorInvalid',
    });
    const actor = userEvent.setup();
    render(<SinopiaSecondFactor user={user} />);

    await actor.type(screen.getByLabelText(text.code), '000000');
    await actor.click(screen.getByRole('button', { name: text.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(text.wrong);
    expect(screen.getByLabelText(text.code)).toHaveValue('');
  });

  it('should sign out instead, to use another account', async () => {
    signOut.mockResolvedValue();
    const actor = userEvent.setup();
    render(<SinopiaSecondFactor user={user} />);

    await actor.click(screen.getByRole('button', { name: text.signOut }));

    expect(signOut).toHaveBeenCalledOnce();
  });
});
