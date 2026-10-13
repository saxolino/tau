// @vitest-environment jsdom
import { fireEvent, render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectTask } from '@taucad/agent-host/wire';
import { ProjectTaskTree } from '#components/project-tasks/project-task-tree.js';
import type { ProjectTaskActions } from '#components/project-tasks/project-task-tree.js';
import type { AgentProjection } from '#hooks/use-agent-projections.js';

afterEach(cleanup);
const task = (id: string, parentTaskId?: string): ProjectTask => ({
  id,
  projectId: 'project-a',
  chatId: `chat-${id}`,
  parentTaskId,
  depth: parentTaskId ? 1 : 0,
  title: id,
  prompt: `Do work for ${id}`,
  provider: { id: 'codex' },
  createdAt: 1,
  closed: false,
  attempts: [
    {
      id: `attempt-${id}`,
      number: 1,
      status: 'running',
      toolGrant: { toolChoice: 'none', allowedTools: [] },
      source: { revisionId: 'base', checkoutId: 'checkout-base' },
      createdAt: 1,
    },
  ],
});
const actions = (): ProjectTaskActions => ({
  send: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
});
const childProjection: AgentProjection = {
  chatId: 'chat-child',
  name: 'child',
  state: 'waiting',
  focused: false,
  lastActivityAt: 1,
  model: { id: 'codex', name: 'Codex', family: 'unknown', provider: 'OpenAI' },
  workspace: 'project-a',
  branch: undefined,
  pendingApprovalCount: 1,
  operationIds: [],
  unread: false,
};
const slugs = { workspaceSlug: 'home', projectSlug: 'project-a' };

describe('Project task tree', () => {
  it('opens the exact child transcript and existing revision review without adopting changes', () => {
    const child = task('child');
    child.attempts[0] = { ...child.attempts[0]!, placementId: 'placement-child' };
    const reviewChanges = vi.fn();
    render(
      <MemoryRouter>
        <ProjectTaskTree
          tasks={[child]}
          messages={[]}
          agents={[]}
          projectSlugs={slugs}
          actions={actions()}
          onReviewChanges={reviewChanges}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Review changes for child' });
    expect(link.getAttribute('href')).toBe('/w/home/project-a?chat=chat-child');
    expect(reviewChanges).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(reviewChanges).toHaveBeenCalledOnce();
  });

  it('shows root, child and grandchild lineage and routes permissions to the exact child chat', () => {
    render(
      <MemoryRouter>
        <ProjectTaskTree
          tasks={[task('root'), task('child', 'root'), task('grandchild', 'child')]}
          messages={[]}
          agents={[childProjection]}
          projectSlugs={slugs}
          actions={actions()}
        />
      </MemoryRouter>,
    );
    const childList = screen.getByRole('list', { name: 'Child tasks of root' });
    expect(within(childList).getByRole('list', { name: 'Child tasks of child' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open transcript for grandchild' }).getAttribute('href')).toBe(
      '/w/home/project-a?chat=chat-grandchild',
    );
    expect(screen.getByRole('link', { name: 'Review permissions for child (1)' }).getAttribute('href')).toBe(
      '/w/home/project-a?chat=chat-child',
    );
    expect(screen.queryByRole('link', { name: /Review permissions for root/u })).toBeNull();
  });

  it('persists a message to the selected task and distinguishes append from model delivery', async () => {
    const commands = actions();
    render(
      <MemoryRouter>
        <ProjectTaskTree
          tasks={[task('root'), task('child', 'root')]}
          messages={[]}
          agents={[]}
          projectSlugs={slugs}
          actions={commands}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Task details for child' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message child' }), { target: { value: 'nonce-reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Model delivery is separate');
    expect(commands.send).toHaveBeenCalledWith('child', 'nonce-reply');
    expect(screen.getByRole('textbox', { name: 'Message child' })).toHaveProperty('value', '');
  });

  it('names the task and subtree before cancelling and preserves errors for recovery', async () => {
    const commands = actions();
    vi.mocked(commands.cancel).mockRejectedValue(new Error('Task has a pending settlement. Try again.'));
    render(
      <MemoryRouter>
        <ProjectTaskTree tasks={[task('child')]} messages={[]} agents={[]} actions={commands} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Task details for child' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
    expect(commands.cancel).not.toHaveBeenCalled();
    expect(
      screen.getByText('Cancel child and its child tasks? Partial work remains available for review.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel child' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('pending settlement');
    expect(commands.cancel).toHaveBeenCalledWith('child');
  });

  it('shows terminal result, durable mailbox and retry without reapplying child changes', async () => {
    const child = task('child');
    child.attempts[0] = { ...child.attempts[0]!, status: 'interrupted', detail: 'Partial bracket saved' };
    const commands = actions();
    render(
      <MemoryRouter>
        <ProjectTaskTree
          tasks={[child]}
          messages={[
            {
              id: 'message-1',
              sequence: 5,
              projectId: 'project-a',
              recipientTaskId: 'child',
              requestId: 'request-1',
              text: 'Durable reply',
              createdAt: 1,
            },
          ]}
          agents={[]}
          actions={commands}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Task details for child' }));
    expect(screen.getByText('Partial bracket saved')).toBeDefined();
    expect(screen.getByText('Durable reply')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry task' }));
    await screen.findByRole('status');
    expect(commands.resume).toHaveBeenCalledWith('child');
  });
});
