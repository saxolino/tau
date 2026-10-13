import { memo, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ProjectTask, ProjectTaskMessage, ProjectTaskStatus } from '@taucad/agent-host/wire';
import { projectTaskMailboxLimits } from '@taucad/agent-host/wire';
import { Button } from '@taucad/ui/components/button';
import { Textarea } from '@taucad/ui/components/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@taucad/ui/components/collapsible';
import { ChevronDown } from 'lucide-react';
import { projectChatUrl } from '#utils/project-url.utils.js';
import type { ProjectSlugs } from '#utils/project-url.utils.js';
import type { AgentProjection } from '#hooks/use-agent-projections.js';

const statusLabels: Readonly<Record<ProjectTaskStatus, string>> = {
  allocating: 'Starting',
  running: 'Running',
  cancelling: 'Stopping',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

export type ProjectTaskActions = Readonly<{
  send: (taskId: string, text: string) => Promise<void>;
  cancel: (taskId: string) => Promise<void>;
  resume: (taskId: string) => Promise<void>;
}>;

type TaskTreeProps = Readonly<{
  tasks: readonly ProjectTask[];
  messages: readonly ProjectTaskMessage[];
  agents: readonly AgentProjection[];
  projectSlugs?: ProjectSlugs;
  actions: ProjectTaskActions;
  onReviewChanges?: () => void;
}>;

/** The durable host lineage remains visible independently of the selected chat. */
export function ProjectTaskTree({
  tasks,
  messages,
  agents,
  projectSlugs,
  actions,
  onReviewChanges,
}: TaskTreeProps): React.JSX.Element {
  const taskIds = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks]);
  const roots = useMemo(
    () => tasks.filter((task) => task.parentTaskId === undefined || !taskIds.has(task.parentTaskId)),
    [tasks, taskIds],
  );
  const children = useMemo(() => {
    const result = new Map<string, ProjectTask[]>();
    for (const task of tasks) {
      if (task.parentTaskId !== undefined) {
        const siblings = result.get(task.parentTaskId) ?? [];
        siblings.push(task);
        result.set(task.parentTaskId, siblings);
      }
    }
    return result;
  }, [tasks]);
  const agentsByChat = useMemo(() => new Map(agents.map((agent) => [agent.chatId, agent])), [agents]);
  return (
    <ol aria-label='Project tasks' className='flex flex-col gap-2'>
      {roots.map((task) => (
        <TaskBranch
          key={task.id}
          task={task}
          childrenByParent={children}
          agentsByChat={agentsByChat}
          messages={messages}
          projectSlugs={projectSlugs}
          actions={actions}
          onReviewChanges={onReviewChanges}
        />
      ))}
    </ol>
  );
}

const TaskBranch = memo(function TaskBranch({
  task,
  childrenByParent,
  agentsByChat,
  messages,
  projectSlugs,
  actions,
  onReviewChanges,
}: Readonly<{
  task: ProjectTask;
  childrenByParent: ReadonlyMap<string, readonly ProjectTask[]>;
  agentsByChat: ReadonlyMap<string, AgentProjection>;
  messages: readonly ProjectTaskMessage[];
  projectSlugs?: ProjectSlugs;
  actions: ProjectTaskActions;
  onReviewChanges?: () => void;
}>): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const attempt = task.attempts.at(-1);
  const agent = agentsByChat.get(task.chatId);
  const children = childrenByParent.get(task.id) ?? [];
  return (
    <li>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className='border-b border-border pb-2'>
        <div className='flex items-center gap-2'>
          <CollapsibleTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              aria-label={`Task details for ${task.title}`}
              className='min-w-0 flex-1 justify-start'
            >
              <ChevronDown aria-hidden className='size-3.5 shrink-0' />
              <span className='truncate'>{task.title}</span>
            </Button>
          </CollapsibleTrigger>
          <span className='shrink-0 text-xs'>{attempt ? statusLabels[attempt.status] : 'Unknown'}</span>
        </div>
        <div className='flex flex-wrap items-center gap-2 px-2 text-xs text-muted-foreground'>
          <span>
            {task.provider.id}
            {task.provider.model ? ` · ${task.provider.model}` : ''}
          </span>
          {agent?.focused ? <span>Current chat</span> : null}
          {projectSlugs ? (
            <Link
              className='text-foreground underline underline-offset-4 focus-visible:focus-outline'
              to={projectChatUrl(projectSlugs, task.chatId)}
              state={{ openChat: true }}
            >
              Open transcript for {task.title}
            </Link>
          ) : null}
          {projectSlugs && onReviewChanges && attempt?.placementId ? (
            <Link
              className='text-foreground underline underline-offset-4 focus-visible:focus-outline'
              to={projectChatUrl(projectSlugs, task.chatId)}
              state={{ openChat: true }}
              onClick={onReviewChanges}
            >
              Review changes for {task.title}
            </Link>
          ) : null}
          {projectSlugs && (agent?.pendingApprovalCount ?? 0) > 0 ? (
            <Link
              className='text-foreground underline underline-offset-4 focus-visible:focus-outline'
              to={projectChatUrl(projectSlugs, task.chatId)}
              state={{ openChat: true }}
            >
              Review permissions for {task.title} ({agent?.pendingApprovalCount})
            </Link>
          ) : null}
        </div>
        <CollapsibleContent>
          <TaskDetails task={task} messages={messages} actions={actions} />
        </CollapsibleContent>
      </Collapsible>
      {children.length > 0 ? (
        <ol
          aria-label={`Child tasks of ${task.title}`}
          className='ml-3 flex flex-col gap-2 border-l border-border py-2 pl-2'
        >
          {children.map((child) => (
            <TaskBranch
              key={child.id}
              task={child}
              childrenByParent={childrenByParent}
              agentsByChat={agentsByChat}
              messages={messages}
              projectSlugs={projectSlugs}
              actions={actions}
              onReviewChanges={onReviewChanges}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
});

const TaskDetails = memo(function TaskDetails({
  task,
  messages,
  actions,
}: Readonly<{
  task: ProjectTask;
  messages: readonly ProjectTaskMessage[];
  actions: ProjectTaskActions;
}>): React.JSX.Element {
  const [text, setText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const attempt = task.attempts.at(-1);
  const status = attempt?.status;
  const canCancel = status === 'allocating' || status === 'running';
  const canResume = status === 'failed' || status === 'cancelled' || status === 'interrupted';
  const mailbox = useMemo(
    () => messages.filter((message) => message.recipientTaskId === task.id || message.senderTaskId === task.id),
    [messages, task.id],
  );
  const perform = useCallback(async (operation: () => Promise<void>, success: string): Promise<void> => {
    setIsBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await operation();
      setNotice(success);
      setIsConfirmingCancel(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The task action failed. Try again.');
    } finally {
      setIsBusy(false);
    }
  }, []);
  const send = useCallback(async (): Promise<void> => {
    await perform(async () => {
      await actions.send(task.id, text);
      setText('');
    }, 'Message saved in the task inbox. Model delivery is separate from saving.');
  }, [actions, perform, task.id, text]);
  const cancel = useCallback(
    async (): Promise<void> => perform(async () => actions.cancel(task.id), 'Task cancellation requested.'),
    [actions, perform, task.id],
  );
  const resume = useCallback(
    async (): Promise<void> => perform(async () => actions.resume(task.id), 'A new task attempt was requested.'),
    [actions, perform, task.id],
  );
  return (
    <section aria-label={`Details for ${task.title}`} className='flex flex-col gap-3 px-2 pt-3 text-sm'>
      <p className='break-words whitespace-pre-wrap'>{task.prompt}</p>
      <ol aria-label={`Attempts for ${task.title}`} className='flex flex-col gap-2'>
        {task.attempts.map((item) => (
          <li key={item.id} className='text-xs'>
            <p>
              Attempt {item.number} · {statusLabels[item.status]}
            </p>
            {item.detail ? <p className='break-words whitespace-pre-wrap'>{item.detail}</p> : null}
            <p className='break-all text-muted-foreground'>Source revision: {item.source.revisionId}</p>
            <p className='break-words text-muted-foreground'>
              Tool selection:{' '}
              {typeof item.toolGrant.toolChoice === 'string'
                ? item.toolGrant.toolChoice
                : item.toolGrant.toolChoice.join(', ') || 'None'}
            </p>
            <p className='break-words text-muted-foreground'>
              Allowed tools:{' '}
              {item.toolGrant.allowedTools === undefined
                ? 'Not listed'
                : item.toolGrant.allowedTools.join(', ') || 'None'}
            </p>
            {item.placementId ? <p className='break-all text-muted-foreground'>Placement: {item.placementId}</p> : null}
          </li>
        ))}
      </ol>
      <p className='text-xs text-muted-foreground'>
        Inspect this task’s transcript and its revision result before applying changes through History.
      </p>
      {mailbox.length > 0 ? (
        <ol aria-label={`Messages for ${task.title}`} className='flex flex-col gap-2'>
          {mailbox.map((message) => (
            <li key={message.id} className='border-l border-border pl-2 text-xs'>
              <span className='text-muted-foreground'>
                {message.senderTaskId === undefined
                  ? 'You'
                  : message.senderTaskId === task.id
                    ? 'This task'
                    : 'Related task'}{' '}
                · {message.sequence}
              </span>
              <p className='break-words whitespace-pre-wrap'>{message.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className='flex flex-col gap-2'
      >
        <label htmlFor={`task-message-${task.id}`} className='text-xs font-medium'>
          Message {task.title}
        </label>
        <Textarea
          id={`task-message-${task.id}`}
          value={text}
          maxLength={projectTaskMailboxLimits.maxTextBytes}
          disabled={isBusy || task.closed}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <div className='flex flex-wrap gap-2'>
          <Button
            type='submit'
            variant='outline'
            size='sm'
            disabled={isBusy || task.closed || text.trim().length === 0}
            aria-busy={isBusy}
          >
            Send message
          </Button>
          {canCancel ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={isBusy}
              onClick={() => {
                setIsConfirmingCancel(true);
              }}
            >
              Cancel task
            </Button>
          ) : null}
          {canResume ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={isBusy}
              onClick={() => {
                void resume();
              }}
            >
              Retry task
            </Button>
          ) : null}
        </div>
      </form>
      {isConfirmingCancel ? (
        <div role='group' aria-label={`Cancel ${task.title}`} className='flex flex-col gap-2'>
          <p>Cancel {task.title} and its child tasks? Partial work remains available for review.</p>
          <div className='flex gap-2'>
            <Button
              size='sm'
              disabled={isBusy}
              onClick={() => {
                void cancel();
              }}
            >
              Cancel {task.title}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={isBusy}
              onClick={() => {
                setIsConfirmingCancel(false);
              }}
            >
              Keep running
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p role='alert'>{error}</p> : null}
      {notice ? <p role='status'>{notice}</p> : null}
    </section>
  );
});
