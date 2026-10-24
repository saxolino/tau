import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IDockviewHeaderActionsProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type * as ProjectWorkspaceContext from '#routes/w.$workspace.$project/project-workspace-context.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

const state = vi.hoisted(() => ({
  isMobile: false,
  isTopRight: true,
  openMobile: false,
  lanes: { chat: true, workbench: true },
}));

const openPanel = vi.hoisted(() => vi.fn());

vi.mock('@xstate/react', () => ({
  useSelector: (actor: { getSnapshot: () => unknown }, selector: (snapshot: unknown) => unknown) =>
    selector(actor.getSnapshot()),
}));
vi.mock('#hooks/use-project.js', () => ({
  useProject: () => ({
    projectRef: { getSnapshot: () => ({ context: { project: { name: 'Rotor housing' } } }) },
  }),
}));
/* SinopiaCAD: no branch chip and no agent toggle here; a stand-in proves neither is drawn. */
vi.mock('#routes/w.$workspace.$project/record-issues-action.js', () => ({
  RecordIssuesAction: () => <span data-testid='record-issues' />,
}));
vi.mock('#components/panes/use-is-top-right-group.js', () => ({
  useIsTopRightGroup: () => state.isTopRight,
}));
vi.mock('#components/ui/sidebar.js', () => ({
  SidebarTrigger: ({ children, ...properties }: React.ComponentProps<'button'>) => (
    <button type='button' {...properties}>
      {children}
    </button>
  ),
  useSidebar: () => ({ isMobile: state.isMobile, openMobile: state.openMobile }),
}));
vi.mock('#routes/w.$workspace.$project/project-workspace-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectWorkspaceContext>()),
  useProjectWorkspace: () => ({
    openPanel,
    registerRecordRecoveryFocus: () => undefined,
    restoreRecordRecoveryFocus: () => undefined,
  }),
  useWorkspaceLanes: () => state.lanes,
}));

const { ProjectWorkspaceActions } = await import('./project-workspace-actions.js');

const properties = (): IDockviewHeaderActionsProps =>
  ({ group: {}, containerApi: {} }) as unknown as IDockviewHeaderActionsProps;

const renderActions = () =>
  render(
    <TooltipProvider>
      <ProjectWorkspaceActions {...properties()} />
    </TooltipProvider>,
  );

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('ProjectWorkspaceActions', () => {
  beforeEach(() => {
    state.isMobile = true;
    state.isTopRight = true;
    state.openMobile = false;
    state.lanes = { chat: true, workbench: true };
    vi.clearAllMocks();
  });

  // SinopiaCAD: the desktop's tab bar over the model is hidden; the project's top bar holds these actions.
  it('draws nothing on the desktop, where the top bar holds the actions', () => {
    state.isMobile = false;
    const { container } = renderActions();
    expect(container).toBeEmptyDOMElement();
  });

  it('draws only in the top-right viewer group', () => {
    state.isTopRight = false;
    const { container } = renderActions();
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['it', 'Esporta'],
    ['en', 'Export'],
  ] as const)(
    'keeps the sidebar, the record issues and %s, without Share, the branch or the agent',
    async (language, exportName) => {
      setLanguage(language);
      const user = userEvent.setup();
      renderActions();

      expect(screen.getByRole('button', { name: /Rotor housing/ })).toBeInTheDocument();
      expect(screen.getByTestId('record-issues')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /share|condividi/iu })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /agente|agent/iu })).not.toBeInTheDocument();
      expect(screen.queryByText('main')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: exportName }));
      expect(openPanel).toHaveBeenCalledExactlyOnceWith('export');
    },
  );
});
