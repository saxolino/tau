// @vitest-environment jsdom
import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { AgentChannelClient } from '@taucad/agent-host';
import type {
  ProjectTask,
  ProjectTaskChannelAnswer,
  ProjectTaskChannelRequest,
  ProjectTaskSnapshot,
} from '@taucad/agent-host/wire';
import { ProjectTasksProvider, useProjectTasks } from '#hooks/use-project-tasks.js';

const placement = vi.hoisted(() => ({ isDesktopTarget: true, workspaceRoot: vi.fn(), open: vi.fn() }));
vi.mock('#filesystem/desktop-bridge.js', () => ({
  get isDesktopTarget() {
    return placement.isDesktopTarget;
  },
}));
vi.mock('#lib/agent-host-placement.js', () => ({
  desktopWorkspaceRoot: placement.workspaceRoot,
  openAgentHostChannel: placement.open,
}));
const root: ProjectTask = {
  id: 'root',
  projectId: 'project-a',
  chatId: 'chat-root',
  depth: 0,
  title: 'Root',
  prompt: 'Work',
  provider: { id: 'codex' },
  createdAt: 1,
  closed: false,
  attempts: [
    {
      id: 'attempt-root',
      number: 1,
      status: 'running',
      toolGrant: { toolChoice: 'none', allowedTools: [] },
      source: { revisionId: 'base', checkoutId: 'base-checkout' },
      createdAt: 1,
    },
  ],
};
const snapshot = (over: Partial<ProjectTaskSnapshot> = {}): ProjectTaskSnapshot => ({
  tasks: [root],
  messages: [],
  cursor: 1,
  nextCursor: 1,
  hasMore: false,
  ...over,
});
const pending = async (_request: ProjectTaskChannelRequest, signal?: AbortSignal): Promise<ProjectTaskChannelAnswer> =>
  new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Observation aborted'));
      return;
    }
    signal?.addEventListener(
      'abort',
      () => {
        reject(new Error('Observation aborted'));
      },
      { once: true },
    );
  });

beforeEach(() => {
  vi.clearAllMocks();
  placement.isDesktopTarget = true;
  placement.workspaceRoot.mockResolvedValue('/projects/a');
});
afterEach(cleanup);

describe('Project task observation', () => {
  it('shares one project channel across consumers and aborts it when the provider detaches', async () => {
    const client = mock<AgentChannelClient>();
    const next = mock<AgentChannelClient>();
    placement.open.mockResolvedValueOnce(client).mockResolvedValueOnce(next);
    client.projectTasks.mockResolvedValueOnce({ kind: 'snapshot', snapshot: snapshot() });
    client.projectTasks.mockImplementation(pending);
    next.projectTasks.mockImplementation(pending);
    let providerProjectId = 'project-a';
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ProjectTasksProvider projectId={providerProjectId}>{children}</ProjectTasksProvider>
    );
    const view = renderHook(
      ({ projectId }) => ({ first: useProjectTasks(projectId), second: useProjectTasks(projectId) }),
      { wrapper, initialProps: { projectId: 'project-a' } },
    );
    await waitFor(() => {
      expect(view.result.current.first.snapshot?.tasks).toEqual([root]);
      expect(view.result.current.second.snapshot).toBe(view.result.current.first.snapshot);
    });
    expect(placement.open).toHaveBeenCalledTimes(1);
    expect(client.projectTasks.mock.calls.filter(([request]) => request.operation === 'read')).toHaveLength(1);
    providerProjectId = 'project-b';
    view.rerender({ projectId: 'project-b' });
    expect(view.result.current.first.snapshot).toBeUndefined();
    await waitFor(() => {
      expect(placement.open).toHaveBeenCalledTimes(2);
    });
    expect(client.close).toHaveBeenCalledWith('project-task-view-closed');
    view.unmount();
    expect(next.close).toHaveBeenCalledWith('project-task-view-closed');
  });
  it('keeps the same project snapshot during reconnect and clears it when the project changes', async () => {
    const first = mock<AgentChannelClient>();
    const second = mock<AgentChannelClient>();
    const third = mock<AgentChannelClient>();
    placement.open.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(third);
    first.projectTasks.mockResolvedValueOnce({ kind: 'snapshot', snapshot: snapshot() });
    first.projectTasks.mockImplementation(pending);
    second.projectTasks.mockImplementation(pending);
    third.projectTasks.mockImplementation(pending);
    const view = renderHook(({ projectId }) => useProjectTasks(projectId), {
      initialProps: { projectId: 'project-a' },
    });
    await waitFor(() => {
      expect(view.result.current.snapshot?.tasks).toEqual([root]);
    });
    act(() => {
      view.result.current.retry();
    });
    expect(view.result.current.isLoading).toBe(true);
    expect(view.result.current.snapshot?.tasks).toEqual([root]);
    await waitFor(() => {
      expect(placement.open).toHaveBeenCalledTimes(2);
    });
    act(() => {
      view.rerender({ projectId: 'project-b' });
    });
    expect(view.result.current.snapshot).toBeUndefined();
    await waitFor(() => {
      expect(placement.open).toHaveBeenCalledTimes(3);
    });
    view.unmount();
  });

  it('consumes mailbox pages before waiting and closes its channel when detached', async () => {
    const client = mock<AgentChannelClient>();
    placement.open.mockResolvedValue(client);
    client.projectTasks.mockResolvedValueOnce({
      kind: 'snapshot',
      snapshot: snapshot({
        cursor: 7,
        nextCursor: 3,
        hasMore: true,
        messages: [
          {
            id: 'm1',
            sequence: 3,
            projectId: 'project-a',
            recipientTaskId: 'root',
            requestId: 'q1',
            text: 'First',
            createdAt: 1,
          },
        ],
      }),
    });
    client.projectTasks.mockResolvedValueOnce({
      kind: 'snapshot',
      snapshot: snapshot({
        cursor: 7,
        nextCursor: 7,
        messages: [
          {
            id: 'm2',
            sequence: 6,
            projectId: 'project-a',
            recipientTaskId: 'root',
            requestId: 'q2',
            text: 'Second',
            createdAt: 1,
          },
        ],
      }),
    });
    client.projectTasks.mockImplementation(pending);
    const view = renderHook(() => useProjectTasks('project-a'));
    await waitFor(() => {
      expect(view.result.current.snapshot?.messages.map((message) => message.text)).toEqual(['First', 'Second']);
    });
    expect(client.projectTasks.mock.calls.map(([request]) => request)).toEqual([
      { operation: 'read', input: { after: 0, limit: 100 } },
      { operation: 'read', input: { after: 3, limit: 100 } },
      { operation: 'wait', input: { after: 7, limit: 100, timeout: 30_000 } },
    ]);
    const signal = client.projectTasks.mock.calls[2]?.[1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(client.close).toHaveBeenCalledWith('project-task-view-closed');
  });

  it('retains an uncertain message request identity until the host acknowledges it', async () => {
    const client = mock<AgentChannelClient>();
    placement.open.mockResolvedValue(client);
    let sendCount = 0;
    client.projectTasks.mockImplementation(async (request, signal) => {
      if (request.operation === 'read') {
        return { kind: 'snapshot', snapshot: snapshot() };
      }
      if (request.operation === 'send') {
        sendCount += 1;
        if (sendCount === 1) {
          throw new Error('Connection interrupted');
        }
        return {
          kind: 'message',
          message: {
            id: 'message',
            sequence: 2,
            projectId: 'project-a',
            recipientTaskId: request.input.taskId,
            requestId: request.input.requestId,
            text: request.input.text,
            createdAt: 1,
          },
        };
      }
      return pending(request, signal);
    });
    const view = renderHook(() => useProjectTasks('project-a'));
    await waitFor(() => {
      expect(view.result.current.snapshot?.tasks).toEqual([root]);
    });
    await expect(view.result.current.actions.send('root', 'nonce')).rejects.toThrow('Connection interrupted');
    await act(async () => view.result.current.actions.send('root', 'nonce'));
    const sends = client.projectTasks.mock.calls
      .map(([request]) => request)
      .filter((request) => request.operation === 'send');
    expect(sends).toHaveLength(2);
    expect(sends[0]?.input).toEqual(sends[1]?.input);
  });

  it('does not attach a task host for a browser project and explains capability honestly', async () => {
    placement.isDesktopTarget = false;
    const view = renderHook(() => useProjectTasks('project-a'));
    await waitFor(() => {
      expect(view.result.current.unavailable).toContain('Tau desktop');
    });
    expect(placement.open).not.toHaveBeenCalled();
  });

  it('can attach after the Strict Mode cleanup probe and refuses no fabricated snapshot', async () => {
    const client = mock<AgentChannelClient>();
    placement.open.mockResolvedValue(client);
    client.projectTasks.mockResolvedValue({
      kind: 'refused',
      code: 'TASK_UNAVAILABLE',
      message: 'This host does not support child tasks.',
    });
    const view = renderHook(() => useProjectTasks('project-a'), { wrapper: StrictMode });
    await waitFor(() => {
      expect(view.result.current.unavailable).toBe('This host does not support child tasks.');
    });
    expect(view.result.current.snapshot).toBeUndefined();
    expect(view.result.current.error).toBeUndefined();
  });
});
