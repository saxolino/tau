// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { SinopiaSignInResult } from '#lib/sinopia-session.js';
import { SinopiaLogin } from '#components/auth/sinopia/sinopia-login.js';

const signIn = vi.hoisted(() => vi.fn<(email: string, password: string) => Promise<SinopiaSignInResult>>());
const signInWithGoogle = vi.hoisted(() => vi.fn<() => Promise<SinopiaSignInResult>>());
vi.mock('#lib/sinopia-session.js', () => ({
  sinopiaSession: () => ({ signIn, signInWithGoogle }),
}));

beforeEach(() => {
  signIn.mockReset();
  signInWithGoogle.mockReset();
  setLanguage('it');
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('SinopiaLogin', () => {
  it('should sign in with the trimmed email and the password', async () => {
    signIn.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SinopiaLogin />);

    await user.type(screen.getByLabelText('Email'), '  pilota@sinopialab.com ');
    await user.type(screen.getByLabelText('Password'), 'segreta');
    await user.click(screen.getByRole('button', { name: 'Accedi' }));

    expect(signIn).toHaveBeenCalledWith('pilota@sinopialab.com', 'segreta');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should explain a refused sign-in and clear the password', async () => {
    signIn.mockResolvedValue({ ok: false, code: 'invalidCredentials' });
    const user = userEvent.setup();
    render(<SinopiaLogin />);

    await user.type(screen.getByLabelText('Email'), 'pilota@sinopialab.com');
    await user.type(screen.getByLabelText('Password'), 'sbagliata');
    await user.click(screen.getByRole('button', { name: 'Accedi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email o password non corretti. Controlla e riprova.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('pilota@sinopialab.com');
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'Email o password non corretti. Controlla e riprova.',
    );
    expect(screen.getByRole('button', { name: 'Accedi' })).toBeEnabled();
  });

  it('should offer Google first, then the Sinopia password, and link registration to Sinopia', () => {
    render(<SinopiaLogin />);

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Continua con Google',
      'Accedi',
      'Italiano',
      'English',
    ]);
    expect(screen.getByText('oppure con email e password')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Non hai un account? Registrati su sinopialab.com' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/auth',
    );
  });

  it('should leave for Google from the button', async () => {
    signInWithGoogle.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SinopiaLogin />);

    await user.click(screen.getByRole('button', { name: 'Continua con Google' }));

    expect(signInWithGoogle).toHaveBeenCalledOnce();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('should explain a Google sign-in that cannot start, above the ways in', async () => {
    signInWithGoogle.mockResolvedValue({ ok: false, code: 'googleDisabled' });
    const user = userEvent.setup();
    render(<SinopiaLogin />);

    await user.click(screen.getByRole('button', { name: 'Continua con Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'L’accesso con Google non è ancora attivo. Entra con email e password.',
    );
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Continua con Google' })).toBeEnabled();
  });

  it('should say why the last account was signed out, and link to sinopialab.com to complete it', () => {
    render(
      <SinopiaLogin
        notice={{
          code: 'terms',
          link: { href: 'https://sinopialab.com/auth' },
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Accetta le Condizioni d’uso su sinopialab.com, poi torna qui.',
    );
    expect(screen.getByRole('link', { name: 'Vai a sinopialab.com' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/auth',
    );
  });
});

describe.each([
  {
    language: 'it',
    title: 'Accedi con il tuo account Sinopia',
    google: 'Continua con Google',
    submit: 'Accedi',
    separator: 'oppure con email e password',
    wrong: 'Email o password non corretti. Controlla e riprova.',
    link: 'Vai a sinopialab.com',
  },
  {
    language: 'en',
    title: 'Sign in with your Sinopia account',
    google: 'Continue with Google',
    submit: 'Sign in',
    separator: 'or with email and password',
    wrong: 'Wrong email or password. Check them and try again.',
    link: 'Go to sinopialab.com',
  },
] as const)('SinopiaLogin in $language', ({ language, title, google, submit, separator, wrong, link }) => {
  beforeEach(() => {
    setLanguage(language);
  });

  it('should write the whole screen in the language', () => {
    render(<SinopiaLogin />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: google })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: submit })).toBeInTheDocument();
    expect(screen.getByText(separator)).toBeInTheDocument();
    expect(document.querySelector('main')).toHaveAttribute('lang', language);
  });

  it('should offer the reason and a remedy on a dedicated refusal card', async () => {
    const user = userEvent.setup();
    render(<SinopiaLogin notice={{ code: 'terms', link: { href: 'https://sinopialab.com/auth' } }} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: link })).toHaveAttribute('href', 'https://sinopialab.com/auth');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: language === 'it' ? 'Esci' : 'Sign out' }));
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('should write a refused sign-in in the language', async () => {
    signIn.mockResolvedValue({ ok: false, code: 'invalidCredentials' });
    const user = userEvent.setup();
    render(<SinopiaLogin />);

    await user.type(screen.getByLabelText('Email'), 'pilota@sinopialab.com');
    await user.type(screen.getByLabelText('Password'), 'sbagliata');
    await user.click(screen.getByRole('button', { name: submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(wrong);
  });
});

describe('SinopiaLogin language switch', () => {
  it('should mark the current language and switch the whole screen on a click', async () => {
    const user = userEvent.setup();
    render(<SinopiaLogin />);
    const group = screen.getByRole('group', { name: 'Lingua' });

    expect(within(group).getByRole('button', { name: 'Italiano' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(group).getByRole('button', { name: 'English' }));

    expect(getLanguage()).toBe('en');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Sign in with your Sinopia account',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });
});
