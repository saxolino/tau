// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinopiaSignInResult } from '#lib/sinopia-session.js';
import { SinopiaSecondFactor } from '#components/auth/sinopia/sinopia-second-factor.js';

const verifySecondFactor = vi.hoisted(() => vi.fn<(code: string) => Promise<SinopiaSignInResult>>());
const signOut = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => ({ verifySecondFactor, signOut }) }));

const user = { id: 'user-sinopia', email: 'pilota@sinopialab.com' };

beforeEach(() => {
  verifySecondFactor.mockReset();
  signOut.mockReset();
});

describe('SinopiaSecondFactor', () => {
  it("should confirm the account with the authenticator's six digits", async () => {
    verifySecondFactor.mockResolvedValue({ ok: true });
    const actor = userEvent.setup();
    render(<SinopiaSecondFactor user={user} />);
    const continueButton = screen.getByRole('button', { name: 'Continua' });
    expect(continueButton).toBeDisabled();

    await actor.type(screen.getByLabelText('Codice di verifica'), '12 34-567');

    expect(screen.getByLabelText('Codice di verifica')).toHaveValue('123456');
    await actor.click(continueButton);
    expect(verifySecondFactor).toHaveBeenCalledWith('123456');
  });

  it('should explain a wrong code in Italian and clear it', async () => {
    verifySecondFactor.mockResolvedValue({
      ok: false,
      message: 'Codice non valido o scaduto. Riprova con il codice attuale dell’app.',
    });
    const actor = userEvent.setup();
    render(<SinopiaSecondFactor user={user} />);

    await actor.type(screen.getByLabelText('Codice di verifica'), '000000');
    await actor.click(screen.getByRole('button', { name: 'Continua' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Codice non valido o scaduto. Riprova con il codice attuale dell’app.',
    );
    expect(screen.getByLabelText('Codice di verifica')).toHaveValue('');
  });

  it('should sign out instead, to use another account', async () => {
    signOut.mockResolvedValue();
    const actor = userEvent.setup();
    render(<SinopiaSecondFactor user={user} />);

    await actor.click(screen.getByRole('button', { name: 'Esci e accedi con un altro account' }));

    expect(signOut).toHaveBeenCalledOnce();
  });
});
