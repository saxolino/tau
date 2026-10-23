// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinopiaSignInResult } from '#lib/sinopia-session.js';
import { SinopiaLogin } from '#components/auth/sinopia/sinopia-login.js';

const signIn = vi.hoisted(() => vi.fn<(email: string, password: string) => Promise<SinopiaSignInResult>>());
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => ({ signIn }) }));

beforeEach(() => {
  signIn.mockReset();
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

  it('should offer no sign-up and no social sign-in', () => {
    render(<SinopiaLogin />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
