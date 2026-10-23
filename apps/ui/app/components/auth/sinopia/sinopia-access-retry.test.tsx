// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { SinopiaAccessRetry } from '#components/auth/sinopia/sinopia-access-retry.js';

const session = vi.hoisted(() => ({
  retryAccess: vi.fn<() => void>(),
  signOut: vi.fn<() => Promise<void>>(),
}));
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => session }));

const user = { id: 'user-sinopia', email: 'pilota@sinopialab.com' };

beforeEach(() => {
  session.retryAccess.mockReset();
  session.signOut.mockReset();
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe.each([
  {
    language: 'it',
    title: 'Non riesco a controllare il tuo account',
    retry: 'Riprova',
    signOut: 'Esci',
  },
  {
    language: 'en',
    title: 'I can’t check your account',
    retry: 'Try again',
    signOut: 'Sign out',
  },
] as const)('SinopiaAccessRetry in $language', ({ language, title, retry, signOut }) => {
  beforeEach(() => {
    setLanguage(language);
  });

  it('should say what happened, name the account and offer to try again', async () => {
    const actor = userEvent.setup();
    render(<SinopiaAccessRetry user={user} />);

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(/pilota@sinopialab\.com/u)).toBeInTheDocument();
    await actor.click(screen.getByRole('button', { name: retry }));

    expect(session.retryAccess).toHaveBeenCalledOnce();
  });

  it('should sign out instead', async () => {
    session.signOut.mockResolvedValue();
    const actor = userEvent.setup();
    render(<SinopiaAccessRetry user={user} />);

    await actor.click(screen.getByRole('button', { name: signOut }));

    expect(session.signOut).toHaveBeenCalledOnce();
  });
});
