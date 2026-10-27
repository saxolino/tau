import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { RevisionCard } from '#hooks/use-revisions.js';
import type { VersionEvent } from '#routes/w.$workspace.$project/revision-history.js';
import { RevisionsPanelBody } from '#routes/w.$workspace.$project/chat-revisions.js';

const state = vi.hoisted(() => ({ revisions: [] as RevisionCard[], role: 'owner', dirty: false }));
const commands = vi.hoisted(() => ({ restore: vi.fn(), undo: vi.fn() }));
const client = vi.hoisted(() => ({ diff: vi.fn(async () => []), compare: vi.fn(), snapshot: vi.fn() }));
const deliveries = vi.hoisted(() => ({ events: [] as VersionEvent[], error: undefined as string | undefined }));
vi.mock('#hooks/use-sinopia-send-events.js', () => ({ useSinopiaSendEvents: () => deliveries }));
vi.mock('#hooks/use-sinopia-cad-conflicts.js', () => ({ SinopiaConflictVersions: () => null }));
vi.mock('#hooks/use-project.js', async () => {
  const { createActor, createMachine } = await import('xstate');
  // The versions name pieces from the open model; here there is none.
  const modelInteractionRef = createActor(
    createMachine({ context: { unitOrder: [] as string[], unitsById: {} as Record<string, never> } }),
  ).start();
  return { useProject: () => ({ projectId: 'p', modelInteractionRef }) };
});
vi.mock('#hooks/use-revisions.js', () => ({
  useRevisions: () => ({ revisions: state.revisions, headRevisionId: 'current', hasOlder: false, isLoading: false }),
  useWithRestoreTargets: (cards: readonly RevisionCard[]) => cards,
  useRevisionsOnLine: () => [],
}));
vi.mock('#hooks/use-revision-status.js', () => ({
  useRevisionClient: () => client,
  useProjectRole: () => state.role,
  useRevisionCommands: () => commands,
  useRevisionStatus: () => ({ dirty: state.dirty, restore: { asking: false, busy: false } }),
}));
vi.mock('#routes/w.$workspace.$project/revision-preview.js', () => ({
  RevisionPreview: ({ revision, onClose }: { readonly revision: RevisionCard; readonly onClose: () => void }) => (
    <section role='dialog' aria-label={`Viewing Rev ${revision.n}`}>
      <button type='button' onClick={onClose}>
        Back to latest
      </button>
    </section>
  ),
}));
const card = ({
  revisionId,
  n,
  summary,
  isAgent = false,
}: {
  readonly revisionId: string;
  readonly n: number;
  readonly summary: string;
  readonly isAgent?: boolean;
}): RevisionCard => ({
  revisionId,
  n,
  createdAt: new Date(2026, 9, 23, 14, n).getTime(),
  summary,
  trigger: isAgent ? 'turn' : 'save',
  actor: isAgent ? 'Agent' : 'You',
  source: isAgent ? 'agent' : 'user',
  turnId: isAgent ? 'turn' : undefined,
  conflicted: false,
});
const renderPanel = async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RevisionsPanelBody />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(queryClient.isFetching()).toBe(0);
  });
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.revisions = [
    card({ revisionId: 'current', n: 4, summary: 'Marquise adattata', isAgent: true }),
    card({ revisionId: 'older', n: 3, summary: 'Autosave' }),
  ];
  state.role = 'owner';
  state.dirty = false;
  deliveries.events = [];
  deliveries.error = undefined;
  setLanguage('it');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resetLanguageForTests();
});

describe('Sinopia versions', () => {
  it('should project a persisted delivery alongside actual revisions without giving it restore actions', async () => {
    deliveries.events = [{ kind: 'sent', id: 'delivery', createdAt: Date.now(), versionNumber: 7 }];
    await renderPanel();
    expect(screen.getByText('Inviata a Sinopia come versione 7')).toBeInTheDocument();
    const delivery = screen
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText('Inviata a Sinopia come versione 7') !== null);
    expect(delivery).toBeDefined();
    expect(within(delivery!).queryByRole('button')).not.toBeInTheDocument();
  });
  it.each(['it', 'en'] as const)(
    'should show the graph numbers and authors, and hide technical controls in %s',
    async (language) => {
      setLanguage(language);
      await renderPanel();
      expect(screen.getByText('Rev 4')).toBeInTheDocument();
      expect(screen.getByText(language === 'it' ? 'Agente' : 'Agent')).toBeInTheDocument();
      expect(screen.getByText(language === 'it' ? 'Tu' : 'You')).toBeInTheDocument();
      expect(screen.getByText(language === 'it' ? 'Modifiche al modello' : 'Model changes')).toBeInTheDocument();
      expect(screen.getByLabelText(language === 'it' ? 'Versione attuale' : 'Current version')).toBeInTheDocument();
      expect(screen.getByTestId('versions-list')).not.toHaveTextContent(
        /main|branch|backup|github|save revision|autosave|history|where you are/iu,
      );
      expect(screen.getAllByRole('button', { name: language === 'it' ? 'Guarda' : 'View' })).toHaveLength(2);
    },
  );

  it('should attribute a pre-turn user save to the user even when it carries the agent turn id', async () => {
    const base = state.revisions[1]!;
    state.revisions = [{ ...base, source: 'user', trigger: 'turn', turnId: 'shared-turn' }];
    await renderPanel();
    expect(screen.getByText('Tu')).toBeInTheDocument();
    expect(screen.queryByText('Agente')).not.toBeInTheDocument();
  });

  it('should ask before restoring and send only the existing non-destructive restore verb', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getAllByRole('button', { name: 'Torna a questa versione' })[0]!);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Tornare alla Rev 3?');
    expect(dialog).toHaveTextContent('restano nelle Versioni');
    expect(commands.restore).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Torna alla Rev 3' }));
    expect(commands.restore).toHaveBeenCalledExactlyOnceWith('older');
  });

  it('should keep a preview separate from restore and close it without any revision command', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getAllByRole('button', { name: 'Guarda' })[1]!);
    expect(await screen.findByRole('dialog', { name: 'Viewing Rev 3' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to latest' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(commands.restore).not.toHaveBeenCalled();
    expect(commands.undo).not.toHaveBeenCalled();
  });

  it('should omit restoring for readers and keep the empty state bilingual', async () => {
    state.role = 'read';
    await renderPanel();
    expect(screen.queryByRole('button', { name: 'Torna a questa versione' })).not.toBeInTheDocument();
  });

  it.each(['it', 'en'] as const)(
    'should show the empty state in %s without inventing delivery events',
    async (language) => {
      state.revisions = [];
      setLanguage(language);
      await renderPanel();
      expect(
        screen.getByText(
          language === 'it'
            ? 'Nessuna versione ancora: appena cambi qualcosa compare qui.'
            : 'No versions yet: as soon as something changes it shows up here.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Inviata|Sent to Sinopia/u)).not.toBeInTheDocument();
    },
  );
});
