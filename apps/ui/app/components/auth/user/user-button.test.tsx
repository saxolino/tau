// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { SinopiaSessionState } from '#lib/sinopia-session.js';

const session = vi.hoisted(() => ({ data: undefined as unknown, isPending: true }));
/* SinopiaCAD: the Sinopia session that replaces Tau's account chrome when it exists. */
const sinopia = vi.hoisted((): { state: SinopiaSessionState; signOut: Mock<() => Promise<void>> } => ({
  state: { status: 'disabled' },
  signOut: vi.fn<() => Promise<void>>(),
}));
vi.mock('#hooks/use-sinopia-session.js', () => ({ useSinopiaSession: () => sinopia.state }));
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => ({ signOut: sinopia.signOut }) }));

vi.mock('@better-auth-ui/react', () => ({
  useAuth: () => ({
    authClient: {},
    basePaths: { auth: '/auth', settings: '/settings' },
    viewPaths: { auth: { signIn: 'sign-in', signOut: 'sign-out' }, settings: { account: 'account' } },
    localization: { auth: { account: 'Account', signOut: 'Sign out' }, settings: { settings: 'Settings' } },
    plugins: [],
    Link: ({ href, children }: { readonly href: string; readonly children?: React.ReactNode }) => (
      <a href={href}>{children}</a>
    ),
  }),
  useSession: () => session,
}));

const { UserButton } = await import('#components/auth/user/user-button.js');

afterEach(() => {
  sinopia.state = { status: 'disabled' };
  sinopia.signOut.mockReset();
});

describe('UserButton', () => {
  it('should keep the trigger named while the session loads', () => {
    render(<UserButton size='sm' />);

    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('should name the Sinopia account and sign out of Sinopia with «Esci»', async () => {
    sinopia.state = { status: 'signed-in', user: { id: 'user-sinopia', email: 'pilota@sinopialab.com' } };
    sinopia.signOut.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<UserButton size='sm' links={[{ label: 'Files', href: '/files' }]} />);

    await user.click(screen.getByRole('button', { name: /pilota@sinopialab\.com/u }));

    expect(screen.getByRole('link', { name: 'Files' })).toHaveAttribute('href', '/files');
    expect(screen.queryByRole('menuitem', { name: 'Log in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Esci' }));
    expect(sinopia.signOut).toHaveBeenCalledTimes(1);
  });
});
