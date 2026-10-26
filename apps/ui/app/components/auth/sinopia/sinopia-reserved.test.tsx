// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { SinopiaReserved } from '#components/auth/sinopia/sinopia-reserved.js';

const session = vi.hoisted(() => ({ signOut: vi.fn<() => Promise<void>>() }));
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => session }));

const user = { id: 'user-sinopia', email: 'pilota@sinopialab.com' };

beforeEach(() => {
  session.signOut.mockReset();
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe.each([
  { language: 'it', title: 'SinopiaCAD è in anteprima riservata', back: 'Torna a Sinopia', signOut: 'Esci' },
  { language: 'en', title: 'SinopiaCAD is a reserved preview', back: 'Back to Sinopia', signOut: 'Sign out' },
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
