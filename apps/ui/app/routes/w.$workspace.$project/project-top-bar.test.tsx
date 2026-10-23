import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type * as ProjectWorkspaceContext from '#routes/w.$workspace.$project/project-workspace-context.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

const openPanel = vi.hoisted(() => vi.fn());
const updateName = vi.hoisted(() => vi.fn(async () => undefined));
const savedAt = new Date(2026, 9, 23, 14, 2).getTime();

vi.mock('@xstate/react', () => ({
  useSelector: (actor: { getSnapshot: () => unknown }, selector: (snapshot: unknown) => unknown) =>
    selector(actor.getSnapshot()),
}));
vi.mock('#hooks/use-project.js', () => ({
  useProject: () => ({
    projectId: 'proj_marquise',
    projectRef: { getSnapshot: () => ({ context: { project: { name: 'Collana con marquise' } } }) },
  }),
}));
vi.mock('#hooks/use-projects.js', () => ({ useProjects: () => ({ updateName }) }));
vi.mock('#routes/w.$workspace.$project/revision-vocabulary.js', () => ({
  useRevisionFacts: () => ({
    where: { branch: 'main', head: 3, isDirty: false, isLoading: false, role: 'owner', isSignedOut: true },
    head: { createdAt: savedAt },
    status: {
      attention: 0,
      conflicts: [],
      minting: false,
      restore: { busy: false },
      sync: { state: 'idle' },
    },
  }),
}));
vi.mock('#routes/w.$workspace.$project/project-workspace-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectWorkspaceContext>()),
  useProjectWorkspace: () => ({
    openPanel,
    registerRecordRecoveryFocus: () => undefined,
    restoreRecordRecoveryFocus: () => undefined,
  }),
}));
/* The two lane toggles have their own suites; here they only have to stand at the bar's two ends. */
vi.mock('#routes/w.$workspace.$project/chat-lane-toggle.js', () => ({
  ChatLaneToggle: ({ place }: { readonly place: string }) => (
    <button type='button' data-testid='agent-toggle' data-place={place} />
  ),
}));
vi.mock('#routes/w.$workspace.$project/workbench-toggle.js', () => ({
  WorkbenchLaneToggle: ({ place }: { readonly place: string }) => (
    <button type='button' data-testid='measures-toggle' data-place={place} />
  ),
}));
vi.mock('#routes/w.$workspace.$project/record-issues-action.js', () => ({ RecordIssuesAction: () => null }));

const { ProjectTopBar } = await import('#routes/w.$workspace.$project/project-top-bar.js');

const renderBar = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ProjectTopBar />
      </TooltipProvider>
    </MemoryRouter>,
  );

const words = {
  it: {
    bar: 'Progetto',
    projects: 'Progetti',
    status: 'Salvato su questo computer · 14:02',
    versions: 'Versioni',
    export: 'Esporta',
    send: 'Invia a Sinopia',
    why: 'Presto: invierà il modello',
  },
  en: {
    bar: 'Project',
    projects: 'Projects',
    status: 'Saved on this computer · 2:02 PM',
    versions: 'Versions',
    export: 'Export',
    send: 'Send to Sinopia',
    why: 'Coming soon: it will send the model',
  },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('ProjectTopBar', () => {
  it.each(['it', 'en'] as const)('lays out the design’s bar in %s', (language) => {
    setLanguage(language);
    const text = words[language];
    renderBar();

    const bar = screen.getByRole('region', { name: text.bar });
    expect(screen.getByRole('link', { name: text.projects })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('button', { name: 'Collana con marquise' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(text.status);
    expect(screen.getByRole('button', { name: text.versions })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.export })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.send })).toHaveAttribute('aria-disabled', 'true');
    // Misure at the start, the agent at the end: the lanes' toggles frame the bar.
    expect(bar.firstElementChild).toBe(screen.getByTestId('measures-toggle'));
    expect(screen.getByTestId('agent-toggle')).toHaveAttribute('data-place', 'viewer');
  });

  it('keeps Tau’s branch, Share and file names out of the bar', () => {
    setLanguage('it');
    renderBar();

    const bar = screen.getByRole('region', { name: 'Progetto' });
    expect(bar).not.toHaveTextContent(/\bmain\b/u);
    expect(bar).not.toHaveTextContent(/share|condividi|main\.ts|save revision|github|backup/iu);
  });

  it.each(['it', 'en'] as const)('opens Versions and Export in the Misure lane in %s', async (language) => {
    setLanguage(language);
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: words[language].versions }));
    await user.click(screen.getByRole('button', { name: words[language].export }));

    expect(openPanel.mock.calls).toEqual([['revisions'], ['export']]);
  });

  it.each(['it', 'en'] as const)('says in %s why «Invia a Sinopia» waits, and does nothing yet', async (language) => {
    setLanguage(language);
    const user = userEvent.setup();
    renderBar();

    const send = screen.getByRole('button', { name: words[language].send });
    await user.hover(send);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(words[language].why);
    await user.click(send);
    expect(openPanel).not.toHaveBeenCalled();
  });

  it('renames the project in place', async () => {
    setLanguage('it');
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: 'Collana con marquise' }));
    const field = screen.getByRole('textbox', { name: 'Nome del progetto' });
    await user.clear(field);
    await user.type(field, 'Collana primavera{Enter}');

    expect(updateName).toHaveBeenCalledExactlyOnceWith('proj_marquise', 'Collana primavera');
  });
});
