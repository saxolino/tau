// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProjection } from '#hooks/use-agent-projections.js';
import type { ProjectTask, ProjectTaskMessage } from '@taucad/agent-host/wire';
import type * as AgentProjectionsModule from '#hooks/use-agent-projections.js';
import { useAgentProjections } from '#hooks/use-agent-projections.js';
import { AgentList, AgentsPanelBody } from '#routes/w.$workspace.$project/chat-agents.js';

vi.mock('#hooks/use-project-availability.js', () => ({ useProjectAvailability: () => 'ready' }));

vi.mock('#components/icons/svg-icon.js', () => ({
  SvgIcon: ({ id }: { readonly id: string }) => <span data-testid={`model-icon-${id}`} />,
}));
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'project-1' }) }));
vi.mock('#hooks/use-project-slug-route.js', () => ({
  useProjectSlugs: () => ({ status: 'resolved', value: { workspaceSlug: 'tau', projectSlug: 'engine' } }),
}));
const taskView = vi.hoisted(() => {
  const current: {
    isLoading: boolean;
    unavailable?: string;
    error?: string;
    snapshot?: {
      tasks: ProjectTask[];
      messages: ProjectTaskMessage[];
      cursor: number;
      nextCursor: number;
      hasMore: boolean;
    };
    retry: ReturnType<typeof vi.fn>;
    actions: { send: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
  } = {
    isLoading: false,
    unavailable: 'Child tasks require the desktop project host.',
    retry: vi.fn(),
    actions: { send: vi.fn(), cancel: vi.fn(), resume: vi.fn() },
  };
  return { current };
});
vi.mock('#hooks/use-project-tasks.js', () => ({
  useProjectTasks: () => taskView.current,
}));
vi.mock('#hooks/use-agent-projections.js', async (importOriginal) => {
  const original = await importOriginal<typeof AgentProjectionsModule>();
  return { ...original, useAgentProjections: vi.fn() };
});

const projection = (over: Partial<AgentProjection> = {}): AgentProjection => ({
  chatId: 'chat-1',
  name: 'Bracket exploration',
  state: 'running',
  focused: true,
  lastActivityAt: 1000,
  model: {
    id: 'anthropic/claude-sonnet',
    name: 'Claude Sonnet',
    family: 'claude',
    provider: 'Anthropic',
  },
  workspace: 'tau',
  branch: 'fea/bracket-v2',
  pendingApprovalCount: 0,
  operationIds: [],
  unread: false,
  detail: 'Streaming response',
  ...over,
});

beforeEach(() => {
  taskView.current.isLoading = false;
  taskView.current.unavailable = 'Child tasks require the desktop project host.';
  taskView.current.snapshot = undefined;
  taskView.current.error = undefined;
  vi.mocked(useAgentProjections).mockReturnValue({
    agents: [],
    isLoading: false,
    error: undefined,
    retry: vi.fn(),
  });
});

describe('AgentList', () => {
  it('renders state, focus, activity, model/provider, workspace, branch, approval, unread, and navigation', () => {
    render(
      <MemoryRouter>
        <AgentList
          agents={[
            projection({
              state: 'waiting',
              focused: false,
              unread: true,
              pendingApprovalCount: 2,
              detail: '2 approvals required',
            }),
          ]}
          projectSlugs={{ workspaceSlug: 'tau', projectSlug: 'engine' }}
        />
      </MemoryRouter>,
    );

    const row = screen.getByRole('link', { name: 'Bracket exploration, waiting' });
    expect(row.getAttribute('href')).toBe('/w/tau/engine?chat=chat-1');
    expect(screen.getByText('Waiting')).not.toBeNull();
    expect(screen.getByLabelText('Unread activity')).not.toBeNull();
    expect(screen.getByText('2 approvals required')).not.toBeNull();
    expect(screen.getByText('Approval · 2')).not.toBeNull();
    expect(screen.getByText('Claude Sonnet')).not.toBeNull();
    expect(screen.getByText('Anthropic')).not.toBeNull();
    expect(screen.getByText('tau')).not.toBeNull();
    expect(screen.getByText('fea/bracket-v2')).not.toBeNull();
    expect(row.querySelector('time')?.getAttribute('dateTime')).toBe(new Date(1000).toISOString());
  });

  /* I6: a chat no turn has placed names no line, never a guessed `main` or the word "undefined". */
  it('renders no branch for a chat no turn has placed on a line', () => {
    render(
      <MemoryRouter>
        <AgentList
          agents={[projection({ branch: undefined })]}
          projectSlugs={{ workspaceSlug: 'tau', projectSlug: 'engine' }}
        />
      </MemoryRouter>,
    );

    const row = screen.getByRole('link', { name: 'Bracket exploration, running' });
    expect(row.querySelector('[title^="Branch:"]')).toBeNull();
    expect(row.textContent).not.toMatch(/undefined|\bmain\b/u);
  });

  it('exposes focused, running, waiting, error, and idle without collapsing them into one status', () => {
    render(
      <MemoryRouter>
        <AgentList
          agents={[
            projection({ chatId: 'focused', name: 'Focused agent', state: 'idle', focused: true }),
            projection({ chatId: 'running', name: 'Running agent', state: 'running', focused: false }),
            projection({ chatId: 'waiting', name: 'Waiting agent', state: 'waiting', focused: false }),
            projection({ chatId: 'error', name: 'Errored agent', state: 'error', focused: false }),
            projection({ chatId: 'idle', name: 'Idle agent', state: 'idle', focused: false }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Current chat')).not.toBeNull();
    expect(screen.getAllByText('Running')).toHaveLength(1);
    expect(screen.getAllByText('Waiting')).toHaveLength(1);
    expect(screen.getAllByText('Error')).toHaveLength(1);
    expect(screen.getAllByText('Idle')).toHaveLength(2);
  });
});

describe('AgentsPanelBody', () => {
  it('should keep one durable row through loading without flashing a standalone chat', () => {
    vi.mocked(useAgentProjections).mockReturnValue({
      agents: [projection({ unread: true })],
      isLoading: false,
      error: undefined,
      retry: vi.fn(),
    });
    taskView.current.isLoading = true;
    taskView.current.unavailable = undefined;
    const pane = render(
      <MemoryRouter>
        <AgentsPanelBody />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'Bracket exploration, running' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading project tasks' })).toBeDefined();
    taskView.current.isLoading = false;
    taskView.current.snapshot = {
      tasks: [
        {
          id: 'task-1',
          projectId: 'project-1',
          chatId: 'chat-1',
          depth: 0,
          title: 'Explore a long bracket prompt',
          prompt: 'Explore a long bracket prompt',
          provider: { id: 'codex' },
          createdAt: 1,
          closed: false,
          attempts: [
            {
              id: 'attempt-1',
              number: 1,
              status: 'running',
              source: { revisionId: 'base', checkoutId: 'checkout' },
              toolGrant: { toolChoice: 'none', allowedTools: [] },
              createdAt: 1,
            },
          ],
        },
      ],
      messages: [],
      cursor: 1,
      nextCursor: 1,
      hasMore: false,
    };
    pane.rerender(
      <MemoryRouter>
        <AgentsPanelBody />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('button', { name: 'Task details for Explore a long bracket prompt' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Bracket exploration, running' })).toBeNull();
    expect(screen.getByLabelText('Agent overview').textContent).toContain('1task');
    expect(screen.getByLabelText('Agent overview').textContent).toContain('1need attention');
    taskView.current.isLoading = true;
    pane.rerender(
      <MemoryRouter>
        <AgentsPanelBody />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('button', { name: 'Task details for Explore a long bracket prompt' })).toHaveLength(1);
    expect(screen.getByLabelText('Agent overview')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Agent overview').textContent).not.toContain('active');
    taskView.current.isLoading = false;
    taskView.current.error = 'Task host disconnected';
    pane.rerender(
      <MemoryRouter>
        <AgentsPanelBody />
      </MemoryRouter>,
    );
    expect(screen.getByText('Last known tasks. Reconnect to act.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Task details for Explore a long bracket prompt' }));
    expect(screen.getByRole('textbox', { name: 'Message Explore a long bracket prompt' })).toBeDisabled();
  });
  it('delays the full transcript query for a hidden Agents panel', () => {
    render(
      <MemoryRouter>
        <AgentsPanelBody enableHistory={false} />
      </MemoryRouter>,
    );
    expect(useAgentProjections).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('summarises concurrent and attention-needing agents from the projection hook', () => {
    taskView.current.unavailable = undefined;
    taskView.current.snapshot = { tasks: [], messages: [], cursor: 0, nextCursor: 0, hasMore: false };
    vi.mocked(useAgentProjections).mockReturnValue({
      agents: [
        projection(),
        projection({ chatId: 'waiting', name: 'Waiting agent', state: 'waiting', focused: false }),
        projection({ chatId: 'idle', name: 'Idle agent', state: 'idle', focused: false, unread: true }),
      ],
      isLoading: false,
      error: undefined,
      retry: vi.fn(),
    });

    render(
      <MemoryRouter>
        <AgentsPanelBody />
      </MemoryRouter>,
    );

    const overview = screen.getByLabelText('Agent overview');
    expect(overview.textContent).toContain('3chats');
    expect(overview.textContent).toContain('2 active');
    expect(overview.textContent).toContain('2need attention');
  });

  it('offers recovery when the durable projection query fails', () => {
    const retry = vi.fn();
    vi.mocked(useAgentProjections).mockReturnValue({
      agents: [],
      isLoading: false,
      error: 'Could not read project chats',
      retry,
    });

    render(
      <MemoryRouter>
        <AgentsPanelBody />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert', { name: 'Agents unavailable' })).toHaveTextContent(
      'Agents unavailableCould not read project chatsRetry',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
