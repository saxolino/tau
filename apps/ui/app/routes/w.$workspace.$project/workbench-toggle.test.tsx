import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IDockviewHeaderActionsProps } from 'dockview-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const { ViewerWorkbenchLaneToggle, WorkbenchLaneHead, WorkbenchLaneToggle, toggleWorkbenchKeyCombination } =
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

describe('WorkbenchLaneToggle', () => {
  beforeEach(() => {
    state.isMobile = false;
    state.isTopLeft = true;
    vi.clearAllMocks();
  });

  it('is pressed at the head of the Misure lane, advertises ⌃W, and hides the lane', async () => {
    const user = userEvent.setup();
    renderWithLanes(<WorkbenchLaneToggle place='lane' />, true);

    const toggle = screen.getByRole('button', { name: 'Misure' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Control+W');
    expect(toggleWorkbenchKeyCombination).toEqual({ key: 'w', ctrlKey: true });
    // The lane's own header already names it: the icon alone, a 28 px pane button.
    expect(toggle).toHaveClass('size-7');
    expect(toggle).not.toHaveTextContent('Misure');
    await user.click(toggle);

    expect(setWorkbenchOpen).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('names the hidden lane in the viewer, folding to its glyph with Share and Export', async () => {
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
      expect(screen.getByRole('button', { name: 'Misure' })).toHaveFocus();
    });
  });
});

describe('ViewerWorkbenchLaneToggle', () => {
  beforeEach(() => {
    state.isMobile = false;
    state.isTopLeft = true;
  });

  it('heads the viewer’s top-left group only while the Misure lane is hidden', () => {
    const { container } = renderWithLanes(<ViewerWorkbenchLaneToggle {...headerProperties} />, false);
    const prefix = screen.getByRole('button', { name: 'Misure' }).parentElement;
    expect(prefix).toHaveClass('pl-1');
    // The same hairline the top-right cluster sets between the tabs and its own groups.
    expect(prefix?.lastElementChild).toHaveAttribute('data-orientation', 'vertical');
    container.remove();

    const visible = renderWithLanes(<ViewerWorkbenchLaneToggle {...headerProperties} />, true);
    expect(visible.container).toBeEmptyDOMElement();
  });

  it('stays out of every other group and off mobile', () => {
    state.isTopLeft = false;
    expect(renderWithLanes(<ViewerWorkbenchLaneToggle {...headerProperties} />, false).container).toBeEmptyDOMElement();

    state.isTopLeft = true;
    state.isMobile = true;
    expect(renderWithLanes(<ViewerWorkbenchLaneToggle {...headerProperties} />, false).container).toBeEmptyDOMElement();
  });
});

describe('WorkbenchLaneHead', () => {
  beforeEach(() => {
    state.isMobile = false;
    state.isTopLeft = true;
  });

  it('heads the Misure lane’s top-left group only while the lane shows', () => {
    const { container } = renderWithLanes(<WorkbenchLaneHead {...headerProperties} />, true);
    const toggle = screen.getByRole('button', { name: 'Misure' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
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
