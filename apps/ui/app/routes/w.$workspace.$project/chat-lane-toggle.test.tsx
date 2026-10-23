import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type * as SidebarStatus from '#hooks/use-sidebar-status.js';
import type { ChatSidebarStatus } from '#hooks/use-sidebar-status.js';
import type * as ProjectWorkspaceContext from '#routes/w.$workspace.$project/project-workspace-context.js';
import { WorkspaceLanesContext } from '#routes/w.$workspace.$project/project-workspace-context.js';

const state = vi.hoisted(() => ({
  status: undefined as ChatSidebarStatus | undefined,
}));
const setChatOpen = vi.hoisted(() => vi.fn());

vi.mock('@xstate/react', () => ({
  useSelector: (actor: { getSnapshot: () => unknown }, selector: (snapshot: unknown) => unknown) =>
    selector(actor.getSnapshot()),
}));
vi.mock('#hooks/use-project.js', () => ({
  useProject: () => ({
    projectId: 'proj_one',
    editorRef: { getSnapshot: () => ({ context: { focusedChatId: 'chat_active' } }) },
  }),
}));
vi.mock('#hooks/use-sidebar-status.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SidebarStatus>()),
  useChatSidebarStatus: () => state.status,
}));
vi.mock('#routes/w.$workspace.$project/project-workspace-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectWorkspaceContext>()),
  useProjectWorkspace: () => ({ setChatOpen }),
}));

const { ChatLaneToggle } = await import('#routes/w.$workspace.$project/chat-lane-toggle.js');

const approval: ChatSidebarStatus = {
  state: 'approval',
  unread: false,
  toolName: undefined,
  pendingApprovalCount: 2,
  failureReason: undefined,
  branch: undefined,
  dirty: false,
};

const chatOpen = { chat: true, workbench: true };
const chatHidden = { chat: false, workbench: true };

// StrictMode, as the dev server runs it: its double effect once spent the focus claim early.
const withLanes = (ui: React.ReactElement, chat: boolean): React.JSX.Element => (
  <StrictMode>
    <TooltipProvider>
      <WorkspaceLanesContext.Provider value={chat ? chatOpen : chatHidden}>{ui}</WorkspaceLanesContext.Provider>
    </TooltipProvider>
  </StrictMode>
);
const renderWithLanes = (ui: React.ReactElement, chat: boolean) => render(withLanes(ui, chat));

describe('ChatLaneToggle', () => {
  beforeEach(() => {
    state.status = undefined;
    vi.clearAllMocks();
  });

  it('is pressed in the agent pane header, advertises ⌃C, and closes the lane', async () => {
    const user = userEvent.setup();
    renderWithLanes(<ChatLaneToggle place='lane' />, true);

    const toggle = screen.getByRole('button', { name: 'Agente' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Control+C');
    // The open pane names itself: the header carries the icon alone, a 28 px pane button.
    expect(toggle).toHaveClass('size-7');
    expect(toggle).not.toHaveTextContent('Agente');
    await user.click(toggle);

    expect(setChatOpen).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('names the hidden agent in the viewer’s cluster, folding to its glyph with Share and Export', async () => {
    const user = userEvent.setup();
    renderWithLanes(<ChatLaneToggle place='viewer' />, false);

    const toggle = screen.getByRole('button', { name: 'Agente' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveTextContent('Agente');
    expect(toggle).toHaveClass('@max-xl/viewer:w-7');
    await user.click(toggle);

    expect(setChatOpen).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('never marks the open lane: the lane owns its own state (R3)', () => {
    state.status = approval;
    const { container } = renderWithLanes(<ChatLaneToggle place='lane' />, true);

    expect(container.querySelector('[data-slot="chat-toggle-mark"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Agente' })).not.toHaveAccessibleDescription();
  });

  it('carries the sidebar mark and its sentence while the lane is hidden, without the count', () => {
    state.status = approval;
    const { container } = renderWithLanes(<ChatLaneToggle place='viewer' />, false);

    const toggle = screen.getByRole('button', { name: 'Agente' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleDescription('Needs your approval · 2');
    const mark = container.querySelector('[data-slot="chat-toggle-mark"]');
    expect(mark).toHaveAttribute('data-mark', 'attention');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    // D16's numeral would hang into the tab; the description carries the count.
    expect(mark).not.toHaveTextContent('2');
  });

  it('shows no mark for a quiet chat', () => {
    const { container } = renderWithLanes(<ChatLaneToggle place='viewer' />, false);

    expect(container.querySelector('[data-slot="chat-toggle-mark"]')).toBeNull();
  });

  it('hands keyboard focus to the other mount (B-2)', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithLanes(<ChatLaneToggle place='viewer' />, false);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(setChatOpen).toHaveBeenCalledExactlyOnceWith(true);

    rerender(withLanes(<ChatLaneToggle place='lane' />, true));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Agente' })).toHaveFocus();
    });
  });
});
