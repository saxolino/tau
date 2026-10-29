// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { SinopiaRefused, SinopiaReserved } from '#components/auth/sinopia/sinopia-reserved.js';

const session = vi.hoisted(() => ({ signOut: vi.fn<() => Promise<void>>(), retryAccess: vi.fn<() => void>() }));
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => session }));

const user = { id: 'user-sinopia', email: 'pilota@sinopialab.com' };

beforeEach(() => {
  session.signOut.mockReset();
  session.retryAccess.mockReset();
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe.each([
  { language: 'it', title: 'SinopiaCAD: pilota riservato', back: 'Torna a Sinopia', signOut: 'Esci' },
  { language: 'en', title: 'SinopiaCAD: reserved pilot', back: 'Back to Sinopia', signOut: 'Sign out' },
] as const)('SinopiaReserved in $language', ({ language, title, back, signOut }) => {
  beforeEach(() => {
    setLanguage(language);
  });

  it('should say the preview is reserved and send the person back to Sinopia', () => {
    render(<SinopiaReserved user={user} />);

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(/pilota@sinopialab\.com/u)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: back })).toHaveAttribute('href', 'https://sinopialab.com/dashboard');
  });

  it('should sign out on request', async () => {
    session.signOut.mockResolvedValue();
    render(<SinopiaReserved user={user} />);

    await userEvent.setup().click(screen.getByRole('button', { name: signOut }));

    expect(session.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('SinopiaRefused', () => {
  const notice = { code: 'profession', link: { href: 'https://sinopialab.com/auth' } } as const;

  beforeEach(() => {
    setLanguage('it');
  });

  it('should say where to put things right, check again on request and leave only when asked', async () => {
    session.signOut.mockResolvedValue();
    const clicks = userEvent.setup();
    render(<SinopiaRefused notice={notice} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Scegli la tua professione su sinopialab.com');
    expect(screen.getByRole('link', { name: 'Vai a sinopialab.com' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/auth',
    );
    expect(session.signOut).not.toHaveBeenCalled();

    await clicks.click(screen.getByRole('button', { name: 'Ho fatto: controlla di nuovo' }));
    expect(session.retryAccess).toHaveBeenCalledOnce();

    await clicks.click(screen.getByRole('button', { name: 'Esci' }));
    expect(session.signOut).toHaveBeenCalledOnce();
  });
});
