import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type * as ProjectWorkspaceContext from '#routes/w.$workspace.$project/project-workspace-context.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { formatTime, useTranslation } from '#i18n/translate.js';

const openPanel = vi.hoisted(() => vi.fn());
const updateName = vi.hoisted(() => vi.fn(async () => undefined));
const savedAt = new Date(2026, 9, 23, 14, 2).getTime();
const linkedModel = vi.hoisted(() => ({
  modelId: 'model',
  projectId: 'project',
  userId: 'owner',
  baseRevisionId: null,
}));

vi.mock('#hooks/use-sinopia-cad-sync.js', () => ({
  useSinopiaCadLink: () => linkedModel,
  useSinopiaCadLinking: () => ({ name: 'Ring', state: undefined, isUnlinked: false, start: () => undefined }),
}));
vi.mock('#routes/w.$workspace.$project/project-save-status.js', () => ({
  ProjectSaveStatus: () => {
    const { language } = useTranslation();
    return (
      <span role='status'>{`${language === 'it' ? 'Salvato su Sinopia' : 'Saved on Sinopia'} · ${formatTime(savedAt, language)}`}</span>
    );
  },
}));
vi.mock('#routes/w.$workspace.$project/send-to-sinopia-dialog.js', () => ({
  SendToSinopiaDialog: ({ link }: { readonly link: typeof linkedModel }) => {
    const { t } = useTranslation();
    return (
      <div role='dialog' aria-label={t('project.topBar.sendToSinopia')}>
        {link.projectId}
      </div>
    );
  },
}));

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
vi.mock('#routes/w.$workspace.$project/inspector-lane.js', () => ({
  InspectorLaneToggle: ({ place }: { readonly place: string }) => (
    <button type='button' data-testid='inspector-toggle' data-place={place} />
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
    status: 'Salvato su Sinopia · 14:02',
    versions: 'Versioni',
    export: 'Esporta',
    send: 'Invia a Sinopia',
  },
  en: {
    bar: 'Project',
    projects: 'Projects',
    status: 'Saved on Sinopia · 2:02 PM',
    versions: 'Versions',
    export: 'Export',
    send: 'Send to Sinopia',
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
    expect(screen.getByRole('button', { name: text.send })).toBeEnabled();
    // Misure at the start, the inspector at the end: the lanes' toggles frame the bar.
    expect(bar.firstElementChild).toBe(screen.getByTestId('measures-toggle'));
    expect(screen.getByTestId('inspector-toggle')).toHaveAttribute('data-place', 'viewer');
  });

  it('has one work mode and one filled action: no Assistente/Modifica switch, only «Invia a Sinopia» is primary', () => {
    setLanguage('it');
    renderBar();
    expect(screen.getByRole('link', { name: 'Progetti' })).toHaveTextContent('SinopiaCAD');
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assistente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Strumenti di progettazione' })).not.toBeInTheDocument();
    const filled = screen
      .getAllByRole('button')
      .filter((button) => button.className.split(/\s+/u).includes('primary-action'));
    expect(filled).toEqual([screen.getByRole('button', { name: 'Invia a Sinopia' })]);
    // Versions and Export are glyphs; their names are their labels and tooltips, not text in the bar.
    expect(screen.getByRole('button', { name: 'Versioni' })).not.toHaveTextContent('Versioni');
    expect(screen.getByRole('button', { name: 'Esporta' })).not.toHaveTextContent('Esporta');
  });

  it('reads the project’s name and where it is saved side by side', () => {
    setLanguage('it');
    renderBar();
    const name = screen.getByRole('button', { name: 'Collana con marquise' });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Salvato su Sinopia · 14:02');
    // The status follows the path, before the actions.
    const order = [...screen.getByRole('region', { name: 'Progetto' }).querySelectorAll('*')];
    const actions = screen.getByRole('group', { name: 'Azioni del progetto' });
    expect(order.indexOf(name)).toBeLessThan(order.indexOf(status));
    expect(order.indexOf(status)).toBeLessThan(order.indexOf(actions));
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

  it.each(['it', 'en'] as const)('opens the linked Sinopia handoff in %s only on request', async (language) => {
    setLanguage(language);
    const user = userEvent.setup();
    renderBar();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: words[language].send }));
    expect(screen.getByRole('dialog', { name: words[language].send })).toHaveTextContent(linkedModel.projectId);
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
