import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar, sinopiaDashboardUrl } from '#components/layout/app-sidebar.js';
import { SidebarProvider } from '#components/ui/sidebar.js';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { featureFlagDefaults } from '#flags/flag.constants.js';
import type { FeatureFlags } from '#flags/flag.constants.js';

const mockState = vi.hoisted(() => ({
  flags: undefined as FeatureFlags | undefined,
  open: true,
}));

vi.mock('#flags/use-feature.js', () => ({
  useFeatureFlags: () => mockState.flags,
}));

vi.mock('#hooks/use-cookie.js', () => ({
  useCookie: () => [mockState.open, vi.fn()] as const,
}));

vi.mock('@taucad/ui/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('#components/layout/command-palette.js', () => ({
  Commands: () => <button type='button'>Search projects and chats</button>,
}));

vi.mock('#components/nav/project-navigation-command-items.js', () => ({
  ProjectNavigationCommandItems: () => undefined,
}));

vi.mock('#components/nav/nav-user.js', () => ({
  NavUser: () => <button type='button'>Account</button>,
}));

vi.mock('#components/icons/tau-wordmark.js', () => ({
  TauWordmark: ({ className }: { readonly className?: string }) => <svg aria-hidden className={className} />,
}));

vi.mock('#components/nav/home-recent-navigation.js', () => ({
  HomeRecentNavigation: () => <div>Recent projects</div>,
}));

function renderSidebar(path = '/projects'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <KeyboardProvider>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
          </SidebarProvider>
        </TooltipProvider>
      </KeyboardProvider>
    </MemoryRouter>,
  );
}

function getNavLink(name: string): HTMLElement | undefined {
  return screen.queryByRole('link', { name }) ?? undefined;
}

describe('AppSidebar', () => {
  beforeEach(() => {
    mockState.flags = featureFlagDefaults;
    mockState.open = true;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should show the home navigation without new-project or More controls', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');
    expect(screen.getByText('Recent projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(screen.queryByText('New project')).not.toBeInTheDocument();
  });

  it('should lead back to Sinopia with a path when served under /cad of sinopialab.com', () => {
    vi.stubEnv('BASE_URL', '/cad/');
    try {
      expect(sinopiaDashboardUrl()).toBe('/dashboard');
    } finally {
      vi.unstubAllEnvs();
    }
    expect(sinopiaDashboardUrl()).toBe('https://sinopialab.com/dashboard');
  });

  it('should lead back to Sinopia’s dashboard with a full navigation, and end with the account card', () => {
    renderSidebar('/w/home/bracket');
    const back = screen.getByRole('link', { name: 'Back to Sinopia' });
    expect(back).toHaveAttribute('href', 'https://sinopialab.com/dashboard');
    expect(back.closest('[data-slot=sidebar-footer]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Sinopia' })).toBeInTheDocument();
    // The footer's last row is the account card.
    const footer = back.closest('[data-slot=sidebar-footer]');
    expect(footer?.lastElementChild?.textContent).toContain('Account');
  });

  it('should name the current page by its row, with the projects row current under /projects too', () => {
    renderSidebar('/projects/trash');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('navigation', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('should keep the same frame on every page, the home no longer current elsewhere', () => {
    renderSidebar('/w/home/bracket');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Recent projects')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(screen.queryByText('New project')).not.toBeInTheDocument();
  });

  it('should list the page tools that are on under Tools, and none of Tau’s More destinations', () => {
    mockState.flags = { ...featureFlagDefaults, machines: true, partsWarehouse: true, pluginsStore: true };
    renderSidebar();

    expect(getNavLink('Convert a file')).toHaveAttribute('href', '/convert');
    expect(getNavLink('Import a file')).toHaveAttribute('href', '/import');
    for (const name of ['Community', 'Machines', 'Parts', 'Plugins', 'Usage']) {
      expect(getNavLink(name)).toBeUndefined();
    }
  });

  it('uses an Allotment-owned browser pane without duplicate titlebar controls', () => {
    const { container } = renderSidebar();
    const sidebar = screen.getByRole('complementary', { name: 'Application sidebar' });
    const projectsButton = getNavLink('Projects');

    expect(sidebar).toHaveAttribute('id', 'app-sidebar');
    expect(sidebar).toHaveClass('w-full', 'border-r');
    expect(projectsButton).toHaveClass('data-[active=true]:text-foreground');
    expect(projectsButton).not.toHaveClass('data-[active=true]:text-primary');
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(container.querySelector('[data-slot=sidebar-header]')).toHaveClass('h-9');
    expect(container.querySelector('[data-slot=sidebar-header] [data-slot=sidebar-trigger]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot=sidebar-header] a')).not.toBeInTheDocument();
  });

  it('reserves only the top control row without duplicate identity or controls', () => {
    vi.stubEnv('TAU_TARGET', 'desktop');
    const { container } = renderSidebar();

    expect(container.querySelector('[data-slot=sidebar-header]')).toHaveClass('h-9', 'p-0');
    expect(container.querySelector('[data-slot=sidebar-header] a')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot=sidebar-header] [data-slot=sidebar-trigger]')).not.toBeInTheDocument();
  });

  it('removes the hidden Allotment pane from interaction and the accessibility tree', () => {
    mockState.open = false;
    const { container } = renderSidebar();
    const sidebar = container.querySelector('#app-sidebar');

    expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    expect(sidebar).toHaveAttribute('inert');
  });

  it('should use compact spacing for desktop navigation', () => {
    vi.stubEnv('TAU_TARGET', 'desktop');
    const { container } = renderSidebar();
    expect(container.querySelector('[data-slot=sidebar-header]')).toHaveClass('h-9', 'p-0');
    expect(container.querySelector('[data-slot=sidebar-header]')).not.toHaveClass('h-18', 'pt-9');
    expect(container.querySelector('[data-slot=sidebar-header] a')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it.each([
    ['it', { projects: 'Progetti', convert: 'Converti un file', label: 'Barra laterale dell’applicazione' }],
    ['en', { projects: 'Projects', convert: 'Convert a file', label: 'Application sidebar' }],
  ] as const)('should write the navigation in %s', (language, { projects, convert, label }) => {
    setLanguage(language);
    renderSidebar();

    expect(screen.getByRole('complementary', { name: label })).toBeInTheDocument();
    expect(getNavLink(projects)).toHaveAttribute('href', '/projects');
    expect(getNavLink(convert)).toHaveAttribute('href', '/convert');
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });
});
