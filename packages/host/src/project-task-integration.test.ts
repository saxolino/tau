import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { ToolRegistry, TauAgentHost } from '@taucad/agent-host';
import { parseLogEvent } from '@taucad/agent-host';
import type { AgentLauncher } from '@taucad/agent-host/launcher';
import { toolName } from '@taucad/chat/constants';
import type { ProjectTaskCoordinator } from '#project-tasks/types.js';
import { withProjectTaskTools, readRecordedToolGrant } from '#project-task-integration.js';

describe('authenticated project task tool binding', () => {
  it('recovers the recorded legacy grant across bounded pages without inventing task authority', async () => {
    const host = mock<TauAgentHost>();
    const launcher = mock<AgentLauncher>({ host });
    const base = {
      version: 1,
      leaderEpoch: 'epoch',
      chatId: 'legacy',
      runId: 'legacy-run',
      recordedAt: '2026-10-13T00:00:00Z',
      attempt: 1,
    };
    host.readEvents.mockResolvedValueOnce({
      cursor: 0,
      nextCursor: 1,
      endCursor: 2,
      events: [
        parseLogEvent({
          ...base,
          sequence: 1,
          type: 'run.lifecycle',
          state: 'admitted',
          admission: {
            kind: 'external',
            config: { toolChoice: ['task_read'], allowedTools: ['task_read', 'export_model'] },
          },
        }),
      ],
    });
    host.readEvents.mockResolvedValueOnce({
      cursor: 1,
      nextCursor: 2,
      endCursor: 2,
      events: [parseLogEvent({ ...base, sequence: 2, type: 'run.lifecycle', state: 'paused' })],
    });
    expect(await readRecordedToolGrant(launcher, 'legacy', 'legacy-run')).toEqual({
      toolChoice: ['task_read'],
      allowedTools: ['task_read', 'export_model'],
    });
    expect(launcher.host.readEvents).toHaveBeenNthCalledWith(2, {
      chatId: 'legacy',
      cursor: 1,
      limit: 16,
      maxBytes: 1_048_576,
    });
    expect(launcher.execute).not.toHaveBeenCalled();
  });
  it('rejects forged model identity and unbound/stale callers before dispatch', async () => {
    const coordinator = mock<ProjectTaskCoordinator>();
    const base = mock<ToolRegistry>();
    base.list.mockReturnValue([]);
    const registry = withProjectTaskTools(
      base,
      async () => coordinator,
      (runId) => (runId === 'active' ? 'chat' : undefined),
    );
    const invoke = async (runId: string, input: Parameters<ToolRegistry['invoke']>[0]['input']) =>
      registry.invoke({
        toolName: toolName.taskSpawn,
        toolCallId: 'call',
        runId,
        input,
        signal: new AbortController().signal,
      });
    const unbound = await invoke('forged', {});
    expect(unbound.isError).toBe(true);
    expect(coordinator.spawn).not.toHaveBeenCalled();
    coordinator.callerFor.mockReturnValue({
      kind: 'task',
      projectId: 'project',
      taskId: 'parent',
      attemptId: 'attempt',
    });
    const forged = await invoke('active', {
      requestId: 'request',
      title: 'Child',
      prompt: 'Work',
      provider: { id: 'codex' },
      senderTaskId: 'other',
    });
    expect(forged.isError).toBe(true);
    expect(coordinator.spawn).not.toHaveBeenCalled();
    coordinator.callerFor.mockReturnValue(undefined);
    const stale = await invoke('active', {
      requestId: 'request',
      title: 'Child',
      prompt: 'Work',
      provider: { id: 'codex' },
    });
    expect(stale.isError).toBe(true);
    expect(coordinator.callerFor).toHaveBeenCalledWith({ chatId: 'chat', runId: 'active' });
    expect(base.invoke).not.toHaveBeenCalled();
  });
  it('forwards cancellation to bounded waits using the same active caller', async () => {
    const coordinator = mock<ProjectTaskCoordinator>();
    const base = mock<ToolRegistry>();
    base.list.mockReturnValue([]);
    const caller = { kind: 'task', projectId: 'project', taskId: 'parent', attemptId: 'attempt' } as const;
    coordinator.callerFor.mockReturnValue(caller);
    coordinator.wait.mockResolvedValue({ tasks: [], messages: [], cursor: 1, nextCursor: 1, hasMore: false });
    const controller = new AbortController();
    const registry = withProjectTaskTools(
      base,
      async () => coordinator,
      () => 'chat',
    );
    const result = await registry.invoke({
      toolName: toolName.taskWait,
      toolCallId: 'wait',
      runId: 'active',
      input: { after: 0, timeout: 50 },
      signal: controller.signal,
    });
    expect(result.isError).toBe(false);
    expect(coordinator.wait).toHaveBeenCalledWith(caller, { after: 0, timeout: 50 }, controller.signal);
    expect(registry.list().map(({ name }) => name)).toContain(toolName.taskSpawn);
  });
});
