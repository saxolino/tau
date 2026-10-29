import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type * as CloudProjectsModule from '#hooks/use-cloud-projects.js';
import type * as OpenCloudProjectModule from '#hooks/use-open-cloud-project.js';
import type { CloudProject } from '#hooks/use-cloud-projects.js';
import type { ProjectListItem } from '#types/project-library.types.js';

const state = vi.hoisted(() => ({
  projects: [] as ProjectListItem[],
  cloudProjects: [] as CloudProject[],
  isLoading: false,
  error: undefined as Error | undefined,
}));

const openCloud = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('#hooks/use-cloud-projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof CloudProjectsModule>()),
  useCloudProjects: () => ({
    projects: state.cloudProjects,
    isSettled: true,
    isFailed: false,
    isFetching: false,
    retry: vi.fn(),
  }),
}));
vi.mock('#hooks/use-open-cloud-project.js', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenCloudProjectModule>()),
  useOpenCloudProject: () => openCloud,
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('#components/ui/sonner.js', () => ({ toast: { error: toastError } }));
vi.mock('#routes/_index/sinopia-project-strip.js', () => ({ SinopiaReferenceThumbnail: () => <div /> }));

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

const renderSection = (pieceCounts?: ReadonlyMap<string, number>, path = '/'): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <HomeRecentProjects pieceCounts={pieceCounts} />
    </MemoryRouter>,
  );

describe('HomeRecentProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.projects = [];
    state.cloudProjects = [];
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

  it('should merge remote models without duplicate held cards and open remote-only models through the import owner', async () => {
    state.projects = [project('held', 'Local necklace', now)];
    state.cloudProjects = [
      { id: 'held', name: 'Remote copy', role: 'owner', updatedAt: now },
      { id: 'remote', name: 'Remote bracelet', role: 'owner', updatedAt: now + 1 },
    ];
    renderSection();
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Remote bracelet',
      'Local necklace',
    ]);
    expect(screen.queryByRole('heading', { name: 'Remote copy' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Apri Remote bracelet' }));
    expect(openCloud).toHaveBeenCalledWith(expect.objectContaining(state.cloudProjects[1]!));
  });

  it('should mark a Sinopia model with no saved file yet and say so when it cannot open', async () => {
    const sinopia = {
      id: '70d7a84c-0000-4000-8000-000000000001',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
      project_id: '11111111-0000-4000-8000-000000000002',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
      user_id: '22222222-0000-4000-8000-000000000003',
      name: 'Cornice fibbia',
      engine: 'smlib',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
      head_revision_id: null,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
      snapshot_path: null,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
      thumbnail_path: null,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
      snapshot_bytes: null,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
      updated_at: new Date(now).toISOString(),
    } as const;
    state.cloudProjects = [
      { id: 'proj_cornice', name: 'Cornice fibbia', role: 'owner', updatedAt: Date.now() - 5 * 60_000, sinopia },
      {
        id: 'proj_fibbia',
        name: 'Fibbia',
        role: 'owner',
        updatedAt: Date.now() - 6 * 60_000,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire column.
        sinopia: {
          ...sinopia,
          id: '70d7a84c-0000-4000-8000-000000000009',
          snapshot_path: 'projects/p/cad/m/model.zip',
        },
      },
    ];
    openCloud.mockRejectedValueOnce(new Error('SINOPIA_MODEL_NOT_SAVED'));
    renderSection();
    const [unsaved, saved] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(unsaved).toHaveTextContent('Modificato 5 minuti fa · Non ancora salvato');
    expect(saved).not.toHaveTextContent('Non ancora salvato');
    await userEvent.click(screen.getByRole('button', { name: 'Apri Cornice fibbia' }));
    expect(toastError).toHaveBeenCalledWith(
      'Questo modello non è ancora salvato su Sinopia: aprilo sul computer dove l’hai creato.',
    );
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
  it('should sort by name through the selected menu and retain the choice in the URL', async () => {
    state.projects = [project('proj_spilla', 'Spilla', now), project('proj_anello', 'Anello', now - 60_000)];
    const view = renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Ordina i progetti' }));
    expect(screen.getByRole('menuitemradio', { name: 'Ultimi modificati' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Nome' }));
    expect(screen.getAllByRole('heading', { level: 3 }).map((item) => item.textContent)).toEqual(['Anello', 'Spilla']);
    expect(screen.getByRole('button', { name: 'Ordina i progetti' })).toHaveTextContent('Nome');
    view.unmount();
    renderSection(undefined, '/?sort=name');
    expect(screen.getAllByRole('heading', { level: 3 }).map((item) => item.textContent)).toEqual(['Anello', 'Spilla']);
  });

  it.each(['it', 'en'] as const)('should show only known piece counts in %s', (language) => {
    setLanguage(language);
    // Distinct activity times: equal ones left the card order to the millisecond the two projects were built in.
    state.projects = [
      project('proj_anello', 'Anello', Date.now()),
      project('proj_spilla', 'Spilla', Date.now() - 60_000),
    ];
    renderSection(new Map([['proj_anello', 9]]));
    const cards = screen.getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent(language === 'it' ? '· 9 pezzi' : '· 9 pieces');
    expect(cards[1]).not.toHaveTextContent(/pezzi|pieces/u);
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
