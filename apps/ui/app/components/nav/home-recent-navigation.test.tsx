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
}));
vi.mock('#hooks/use-projects.js', () => ({ useProjects: () => state }));

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
