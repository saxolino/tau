// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SinopiaSessionState } from '#lib/sinopia-session.js';
import { SinopiaSessionGate } from '#components/auth/sinopia/sinopia-session-gate.js';

const sinopia = vi.hoisted((): { state: SinopiaSessionState } => ({ state: { status: 'checking' } }));
vi.mock('#hooks/use-sinopia-session.js', () => ({ useSinopiaSession: () => sinopia.state }));

const renderGate = () =>
  render(
    <SinopiaSessionGate placeholder={<p>Caricamento del progetto</p>}>
      <p>Workspace</p>
    </SinopiaSessionGate>,
  );

afterEach(() => {
  sinopia.state = { status: 'checking' };
});

describe('SinopiaSessionGate', () => {
  it('should show the Sinopia sign-in screen instead of the workspace when signed out', () => {
    sinopia.state = { status: 'signed-out' };

    renderGate();

    expect(screen.getByRole('heading', { level: 1, name: 'Accedi con il tuo account Sinopia' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('should open the workspace when signed in', () => {
    sinopia.state = { status: 'signed-in', user: { id: 'user-sinopia', email: 'pilota@sinopialab.com' } };

    renderGate();

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Accedi con il tuo account Sinopia' })).not.toBeInTheDocument();
  });

  it("should show the caller's placeholder while the stored session is read", () => {
    renderGate();

    expect(screen.getByText('Caricamento del progetto')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Accedi con il tuo account Sinopia' })).not.toBeInTheDocument();
  });

  it('should gate nothing without a Sinopia project', () => {
    sinopia.state = { status: 'disabled' };

    renderGate();

    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });
});
