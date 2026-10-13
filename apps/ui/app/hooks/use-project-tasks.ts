import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentChannelClient } from '@taucad/agent-host';
import type { ProjectTaskChannelRequest, ProjectTaskSnapshot } from '@taucad/agent-host/wire';
import { projectTaskSendSchema } from '@taucad/agent-host/wire';
import { generatePrefixedId } from '@taucad/utils/id';
import { idPrefix } from '@taucad/types/constants';
import { isDesktopTarget } from '#filesystem/desktop-bridge.js';
import { desktopWorkspaceRoot, openAgentHostChannel } from '#lib/agent-host-placement.js';
import type { ProjectTaskActions } from '#components/project-tasks/project-task-tree.js';

type ProjectTasksView = Readonly<{
  snapshot?: ProjectTaskSnapshot;
  isLoading: boolean;
  unavailable?: string;
  error?: string;
  retry: () => void;
  actions: ProjectTaskActions;
}>;

const browserReason =
  'Child tasks require the desktop project host. Open this project in Tau desktop to use child tasks.';

/** Observe the host journal; React never owns admission, task execution or a second transcript. */
export function useProjectTasks(projectId: string, isEnabled = true): ProjectTasksView {
  const [generation, setGeneration] = useState(0);
  const owner = useMemo(() => ({ projectId, generation, isEnabled }), [projectId, generation, isEnabled]);
  const connection = useRef<
    Readonly<{ owner: typeof owner; client: AgentChannelClient; controller: AbortController }> | undefined
  >(undefined);
  const requests = useMemo(() => ({ projectId, ids: new Map<string, string>() }), [projectId]);
  const [view, setView] = useState<
    Readonly<{
      owner: typeof owner;
      snapshot?: ProjectTaskSnapshot;
      isLoading: boolean;
      unavailable?: string;
      error?: string;
    }>
  >({ owner, isLoading: true });

  useEffect(() => {
    if (!isEnabled || !isDesktopTarget) {
      return;
    }
    const controller = new AbortController();
    let observationClient: AgentChannelClient | undefined;
    const observe = async (): Promise<void> => {
      const workspaceRoot = await desktopWorkspaceRoot(projectId);
      controller.signal.throwIfAborted();
      const client = await openAgentHostChannel('desktop', { workspaceRoot, projectId });
      observationClient = client;
      controller.signal.throwIfAborted();
      connection.current = { owner, client, controller };
      let after = 0;
      let shouldRead = true;
      const messages = new Map<string, ProjectTaskSnapshot['messages'][number]>();
      while (!controller.signal.aborted) {
        const request: ProjectTaskChannelRequest = shouldRead
          ? { operation: 'read', input: { after, limit: 100 } }
          : { operation: 'wait', input: { after, limit: 100, timeout: 30_000 } };
        // One bounded owner wait at a time; closing the pane aborts it and releases the channel.
        // oxlint-disable-next-line eslint/no-await-in-loop -- Ordered cursors must be consumed before requesting the next page.
        const answer = await client.projectTasks(request, controller.signal);
        controller.signal.throwIfAborted();
        if (answer.kind === 'refused') {
          if (answer.code === 'TASK_UNAVAILABLE') {
            setView({ owner, isLoading: false, unavailable: answer.message });
            return;
          }
          throw new Error(answer.message);
        }
        if (answer.kind !== 'snapshot') {
          throw new Error('The project host returned an unexpected task response. Reconnect and try again.');
        }
        for (const message of answer.snapshot.messages) {
          messages.set(message.id, message);
        }
        const snapshot = {
          ...answer.snapshot,
          messages: [...messages.values()].sort((a, b) => a.sequence - b.sequence),
        };
        setView({ owner, snapshot, isLoading: answer.snapshot.hasMore });
        after = answer.snapshot.nextCursor;
        shouldRead = answer.snapshot.hasMore;
      }
    };
    const supervise = async (): Promise<void> => {
      try {
        await observe();
      } catch (error) {
        if (!controller.signal.aborted) {
          setView((previous) => ({
            owner,
            snapshot: previous.owner === owner ? previous.snapshot : undefined,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Could not read project tasks. Reconnect and try again.',
          }));
        }
      } finally {
        controller.abort();
        observationClient?.close('project-task-observation-ended');
      }
    };
    // async-iife: bootstrap — This pane owns and aborts its bounded host observation.
    void supervise();
    return () => {
      controller.abort();
      observationClient?.close('project-task-view-closed');
    };
  }, [isEnabled, owner, projectId]);

  const command = useCallback(
    async (operation: 'send' | 'cancel' | 'resume', taskId: string, text?: string): Promise<void> => {
      const active = connection.current;
      if (!isDesktopTarget || active === undefined || active.owner !== owner || active.controller.signal.aborted) {
        throw new Error('The project task host is unavailable. Reconnect and try again.');
      }
      const { client, controller } = active;
      const key = JSON.stringify([operation, taskId, text]);
      const requestId = requests.ids.get(key) ?? generatePrefixedId(idPrefix.request);
      requests.ids.set(key, requestId);
      const request: ProjectTaskChannelRequest =
        operation === 'send'
          ? { operation, input: projectTaskSendSchema.parse({ taskId, requestId, text: text ?? '' }) }
          : { operation, input: { taskId, requestId } };
      const answer = await client.projectTasks(request, controller.signal);
      if (answer.kind === 'refused') {
        requests.ids.delete(key);
        throw new Error(answer.message);
      }
      if ((operation === 'send' && answer.kind !== 'message') || (operation !== 'send' && answer.kind !== 'task')) {
        throw new Error('The project host returned an unexpected task response. Reconnect and try again.');
      }
      requests.ids.delete(key);
    },
    [owner, requests],
  );
  const send = useCallback(
    async (taskId: string, text: string): Promise<void> => command('send', taskId, text),
    [command],
  );
  const cancel = useCallback(async (taskId: string): Promise<void> => command('cancel', taskId), [command]);
  const resume = useCallback(async (taskId: string): Promise<void> => command('resume', taskId), [command]);
  const actions = useMemo(() => ({ send, cancel, resume }), [send, cancel, resume]);
  const retry = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);
  if (!isEnabled) {
    return { isLoading: false, retry, actions };
  }
  if (!isDesktopTarget) {
    return { isLoading: false, unavailable: browserReason, retry, actions };
  }
  return { ...(view.owner === owner ? view : { isLoading: true }), retry, actions };
}
