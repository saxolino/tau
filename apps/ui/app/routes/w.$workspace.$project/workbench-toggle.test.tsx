import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IDockviewHeaderActionsProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type * as ProjectWorkspaceContext from '#routes/w.$workspace.$project/project-workspace-context.js';
import { WorkspaceLanesContext } from '#routes/w.$workspace.$project/project-workspace-context.js';

const state = vi.hoisted(() => ({ isMobile: false, isTopLeft: true }));
const setWorkbenchOpen = vi.hoisted(() => vi.fn());

vi.mock('#components/panes/use-is-top-right-group.js', () => ({
  useIsTopLeftGroup: () => state.isTopLeft,
}));
vi.mock('#components/ui/sidebar.js', () => ({ useSidebar: () => ({ isMobile: state.isMobile }) }));
vi.mock('#routes/w.$workspace.$project/project-workspace-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectWorkspaceContext>()),
  useProjectWorkspace: () => ({ setWorkbenchOpen }),
}));

const { WorkbenchLaneHead, WorkbenchLaneToggle, toggleWorkbenchKeyCombination } =
  await import('#routes/w.$workspace.$project/workbench-toggle.js');

const misureOpen = { chat: true, workbench: true };
const misureHidden = { chat: true, workbench: false };

// StrictMode, as the dev server runs it: its double effect once spent the focus claim early.
const withLanes = (ui: React.ReactElement, isMisureVisible: boolean): React.JSX.Element => (
  <StrictMode>
    <TooltipProvider>
      <WorkspaceLanesContext.Provider value={isMisureVisible ? misureOpen : misureHidden}>
        {ui}
      </WorkspaceLanesContext.Provider>
    </TooltipProvider>
  </StrictMode>
);
const renderWithLanes = (ui: React.ReactElement, isMisureVisible: boolean) => render(withLanes(ui, isMisureVisible));

const headerProperties = {} as unknown as IDockviewHeaderActionsProps;

// The Italian names; the English ones are checked at the end.
beforeEach(() => {
  setLanguage('it');
});

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('WorkbenchLaneToggle', () => {
  beforeEach(() => {
    state.isMobile = false;
    state.isTopLeft = true;
    vi.clearAllMocks();
  });

  it.each([
    ['it', 'Misure'],
    ['en', 'Measures'],
  ] as const)('names the lane in %s', (language, name) => {
    setLanguage(language);
    renderWithLanes(<WorkbenchLaneToggle place='viewer' />, false);

    expect(screen.getByRole('button', { name })).toHaveTextContent(name);
  });

  it('folds to its glyph by the container the host names', () => {
    renderWithLanes(
      <WorkbenchLaneToggle place='viewer' fold={{ className: 'fold-button', labelClassName: 'fold-label' }} />,
      false,
    );

    const toggle = screen.getByRole('button', { name: 'Misure' });
    expect(toggle).toHaveClass('fold-button');
    expect(screen.getByText('Misure')).toHaveClass('fold-label');
  });

  it('is pressed at the head of the Misure lane, advertises ⌃W, and hides the lane', async () => {
    const user = userEvent.setup();
    renderWithLanes(<WorkbenchLaneToggle place='lane' />, true);

    // The lane's own button only hides it: named for that, no pressed state (the top bar's toggle carries it).
    const toggle = screen.getByRole('button', { name: 'Nascondi le misure' });
    expect(toggle).not.toHaveAttribute('aria-pressed');
    expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Control+W');
    expect(toggleWorkbenchKeyCombination).toEqual({ key: 'w', ctrlKey: true });
    // The lane's own header already names it: the icon alone, a 28 px pane button.
    expect(toggle).toHaveClass('size-7');
    expect(toggle).not.toHaveTextContent('Misure');
    await user.click(toggle);

    expect(setWorkbenchOpen).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('names the hidden lane where the lane is not, folding to its glyph by default with the viewer', async () => {
    const user = userEvent.setup();
    renderWithLanes(<WorkbenchLaneToggle place='viewer' />, false);

    const toggle = screen.getByRole('button', { name: 'Misure' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveTextContent('Misure');
    expect(toggle).toHaveClass('@max-xl/viewer:w-7');
    await user.click(toggle);

    expect(setWorkbenchOpen).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('hands keyboard focus to the other mount (B-2)', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithLanes(<WorkbenchLaneToggle place='viewer' />, false);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(setWorkbenchOpen).toHaveBeenCalledExactlyOnceWith(true);

    rerender(withLanes(<WorkbenchLaneToggle place='lane' />, true));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Nascondi le misure' })).toHaveFocus();
    });
  });
});

describe('WorkbenchLaneHead', () => {
  beforeEach(() => {
    state.isMobile = false;
    state.isTopLeft = true;
  });

  it('heads the Misure lane’s top-left group only while the lane shows', () => {
    const { container } = renderWithLanes(<WorkbenchLaneHead {...headerProperties} />, true);
    const toggle = screen.getByRole('button', { name: 'Nascondi le misure' });
    expect(toggle.parentElement).toHaveClass('pl-1');
    container.remove();

    expect(renderWithLanes(<WorkbenchLaneHead {...headerProperties} />, false).container).toBeEmptyDOMElement();
  });

  it('stays out of split groups and off mobile', () => {
    state.isTopLeft = false;
    expect(renderWithLanes(<WorkbenchLaneHead {...headerProperties} />, true).container).toBeEmptyDOMElement();

    state.isTopLeft = true;
    state.isMobile = true;
    expect(renderWithLanes(<WorkbenchLaneHead {...headerProperties} />, true).container).toBeEmptyDOMElement();
  });

  it('stays out of pages without desktop lanes, such as a shared project', () => {
    render(
      <TooltipProvider>
        <WorkbenchLaneHead {...headerProperties} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Misure' })).not.toBeInTheDocument();
  });
});
