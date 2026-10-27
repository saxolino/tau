// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { NavUser } from '#components/nav/nav-user.js';
import * as Cookies from 'es-cookie';
import { metaConfig } from '#constants/meta.constants.js';

import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

const clientEnvironment = globalThis.window.ENV;
const useNetworkConnectivityMock = vi.hoisted(() => vi.fn(() => true));
const useEntitlementsMock = vi.hoisted(() => vi.fn(() => ({ tier: 'free', isResolved: true })));

vi.mock('@taucad/billing/hooks/use-entitlements', () => ({
  useEntitlements: useEntitlementsMock,
}));

vi.mock('#components/auth/user/user-button.js', () => ({
  UserButton: ({
    links,
    size,
    side,
  }: {
    readonly links?: Array<{ readonly href: string; readonly label: ReactNode } | ReactElement>;
    readonly size?: string;
    readonly side?: string;
  }) => (
    <div data-testid='user-button' data-size={size} data-side={side}>
      {links?.map((link) =>
        isValidElement(link) ? (
          link
        ) : (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ),
      )}
    </div>
  ),
}));

vi.mock('#hooks/use-network-connectivity.js', () => ({
  useNetworkConnectivity: useNetworkConnectivityMock,
}));

vi.mock('@taucad/ui/components/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { readonly children?: React.ReactNode }) => <div role='menuitem'>{children}</div>,
  DropdownMenuLabel: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@taucad/ui/components/client-only', () => ({
  ClientOnly: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@taucad/ui/components/tooltip', () => ({
  Tooltip: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { readonly children?: React.ReactNode }) => <span>{children}</span>,
  TooltipContent: ({ children }: { readonly children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('#components/icons/svg-icon.js', () => ({ SvgIcon: () => <span aria-hidden /> }));

vi.mock('#components/tier-badge.js', () => ({
  ProBadge: () => <span>Pro</span>,
}));

describe('NavUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNetworkConnectivityMock.mockReturnValue(true);
    useEntitlementsMock.mockReturnValue({ tier: 'free', isResolved: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.window.ENV = clientEnvironment;
  });

  it('shows product navigation, upgrade, and settings to free users', () => {
    render(<NavUser />, { wrapper: MemoryRouter });

    expect(screen.getByText('Upgrade to Pro')).toBeDefined();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Files' })).toHaveAttribute('href', '/files');
    expect(within(screen.getByTestId('user-button')).queryByRole('link', { name: 'Documentation' })).toBeNull();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    // The account card: avatar, name and address on two lines, so the full-size view, never the compact one.
    expect(screen.getByTestId('user-button')).toHaveAttribute('data-size', 'default');
    expect(screen.getByTestId('user-button')).toHaveAttribute('data-side', 'top');
  });

  it('shows billing instead of upgrade to paid users', () => {
    useEntitlementsMock.mockReturnValue({ tier: 'pro', isResolved: true });

    render(<NavUser />, { wrapper: MemoryRouter });

    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('never offers an upgrade before the plan is known', () => {
    useEntitlementsMock.mockReturnValue({ tier: 'free', isResolved: false });

    render(<NavUser />, { wrapper: MemoryRouter });

    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
  });

  it('moves product help into its own menu with the current version', () => {
    render(<NavUser />, { wrapper: MemoryRouter });

    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
    // SinopiaCAD: Tau's documentation, bug tracker and community links are gone; the site link is Sinopia's.
    expect(screen.queryByRole('link', { name: 'Documentation' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sinopia website' })).toHaveAttribute('href', 'https://sinopialab.com');
    // SinopiaCAD: privacy and terms are Sinopia's own documents; the open-source notices stay upstream.
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/privacy-policy',
    );
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/beta/condizioni',
    );
    expect(screen.getByRole('link', { name: 'Open-source notices' })).toHaveAttribute(
      'href',
      'https://tau.new/legal/open-source',
    );
    expect(screen.getByRole('menuitem', { name: 'Cookie preferences' })).toBeInTheDocument();
    expect(screen.queryByText('Report a bug')).not.toBeInTheDocument();
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
    expect(screen.queryByText('Community Discord')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByText(`SinopiaCAD v${metaConfig.version}`)).toBeInTheDocument();
    expect(screen.queryByText('About Tau')).not.toBeInTheDocument();
  });

  it('should keep Sinopia’s legal pages and the upstream notices on the deployment the desktop shell is bound to', () => {
    vi.stubEnv('TAU_TARGET', 'desktop');
    globalThis.window.ENV = {
      ...clientEnvironment,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- `window.ENV`'s keys are the deployment's own environment variable names.
      TAU_FRONTEND_URL: 'https://taucad.dev',
    };

    render(<NavUser />, { wrapper: MemoryRouter });

    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/privacy-policy',
    );
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/beta/condizioni',
    );
    expect(screen.getByRole('link', { name: 'Open-source notices' })).toHaveAttribute(
      'href',
      'https://taucad.dev/legal/open-source',
    );
  });

  it('shows connectivity in the footer row and user menu only while offline', () => {
    useNetworkConnectivityMock.mockReturnValue(false);

    render(<NavUser />, { wrapper: MemoryRouter });

    expect(screen.getByRole('status', { name: 'Offline' })).toBeInTheDocument();
    expect(screen.getByText('Offline: online features unavailable')).toBeInTheDocument();
  });
});

describe('NavUser language', () => {
  afterEach(() => {
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });

  it.each([
    ['it', { help: 'Aiuto', website: 'Sito di Sinopia', cookies: 'Preferenze sui cookie' }],
    ['en', { help: 'Help', website: 'Sinopia website', cookies: 'Cookie preferences' }],
  ] as const)('should write the help menu in %s', (language, { help, website, cookies }) => {
    setLanguage(language);
    render(<NavUser />, { wrapper: MemoryRouter });

    expect(screen.getByRole('button', { name: help })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: website })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: cookies })).toBeInTheDocument();
  });
});

describe('Sinopia website link', () => {
  beforeEach(() => {
    globalThis.window.ENV = {
      ...clientEnvironment,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- `window.ENV`'s keys are the deployment's own environment variable names.
      TAU_FRONTEND_URL: 'https://tau.new',
    };
  });
  afterEach(() => {
    globalThis.window.ENV = clientEnvironment;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Cookies.remove('tau-entry', { path: '/' });
  });
  it('should open sinopialab.com in a new tab without choosing the start page', () => {
    const assign = vi.fn();
    // On the origin that serves Tau's website, the old link switched the start page; Sinopia's never does.
    vi.stubGlobal('location', { protocol: 'http:', origin: 'https://tau.new', assign });
    render(<NavUser />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: 'Sinopia website' });
    expect(link).toHaveAttribute('href', 'https://sinopialab.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(Cookies.get('tau-entry')).toBeUndefined();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Visit website' })).not.toBeInTheDocument();
  });
  it('should omit the web-only link in desktop', () => {
    vi.stubEnv('TAU_TARGET', 'desktop');
    render(<NavUser />, { wrapper: MemoryRouter });
    expect(screen.queryByRole('link', { name: 'Sinopia website' })).not.toBeInTheDocument();
  });
});
