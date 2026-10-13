import '#styles/global.css';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type { ProjectTask } from '@taucad/agent-host/wire';
import { ProjectTaskTree } from '#components/project-tasks/project-task-tree.js';
import { ProjectInstructions } from '#components/project-tasks/project-instructions.js';

const instructionFiles = vi.hoisted(() => ({ text: '' }));
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'project' }) }));
vi.mock('#hooks/use-file-manager.js', () => {
  const manager = {
    whenServicesReady: async () => ({
      contentService: {
        resolve: async () => ({ kind: 'text', content: new TextEncoder().encode(instructionFiles.text) }),
      },
    }),
    createDirectory: async () => undefined,
    writeFile: async (_path: string, bytes: Uint8Array<ArrayBuffer>) => {
      instructionFiles.text = new TextDecoder().decode(bytes);
    },
  };
  return { useFileManager: () => manager };
});

afterEach(cleanup);
const tasks: ProjectTask[] = [
  {
    id: 'root',
    projectId: 'project',
    chatId: 'chat-root',
    depth: 0,
    title: 'Design bracket',
    prompt: 'Design a bracket',
    provider: { id: 'codex' },
    createdAt: 1,
    closed: false,
    attempts: [
      {
        id: 'attempt-root',
        number: 1,
        status: 'running',
        toolGrant: { toolChoice: 'none', allowedTools: [] },
        source: { revisionId: 'source', checkoutId: 'checkout' },
        createdAt: 1,
      },
    ],
  },
  {
    id: 'child',
    projectId: 'project',
    chatId: 'chat-child',
    parentTaskId: 'root',
    depth: 1,
    title: 'Check mounting holes',
    prompt: 'Check mounting holes',
    provider: { id: 'tau' },
    createdAt: 2,
    closed: false,
    attempts: [
      {
        id: 'attempt-child',
        number: 1,
        status: 'running',
        toolGrant: { toolChoice: 'none', allowedTools: [] },
        source: { revisionId: 'source', checkoutId: 'candidate' },
        createdAt: 2,
      },
    ],
  },
  {
    id: 'grandchild',
    projectId: 'project',
    chatId: 'chat-grandchild',
    parentTaskId: 'child',
    depth: 2,
    title: 'Verify note',
    prompt: 'Read the supplied note',
    provider: { id: 'codex' },
    createdAt: 3,
    closed: false,
    attempts: [
      {
        id: 'attempt-grandchild',
        number: 1,
        status: 'running',
        toolGrant: { toolChoice: 'none', allowedTools: [] },
        source: { revisionId: 'source', checkoutId: 'grandchild-candidate' },
        createdAt: 3,
      },
    ],
  },
];

it('opens child details, sends a message, and confirms named subtree cancellation with the keyboard', async () => {
  const send = vi.fn(async () => undefined);
  const cancel = vi.fn(async () => undefined);
  const resume = vi.fn(async () => undefined);
  render(
    <MemoryRouter>
      <main className='max-w-md p-4'>
        <ProjectTaskTree
          tasks={tasks}
          messages={[]}
          agents={[]}
          projectSlugs={{ workspaceSlug: 'home', projectSlug: 'bracket' }}
          actions={{ send, cancel, resume }}
        />
      </main>
    </MemoryRouter>,
  );
  const disclosure = screen.getByRole('button', { name: 'Task details for Check mounting holes' });
  disclosure.focus();
  await userEvent.keyboard('{Enter}');
  await expect
    .element(page.getByRole('button', { name: 'Task details for Check mounting holes' }))
    .toHaveAttribute('aria-expanded', 'true');
  const editor = screen.getByRole('textbox', { name: 'Message Check mounting holes' });
  editor.focus();
  await userEvent.keyboard('Check the spacing against knowledge/spec.md');
  screen.getByRole('button', { name: 'Send message' }).focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith('child', 'Check the spacing against knowledge/spec.md');
  });
  await expect.element(page.getByRole('status')).toHaveTextContent('Message saved in the task inbox');
  await page.screenshot({ fullPage: true });
  screen.getByRole('button', { name: 'Cancel task' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(cancel).not.toHaveBeenCalled();
  await expect.element(page.getByRole('group', { name: 'Cancel Check mounting holes' })).toBeVisible();
  screen.getByRole('button', { name: 'Cancel Check mounting holes' }).focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => {
    expect(cancel).toHaveBeenCalledWith('child');
  });
  await expect.element(page.getByRole('status')).toHaveTextContent('Task cancellation requested');
});

it('opens project instructions, saves them, and restores trigger focus when closed with Escape', async () => {
  instructionFiles.text = '';
  render(
    <TooltipProvider>
      <ProjectInstructions />
    </TooltipProvider>,
  );
  const trigger = screen.getByRole('button', { name: 'Project instructions' });
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('dialog', { name: 'Project instructions' })).toBeVisible();
  const editor = screen.getByRole('textbox', { name: 'Instructions' });
  await waitFor(() => {
    expect(editor.hasAttribute('disabled')).toBe(false);
  });
  editor.focus();
  await userEvent.keyboard('Use millimeters. Reference knowledge/materials.md');
  screen.getByRole('button', { name: 'Save instructions' }).focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('status')).toHaveTextContent('Instructions saved');
  const dialog = screen.getByRole('dialog', { name: 'Project instructions' });
  const reload = screen.getByRole('button', { name: 'Load instructions again' });
  expect(reload.getBoundingClientRect().right).toBeLessThanOrEqual(dialog.getBoundingClientRect().right);
  await page.screenshot({ fullPage: true });
  expect(instructionFiles.text).toBe('Use millimeters. Reference knowledge/materials.md');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => {
    expect(document.activeElement).toBe(trigger);
  });
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('textbox', { name: 'Instructions' })).toHaveValue(instructionFiles.text);
});
