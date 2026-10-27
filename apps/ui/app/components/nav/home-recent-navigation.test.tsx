import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeRecentNavigation } from '#components/nav/home-recent-navigation.js';
import { SidebarProvider } from '#components/ui/sidebar.js';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import type { ProjectListItem } from '#types/project-library.types.js';
import { mock } from 'vitest-mock-extended';

const state = vi.hoisted(() => ({
  projects: [] as ProjectListItem[],
  isLoading: false,
  error: undefined as Error | undefined,
  retry: vi.fn(),
  thumbnails: new Map<string, string>(),
}));
vi.mock('#hooks/use-projects.js', () => ({ useProjects: () => state }));
vi.mock('#hooks/use-project-thumbnail.js', () => ({
  useProjectThumbnail: (id: string) => ({ url: state.thumbnails.get(id) }),
}));

const renderNavigation = () =>
  render(
    <MemoryRouter>
      <KeyboardProvider>
        <TooltipProvider>
          <SidebarProvider>
            <HomeRecentNavigation />
          </SidebarProvider>
        </TooltipProvider>
      </KeyboardProvider>
    </MemoryRouter>,
  );

describe('HomeRecentNavigation', () => {
  beforeEach(() => {
    state.isLoading = false;
    state.error = undefined;
    state.projects = [];
    state.thumbnails = new Map();
  });

  it('should show each project’s thumbnail beside its name, and say «Senza nome» for a placeholder', () => {
    state.projects = [
      mock<ProjectListItem>({
        id: 'named',
        name: 'Cornice fibbia',
        lastActivityAt: 2,
        slugs: { workspaceSlug: 'home', projectSlug: 'cornice-fibbia' },
      }),
      mock<ProjectListItem>({
        id: 'placeholder',
        name: 'New Project',
        lastActivityAt: 1,
        slugs: { workspaceSlug: 'home', projectSlug: 'new-project' },
      }),
    ];
    state.thumbnails = new Map([['named', 'blob:thumb-named']]);
    renderNavigation();
    const links = within(screen.getByRole('list')).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Cornice fibbia', 'Untitled']);
    expect(links[0]?.querySelector('img')).toHaveAttribute('src', 'blob:thumb-named');
    expect(links[1]?.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument();
  });

  it('should leave the section out when there is nothing to list', () => {
    const { container } = renderNavigation();
    expect(container.querySelector('[data-slot=sidebar-section]')).toBeNull();
  });

  it('should list the eight most recent projects with working destinations', () => {
    state.projects = Array.from({ length: 10 }, (_, index) =>
      mock<ProjectListItem>({
        id: `project-${index}`,
        name: `Anello ${index}`,
        lastActivityAt: index,
        slugs: { workspaceSlug: 'home', projectSlug: `anello-${index}` },
      }),
    );
    renderNavigation();
    const links = within(screen.getByRole('list')).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(
      Array.from({ length: 8 }, (_, index) => `Anello ${9 - index}`),
    );
    expect(links[0]).toHaveAttribute('href', '/w/home/anello-9');
    expect(state.projects[0]?.name).toBe('Anello 0');
  });

  it('should announce loading instead of an empty project list', () => {
    state.isLoading = true;
    renderNavigation();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});
