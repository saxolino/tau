// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { SinopiaSessionState } from '#lib/sinopia-session.js';
import { SinopiaSessionGate } from '#components/auth/sinopia/sinopia-session-gate.js';

const sinopia = vi.hoisted((): { state: SinopiaSessionState; returnTo: string | undefined } => ({
  state: { status: 'checking' },
  returnTo: undefined,
}));
const session = vi.hoisted(() => ({
  settleReturn: vi.fn<(target: string) => void>(),
  retryAccess: vi.fn<() => void>(),
}));
vi.mock('#hooks/use-sinopia-session.js', () => ({
  useSinopiaSession: () => sinopia.state,
  useSinopiaReturn: () => sinopia.returnTo,
}));
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => session }));

const account = { id: 'user-sinopia', email: 'pilota@sinopialab.com' };

function Address(): React.JSX.Element {
  const { pathname, search, hash } = useLocation();
  return <output aria-label='Indirizzo'>{`${pathname}${search}${hash}`}</output>;
}

const renderGate = (address = '/') =>
  render(
    <MemoryRouter initialEntries={[address]}>
      <Address />
      <SinopiaSessionGate placeholder={<p>Caricamento del progetto</p>}>
        <p>Workspace</p>
      </SinopiaSessionGate>
    </MemoryRouter>,
  );

beforeEach(() => {
  setLanguage('it');
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
  sinopia.state = { status: 'checking' };
  sinopia.returnTo = undefined;
  session.settleReturn.mockReset();
  session.retryAccess.mockReset();
});

describe('SinopiaSessionGate', () => {
  it('should show the Sinopia sign-in screen instead of the workspace when signed out', () => {
    sinopia.state = { status: 'signed-out' };

    renderGate();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Accedi con il tuo account Sinopia',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continua con Google' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('should hand the sign-in screen why the last account was signed out', () => {
    sinopia.state = { status: 'signed-out', notice: { code: 'waitlisted' } };

    renderGate();

    expect(screen.getByRole('alert')).toHaveTextContent('Sei in lista d’attesa su Sinopia.');
  });

  it('should open the workspace when signed in', () => {
    sinopia.state = { status: 'signed-in', user: account };

    renderGate();

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Accedi con il tuo account Sinopia',
      }),
    ).not.toBeInTheDocument();
  });

  it("should show the caller's placeholder while the stored session is read or the account checked", () => {
    renderGate();

    expect(screen.getByText('Caricamento del progetto')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Accedi con il tuo account Sinopia',
      }),
    ).not.toBeInTheDocument();
  });

  it('should ask for the second factor before opening the workspace', () => {
    sinopia.state = { status: 'second-factor', user: account };

    renderGate();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Inserisci il codice dell’app di autenticazione',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Codice di verifica')).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('should offer «Riprova» when the access check could not be read', async () => {
    sinopia.state = { status: 'unverified', user: account };
    const user = userEvent.setup();
    renderGate();

    await user.click(screen.getByRole('button', { name: 'Riprova' }));

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Non riesco a controllare il tuo account',
      }),
    ).toBeInTheDocument();
    expect(session.retryAccess).toHaveBeenCalledOnce();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('should go back where the person was after Google before anything of the workspace renders', async () => {
    sinopia.state = { status: 'signed-in', user: account };
    sinopia.returnTo = '/w/studio/scarpa?chat=uno#vista';

    renderGate('/w/studio/scarpa?code=codice-google');

    expect(screen.getByText('Caricamento del progetto')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Indirizzo' })).toHaveTextContent(
      '/w/studio/scarpa?chat=uno#vista',
    );
    await vi.waitFor(() => {
      expect(session.settleReturn).toHaveBeenCalledWith('/w/studio/scarpa?chat=uno#vista');
    });
  });

  it('should show the sign-in screen and the notice in English when that is the language', () => {
    setLanguage('en');
    sinopia.state = { status: 'signed-out', notice: { code: 'waitlisted' } };

    renderGate();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Sign in with your Sinopia account',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('You’re on the Sinopia waiting list.');
  });

  it('should gate nothing without a Sinopia project', () => {
    sinopia.state = { status: 'disabled' };

    renderGate();

    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });
});
