// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { SinopiaMessageCode } from '#lib/sinopia-access.js';
import type { SinopiaSignInResult } from '#lib/sinopia-session.js';
import { SinopiaGoogleButton } from '#components/auth/sinopia/sinopia-google-button.js';

const signInWithGoogle = vi.hoisted(() => vi.fn<() => Promise<SinopiaSignInResult>>());
vi.mock('#lib/sinopia-session.js', () => ({
  sinopiaSession: () => ({ signInWithGoogle }),
}));

const onStart = vi.fn<() => void>();
const onError = vi.fn<(code: SinopiaMessageCode) => void>();

const pageShow = (persisted: boolean): void => {
  act(() => {
    globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted }));
  });
};

beforeEach(() => {
  signInWithGoogle.mockReset();
  onStart.mockReset();
  onError.mockReset();
  setLanguage('it');
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('SinopiaGoogleButton', () => {
  it('should leave for Google and stay busy while the browser is on its way', async () => {
    signInWithGoogle.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SinopiaGoogleButton onStart={onStart} onError={onError} />);

    await user.click(screen.getByRole('button', { name: 'Continua con Google' }));

    expect(signInWithGoogle).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledOnce();
    const button = screen.getByRole('button', {
      name: 'Reindirizzamento a Google…',
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(onError).not.toHaveBeenCalled();
  });

  it('should hand the message code on and free the button when Google cannot start', async () => {
    signInWithGoogle.mockResolvedValue({ ok: false, code: 'googleFailed' });
    const user = userEvent.setup();
    render(<SinopiaGoogleButton onStart={onStart} onError={onError} />);

    await user.click(screen.getByRole('button', { name: 'Continua con Google' }));

    expect(onError).toHaveBeenCalledWith('googleFailed');
    expect(screen.getByRole('button', { name: 'Continua con Google' })).toBeEnabled();
  });

  it('should free the button when the page comes back from the cache with the back button', async () => {
    signInWithGoogle.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SinopiaGoogleButton onStart={onStart} onError={onError} />);
    await user.click(screen.getByRole('button', { name: 'Continua con Google' }));

    pageShow(false);

    expect(screen.getByRole('button', { name: 'Reindirizzamento a Google…' })).toBeDisabled();

    pageShow(true);

    expect(screen.getByRole('button', { name: 'Continua con Google' })).toBeEnabled();
  });

  it('should wait while another sign-in is under way', () => {
    render(<SinopiaGoogleButton isDisabled onStart={onStart} onError={onError} />);

    expect(screen.getByRole('button', { name: 'Continua con Google' })).toBeDisabled();
  });
});

describe.each([
  {
    language: 'it',
    idle: 'Continua con Google',
    busy: 'Reindirizzamento a Google…',
  },
  {
    language: 'en',
    idle: 'Continue with Google',
    busy: 'Redirecting to Google…',
  },
] as const)('SinopiaGoogleButton in $language', ({ language, idle, busy }) => {
  it('should write its label in the language of the screen', async () => {
    setLanguage(language);
    signInWithGoogle.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SinopiaGoogleButton onStart={onStart} onError={onError} />);

    await user.click(screen.getByRole('button', { name: idle }));

    expect(screen.getByRole('button', { name: busy })).toBeDisabled();
  });
});
