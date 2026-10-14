import { memo, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ProjectTask, ProjectTaskMessage, ProjectTaskStatus } from '@taucad/agent-host/wire';
import { projectTaskMailboxLimits } from '@taucad/agent-host/wire';
import { Button } from '@taucad/ui/components/button';
import { Textarea } from '@taucad/ui/components/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@taucad/ui/components/collapsible';
import { ChevronDown, Circle, CircleAlert, CircleCheck, LoaderCircle, PauseCircle, Square } from 'lucide-react';
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

const statusIcons: Readonly<Record<ProjectTaskStatus, typeof Circle>> = {
  allocating: LoaderCircle,
  running: LoaderCircle,
  cancelling: LoaderCircle,
  completed: CircleCheck,
  failed: CircleAlert,
  cancelled: Square,
  interrupted: PauseCircle,
};

const providerName = (id: string): string => {
  if (id === 'codex') {
    return 'Codex';
  }
  if (id === 'tau') {
    return 'Tau';
  }
  return 'Agent';
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
  isReadOnly?: boolean;
}>;

/** The durable host lineage remains visible independently of the selected chat. */
export function ProjectTaskTree({
  tasks,
  messages,
  agents,
  projectSlugs,
  actions,
  onReviewChanges,
  isReadOnly = false,
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
    <section aria-label='Project tasks' className='rounded-xl border bg-card'>
      <div className='flex min-h-8 items-center border-b px-3 py-1'>
        <h2 className='text-sm font-medium'>Tasks</h2>
      </div>
      <ol aria-label='Project tasks' className='flex flex-col gap-0.5 p-1.5'>
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
            isReadOnly={isReadOnly}
            hasClosedAncestor={false}
            depth={0}
          />
        ))}
      </ol>
    </section>
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
  isReadOnly,
  hasClosedAncestor,
  depth,
}: Readonly<{
  task: ProjectTask;
  childrenByParent: ReadonlyMap<string, readonly ProjectTask[]>;
  agentsByChat: ReadonlyMap<string, AgentProjection>;
  messages: readonly ProjectTaskMessage[];
  projectSlugs?: ProjectSlugs;
  actions: ProjectTaskActions;
  onReviewChanges?: () => void;
  isReadOnly: boolean;
  hasClosedAncestor: boolean;
  depth: number;
}>): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [rowError, setRowError] = useState<string>();
  const [isRetrying, setIsRetrying] = useState(false);
  const attempt = task.attempts.at(-1);
  const agent = agentsByChat.get(task.chatId);
  const children = childrenByParent.get(task.id) ?? [];
  const isRoot = task.parentTaskId === undefined;
  const title = isRoot && agent?.name ? agent.name : task.title;
  const StatusIcon = attempt ? statusIcons[attempt.status] : Circle;
  const canRetry =
    !hasClosedAncestor &&
    (attempt?.status === 'failed' || attempt?.status === 'interrupted' || attempt?.status === 'cancelled');
  const onExpandedChange = useCallback((open: boolean): void => {
    setIsExpanded(open);
    if (open) {
      setHasOpened(true);
    }
  }, []);
  return (
    <li className='min-w-0'>
      <Collapsible open={isExpanded} onOpenChange={onExpandedChange}>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 rounded-md px-1 py-1 hover:bg-accent/50'>
          <CollapsibleTrigger asChild>
            <Button
              variant='ghost'
              size='default'
              aria-label={`Task details for ${task.title}`}
              className='min-w-0 flex-1 justify-start gap-2 text-left'
            >
              <ChevronDown aria-hidden className={isExpanded ? 'size-3.5 shrink-0 rotate-180' : 'size-3.5 shrink-0'} />
              <StatusIcon aria-hidden className='size-3.5 shrink-0 text-muted-foreground' />
              <span className='min-w-0 truncate'>{title}</span>
            </Button>
          </CollapsibleTrigger>
          <span className='shrink-0 text-xs text-muted-foreground'>
            {attempt ? statusLabels[attempt.status] : 'Unknown'}
          </span>
        </div>
        {isRoot ||
        agent?.focused === true ||
        agent?.unread === true ||
        agent?.state === 'waiting' ||
        agent?.state === 'error' ||
        (agent?.pendingApprovalCount ?? 0) > 0 ? (
          <div className='flex min-w-0 flex-wrap items-center gap-x-2 px-7 text-xs text-muted-foreground'>
            {isRoot ? (
              <span className='min-w-0 truncate' title={task.title}>
                {task.title}
              </span>
            ) : null}
            {agent?.focused ? <span>Current chat</span> : null}
            {agent?.unread ? <span>Unread</span> : null}
            {agent?.state === 'waiting' ? <span>Waiting for input</span> : null}
            {agent?.state === 'error' ? <span>Chat error</span> : null}
          </div>
        ) : null}
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 px-7 text-xs text-muted-foreground'>
          <span className='min-w-0 truncate'>
            {providerName(task.provider.id)}
            {task.provider.model ? ` · ${task.provider.model}` : ''}
          </span>
        </div>
        <div className='flex flex-wrap items-center gap-1 px-7 text-xs'>
          {projectSlugs ? (
            <Button asChild variant='ghost' size='xs'>
              <Link
                to={projectChatUrl(projectSlugs, task.chatId)}
                state={{ openChat: true }}
                aria-label={`Open transcript for ${task.title}`}
              >
                Transcript
              </Link>
            </Button>
          ) : null}
          {projectSlugs && onReviewChanges && attempt?.placementId ? (
            <Button asChild variant='ghost' size='xs'>
              <Link
                to={projectChatUrl(projectSlugs, task.chatId)}
                state={{ openChat: true }}
                onClick={onReviewChanges}
                aria-label={`Review changes for ${task.title}`}
              >
                Changes
              </Link>
            </Button>
          ) : null}
          {projectSlugs && (agent?.pendingApprovalCount ?? 0) > 0 ? (
            <Button asChild variant='ghost' size='xs'>
              <Link
                to={projectChatUrl(projectSlugs, task.chatId)}
                state={{ openChat: true }}
                aria-label={`Review permissions for ${task.title} (${agent?.pendingApprovalCount})`}
              >
                Permissions ({agent?.pendingApprovalCount})
              </Link>
            </Button>
          ) : null}
          {canRetry ? (
            <Button
              size='xs'
              variant='outline'
              disabled={isRetrying || isReadOnly}
              aria-busy={isRetrying}
              onClick={async () => {
                setIsRetrying(true);
                setRowError(undefined);
                try {
                  await actions.resume(task.id);
                } catch (error) {
                  setRowError(error instanceof Error ? error.message : 'Could not retry this task. Try again.');
                } finally {
                  setIsRetrying(false);
                }
              }}
            >
              Retry
            </Button>
          ) : null}
        </div>
        {attempt?.detail && (attempt.status === 'failed' || attempt.status === 'interrupted') ? (
          <p className='px-7 py-1 text-xs break-words'>{attempt.detail}</p>
        ) : null}
        {rowError ? (
          <p role='alert' className='px-7 text-xs break-words'>
            {rowError}
          </p>
        ) : null}
        <CollapsibleContent forceMount hidden={!isExpanded}>
          {hasOpened ? <TaskDetails task={task} messages={messages} actions={actions} isReadOnly={isReadOnly} /> : null}
        </CollapsibleContent>
      </Collapsible>
      {children.length > 0 ? (
        <ol
          aria-label={`Child tasks of ${task.title}`}
          className={
            depth < 3
              ? 'ml-3 flex min-w-0 flex-col gap-0.5 border-l border-border pl-2'
              : 'flex min-w-0 flex-col gap-0.5 border-l border-border pl-2'
          }
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
              isReadOnly={isReadOnly}
              hasClosedAncestor={hasClosedAncestor || task.closed}
              depth={depth + 1}
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
  isReadOnly,
}: Readonly<{
  task: ProjectTask;
  messages: readonly ProjectTaskMessage[];
  actions: ProjectTaskActions;
  isReadOnly: boolean;
}>): React.JSX.Element {
  const [text, setText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const attempt = task.attempts.at(-1);
  const status = attempt?.status;
  const canCancel = !task.closed && (status === 'allocating' || status === 'running');
  const canResume = !task.closed && status === 'completed' && task.parentTaskId !== undefined;
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
    <section aria-label={`Details for ${task.title}`} className='flex min-w-0 flex-col gap-3 px-2 pt-2 pb-3 text-sm'>
      <h3 className='text-sm font-medium break-words'>{task.title}</h3>
      {mailbox.length > 0 ? (
        <ol aria-label={`Messages for ${task.title}`} className='flex flex-col gap-2 border-t pt-2'>
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
          disabled={isBusy || task.closed || isReadOnly}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <div className='flex flex-wrap gap-2'>
          <Button
            type='submit'
            variant='outline'
            size='sm'
            disabled={isBusy || task.closed || isReadOnly || text.trim().length === 0}
            aria-busy={isBusy}
          >
            Send message
          </Button>
          {canCancel ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={isBusy || isReadOnly}
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
              disabled={isBusy || isReadOnly}
              onClick={() => {
                void resume();
              }}
            >
              Resume task
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
              disabled={isBusy || isReadOnly}
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
      <details className='border-t pt-2 text-xs'>
        <summary className='cursor-action rounded-md py-1 text-foreground focus-visible:focus-outline'>
          Task details
        </summary>
        <div className='flex min-w-0 flex-col gap-2 pt-2'>
          <p className='break-words whitespace-pre-wrap'>{task.prompt}</p>
          <p className='break-all text-muted-foreground'>Task ID: {task.id}</p>
          <p className='text-muted-foreground'>
            {task.provider.id}
            {task.provider.model ? ` · ${task.provider.model}` : ''}
          </p>
          <ol aria-label={`Attempts for ${task.title}`} className='flex flex-col gap-2'>
            {task.attempts.map((item) => (
              <li key={item.id} className='min-w-0 border-l pl-2'>
                <p>
                  Attempt {item.number} · {statusLabels[item.status]}
                </p>
                {item.detail ? <p className='break-words whitespace-pre-wrap'>{item.detail}</p> : null}
                <p className='break-all text-muted-foreground'>Attempt ID: {item.id}</p>
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
                {item.placementId ? (
                  <p className='break-all text-muted-foreground'>Placement: {item.placementId}</p>
                ) : null}
              </li>
            ))}
          </ol>
          <p className='text-muted-foreground'>Inspect the transcript and History before applying a task’s changes.</p>
        </div>
      </details>
    </section>
  );
});
