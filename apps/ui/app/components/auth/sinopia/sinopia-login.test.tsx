// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinopiaSignInResult } from '#lib/sinopia-session.js';
import { SinopiaLogin } from '#components/auth/sinopia/sinopia-login.js';

const signIn = vi.hoisted(() => vi.fn<(email: string, password: string) => Promise<SinopiaSignInResult>>());
const signInWithGoogle = vi.hoisted(() => vi.fn<() => Promise<SinopiaSignInResult>>());
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => ({ signIn, signInWithGoogle }) }));

beforeEach(() => {
  signIn.mockReset();
  signInWithGoogle.mockReset();
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

  it('should explain a refused sign-in in Italian and clear the password', async () => {
    signIn.mockResolvedValue({ ok: false, message: 'Email o password non corretti.' });
    const user = userEvent.setup();
    render(<SinopiaLogin />);

    await user.type(screen.getByLabelText('Email'), 'pilota@sinopialab.com');
    await user.type(screen.getByLabelText('Password'), 'sbagliata');
    await user.click(screen.getByRole('button', { name: 'Accedi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email o password non corretti.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('pilota@sinopialab.com');
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Email o password non corretti.');
    expect(screen.getByRole('button', { name: 'Accedi' })).toBeEnabled();
  });

  it('should offer Google first, then the Sinopia password, and no sign-up', () => {
    render(<SinopiaLogin />);

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Continua con Google',
      'Accedi',
    ]);
    expect(screen.getByText('oppure con email e password')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
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
    signInWithGoogle.mockResolvedValue({
      ok: false,
      message: 'L’accesso con Google non è ancora attivo: entra con email e password.',
    });
    const user = userEvent.setup();
    render(<SinopiaLogin />);

    await user.click(screen.getByRole('button', { name: 'Continua con Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'L’accesso con Google non è ancora attivo: entra con email e password.',
    );
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Continua con Google' })).toBeEnabled();
  });

  it('should say why the last account was signed out, and link to sinopialab.com to complete it', () => {
    render(
      <SinopiaLogin
        notice={{
          message: 'Prima di usare SinopiaCAD accetta i Termini di servizio su sinopialab.com, poi torna qui.',
          link: { href: 'https://sinopialab.com/auth', label: 'Vai a sinopialab.com' },
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Prima di usare SinopiaCAD accetta i Termini di servizio su sinopialab.com, poi torna qui.',
    );
    expect(screen.getByRole('link', { name: 'Vai a sinopialab.com' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/auth',
    );
  });
});
