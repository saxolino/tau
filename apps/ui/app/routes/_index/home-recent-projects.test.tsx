import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { ProjectListItem } from '#types/project-library.types.js';

const state = vi.hoisted(() => ({
  projects: [] as ProjectListItem[],
  isLoading: false,
  error: undefined as Error | undefined,
}));
const retry = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('#hooks/use-projects.js', () => ({
  useProjects: () => ({
    projects: state.projects,
    isLoading: state.isLoading,
    error: state.error,
    retry,
  }),
}));
vi.mock('#hooks/use-project-thumbnail.js', () => ({
  useProjectThumbnail: (projectId: string) => ({
    url: projectId === 'proj_anello' ? 'blob:anello' : undefined,
    status: 'ready',
    error: undefined,
    refresh: vi.fn(),
  }),
}));
vi.mock('#lib/project-workspace-warmup.js', () => ({
  warmProjectWorkspace: vi.fn(),
}));

const { HomeRecentProjects, formatLastActivity, homeRecentProjectLimit } =
  await import('#routes/_index/home-recent-projects.js');

const now = Date.UTC(2026, 9, 23, 12);

const project = (id: string, name: string, lastActivityAt: number): ProjectListItem =>
  ({
    id,
    name,
    lastActivityAt,
    slugs: { workspaceSlug: 'home', projectSlug: id.replace('proj_', '') },
  }) as unknown as ProjectListItem;

const renderSection = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <HomeRecentProjects />
    </MemoryRouter>,
  );

describe('HomeRecentProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.projects = [];
    state.isLoading = false;
    state.error = undefined;
    setLanguage('it');
  });

  afterEach(() => {
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });

  it.each([
    {
      language: 'it',
      title: 'I tuoi progetti',
      empty: 'Nessun progetto ancora',
      edited: 'Modificato 5 minuti fa',
      open: 'Apri Anello',
    },
    {
      language: 'en',
      title: 'Your projects',
      empty: 'No projects yet',
      edited: 'Edited 5 minutes ago',
      open: 'Open Anello',
    },
  ] as const)('writes the section in $language', ({ language, title, empty, edited, open }) => {
    setLanguage(language);
    renderSection();
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: empty })).toBeInTheDocument();

    cleanup();
    state.projects = [project('proj_anello', 'Anello', Date.now() - 5 * 60_000)];
    renderSection();
    expect(screen.getByText(edited)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: open })).toBeInTheDocument();
  });

  it('shows the most recent projects first, as cards that open them, with the way to the whole library', () => {
    state.projects = [
      project('proj_spilla', 'Spilla', now - 3 * 24 * 60 * 60_000),
      project('proj_anello', 'Anello a fascia', now - 5 * 60_000),
    ];
    renderSection();

    expect(screen.getByRole('heading', { level: 2, name: 'I tuoi progetti' })).toBeInTheDocument();
    const cards = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Anello a fascia',
      'Spilla',
    ]);
    expect(within(cards[0]!).getByRole('link', { name: 'Apri Anello a fascia' })).toHaveAttribute(
      'href',
      '/w/home/anello',
    );
    // The thumbnail is decorative: the link names the card.
    expect(cards[0]!.querySelector('img')).toHaveAttribute('src', 'blob:anello');
    expect(cards[0]!.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.getByRole('link', { name: 'Tutti i progetti' })).toHaveAttribute('href', '/projects');
  });

  it('keeps to two rows of the widest grid', () => {
    state.projects = Array.from({ length: homeRecentProjectLimit + 3 }, (_, index) =>
      project(`proj_${index}`, `Pezzo ${index}`, now - index * 60_000),
    );
    renderSection();

    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(homeRecentProjectLimit);
  });

  it('says how to start when there are no projects yet', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: 'Nessun progetto ancora' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tutti i progetti' })).not.toBeInTheDocument();
  });

  it('shows loading in the grid’s own shape', () => {
    state.isLoading = true;
    renderSection();

    expect(screen.getByRole('status', { name: 'Caricamento dei progetti' })).toHaveAttribute('aria-busy', 'true');
  });

  it('reports a failed listing with a way to retry', async () => {
    state.error = new Error('listing failed');
    renderSection();

    expect(screen.getByRole('alert')).toHaveTextContent('Non riesco a caricare i progetti.');
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('formatLastActivity', () => {
  it('says when a project was last worked on, in Italian', () => {
    expect(formatLastActivity(now - 10_000, 'it', now)).toBe('adesso');
    expect(formatLastActivity(now - 5 * 60_000, 'it', now)).toBe('5 minuti fa');
    expect(formatLastActivity(now - 3 * 60 * 60_000, 'it', now)).toBe('3 ore fa');
    expect(formatLastActivity(now - 24 * 60 * 60_000, 'it', now)).toBe('ieri');
    expect(formatLastActivity(Date.UTC(2026, 8, 1, 12), 'it', now)).toBe('1 settembre 2026');
  });

  it('says it in English too', () => {
    expect(formatLastActivity(now - 10_000, 'en', now)).toBe('now');
    expect(formatLastActivity(now - 5 * 60_000, 'en', now)).toBe('5 minutes ago');
    expect(formatLastActivity(now - 3 * 60 * 60_000, 'en', now)).toBe('3 hours ago');
    expect(formatLastActivity(now - 24 * 60 * 60_000, 'en', now)).toBe('yesterday');
    expect(formatLastActivity(Date.UTC(2026, 8, 1, 12), 'en', now)).toBe('September 1, 2026');
  });
});
