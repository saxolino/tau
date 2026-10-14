import '#styles/global.css';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type { ProjectTask, ProjectTaskSnapshot } from '@taucad/agent-host/wire';
import type { AgentProjection } from '#hooks/use-agent-projections.js';
import { ProjectTaskTree } from '#components/project-tasks/project-task-tree.js';
import { ProjectInstructions } from '#components/project-tasks/project-instructions.js';
import { AgentsPanelBody } from '#routes/w.$workspace.$project/chat-agents.js';

const instructionFiles = vi.hoisted(() => ({ text: '' }));
const panelView = vi.hoisted(() => ({
  snapshot: undefined as ProjectTaskSnapshot | undefined,
  agents: [] as AgentProjection[],
}));
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'project' }) }));
vi.mock('#hooks/use-project-slug-route.js', () => ({
  useProjectSlugs: () => ({ status: 'resolved', value: { workspaceSlug: 'home', projectSlug: 'bracket' } }),
}));
vi.mock('#hooks/use-project-tasks.js', () => ({
  useProjectTasks: () => ({
    snapshot: panelView.snapshot,
    isLoading: false,
    actions: { send: vi.fn(), cancel: vi.fn(), resume: vi.fn() },
    retry: vi.fn(),
  }),
}));
vi.mock('#hooks/use-agent-projections.js', () => ({
  useAgentProjections: () => ({ agents: panelView.agents, isLoading: false, retry: vi.fn() }),
}));
vi.mock('#routes/w.$workspace.$project/chat-message-data-usage.js', () => ({
  useReceiptCredits: () => new Map(),
  sumReceiptCredits: () => undefined,
  formatReceiptTotal: () => '—',
}));
vi.mock('#routes/w.$workspace.$project/project-workspace-context.js', () => ({
  useProjectWorkspace: () => ({ openPanel: vi.fn() }),
}));
vi.mock('#hooks/use-file-manager.js', () => {
  const manager = {
    recordFiles: {
      exists: async () => true,
      stat: async () => ({
        type: 'file',
        contentKind: 'text',
        size: new TextEncoder().encode(instructionFiles.text).byteLength,
      }),
      readFile: async () => new TextEncoder().encode(instructionFiles.text),
    },
    parameterFiles: { mkdir: async () => undefined },
    workbenchFiles: {
      writeFileChecked: async (input: { data: Uint8Array<ArrayBuffer> }) => {
        instructionFiles.text = new TextDecoder().decode(input.data);
        return { status: 'applied', content: input.data };
      },
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

const denseTasks = (): ProjectTask[] => [
  {
    ...tasks[0]!,
    title: 'Design a manufacturable mounting bracket with several mounting patterns and verify its clearances',
    attempts: [{ ...tasks[0]!.attempts[0]!, status: 'completed', placementId: 'placement-root' }],
  },
  { ...tasks[1]!, attempts: [{ ...tasks[1]!.attempts[0]!, status: 'running' }] },
  {
    ...tasks[2]!,
    title: 'Check the final dimensions and mounting clearances against every drawing',
    attempts: [
      {
        ...tasks[2]!.attempts[0]!,
        status: 'failed',
        detail: 'Dimension check could not read the supplied drawing. Open the transcript, then retry.',
      },
    ],
  },
];

it('shows the complete Agents pane with overview, task hierarchy and expanded details', async () => {
  await page.viewport(800, 720);
  panelView.snapshot = { tasks: denseTasks(), messages: [], cursor: 3, nextCursor: 3, hasMore: false };
  panelView.agents = [
    {
      chatId: 'chat-root',
      name: 'Bracket design',
      state: 'running',
      focused: true,
      lastActivityAt: 1,
      model: { id: 'codex', name: 'Codex', family: 'unknown', provider: 'OpenAI' },
      workspace: 'project',
      branch: undefined,
      pendingApprovalCount: 0,
      operationIds: [],
      unread: false,
    },
    {
      chatId: 'chat-child',
      name: 'Mounting hole check',
      state: 'waiting',
      focused: false,
      lastActivityAt: 2,
      model: { id: 'codex', name: 'Codex', family: 'unknown', provider: 'OpenAI' },
      workspace: 'project',
      branch: undefined,
      pendingApprovalCount: 1,
      operationIds: [],
      unread: true,
    },
    {
      chatId: 'chat-other',
      name: 'Material options',
      state: 'idle',
      focused: false,
      lastActivityAt: 3,
      model: { id: 'codex', name: 'Codex', family: 'unknown', provider: 'OpenAI' },
      workspace: 'project',
      branch: undefined,
      pendingApprovalCount: 0,
      operationIds: [],
      unread: false,
    },
  ];
  render(
    <MemoryRouter>
      <main aria-label='Complete Agents pane fixture' className='h-screen w-full bg-sidebar'>
        <AgentsPanelBody />
      </main>
    </MemoryRouter>,
  );
  const pane = screen.getByRole('main', { name: 'Complete Agents pane fixture' });
  expect(pane.getBoundingClientRect().width).toBe(800);
  expect(screen.getByLabelText('Agent overview').textContent).toContain('3tasks·1chat');
  expect(
    Number.parseFloat(
      getComputedStyle(screen.getByRole('button', { name: 'Task details for Check mounting holes' })).fontSize,
    ),
  ).toBeGreaterThanOrEqual(14);
  await page.screenshot({ element: pane, path: '../../../../../out/research/acp-projects/agents-ux/pane-desktop.png' });
  screen.getByRole('button', { name: 'Task details for Check mounting holes' }).click();
  await page.screenshot({
    element: pane,
    path: '../../../../../out/research/acp-projects/agents-ux/pane-desktop-expanded.png',
  });
  await page.viewport(320, 720);
  expect(pane.getBoundingClientRect().width).toBe(320);
  await page.screenshot({
    element: pane,
    path: '../../../../../out/research/acp-projects/agents-ux/pane-narrow-expanded.png',
  });
  screen.getByRole('region', { name: 'Chats' }).scrollIntoView();
  await page.screenshot({
    element: pane,
    path: '../../../../../out/research/acp-projects/agents-ux/pane-narrow-chats.png',
  });
  screen.getByRole('region', { name: 'Project tasks' }).scrollIntoView();
  document.documentElement.classList.add('dark');
  try {
    await page.screenshot({
      element: pane,
      path: '../../../../../out/research/acp-projects/agents-ux/pane-dark-expanded.png',
    });
  } finally {
    document.documentElement.classList.remove('dark');
    await page.viewport(800, 720);
  }
});

it('keeps a dense task lineage readable in narrow light and dark panes', async () => {
  await page.viewport(800, 720);
  const fixture = denseTasks();
  const approval: AgentProjection = {
    chatId: 'chat-child',
    name: 'Mounting hole check',
    state: 'waiting',
    focused: false,
    lastActivityAt: 2,
    model: { id: 'codex', name: 'Codex', family: 'unknown', provider: 'OpenAI' },
    workspace: 'project',
    branch: undefined,
    pendingApprovalCount: 1,
    operationIds: [],
    unread: true,
  };
  render(
    <MemoryRouter>
      <main aria-label='Agents pane fixture' className='w-full bg-sidebar p-2'>
        <ProjectTaskTree
          tasks={fixture}
          messages={[]}
          agents={[approval]}
          projectSlugs={{ workspaceSlug: 'home', projectSlug: 'bracket' }}
          actions={{
            send: vi.fn(async () => undefined),
            cancel: vi.fn(async () => undefined),
            resume: vi.fn(async () => undefined),
          }}
        />
      </main>
    </MemoryRouter>,
  );
  const pane = screen.getByRole('main', { name: 'Agents pane fixture' });
  await page.screenshot({
    element: pane,
    path: '../../../../../out/research/acp-projects/agents-ux/tasks-light-desktop.png',
  });
  await page.viewport(320, 720);
  const bounds = pane.getBoundingClientRect();
  expect(bounds.width).toBe(320);
  for (const link of screen.getAllByRole('link')) {
    expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
  }
  await page.screenshot({
    element: pane,
    path: '../../../../../out/research/acp-projects/agents-ux/tasks-light-narrow.png',
  });
  screen.getByRole('button', { name: 'Task details for Check mounting holes' }).click();
  await expect.element(page.getByRole('textbox', { name: 'Message Check mounting holes' })).toBeVisible();
  await page.screenshot({
    element: pane,
    path: '../../../../../out/research/acp-projects/agents-ux/tasks-light-expanded.png',
  });
  document.documentElement.classList.add('dark');
  try {
    await page.screenshot({
      element: pane,
      path: '../../../../../out/research/acp-projects/agents-ux/tasks-dark-expanded.png',
    });
  } finally {
    document.documentElement.classList.remove('dark');
    await page.viewport(800, 720);
  }
});

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

it('retries a cancelled closed child while withholding Retry from its closed descendant', async () => {
  const resume = vi.fn(async () => undefined);
  const child: ProjectTask = {
    ...tasks[1]!,
    closed: true,
    attempts: [{ ...tasks[1]!.attempts[0]!, status: 'cancelled' }],
  };
  const grandchild: ProjectTask = {
    ...tasks[2]!,
    closed: true,
    attempts: [{ ...tasks[2]!.attempts[0]!, status: 'cancelled' }],
  };
  render(
    <MemoryRouter>
      <ProjectTaskTree
        tasks={[tasks[0]!, child, grandchild]}
        messages={[]}
        agents={[]}
        actions={{ send: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined), resume }}
      />
    </MemoryRouter>,
  );

  await expect.element(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect
    .element(
      page.getByRole('list', { name: 'Child tasks of Check mounting holes' }).getByRole('button', { name: 'Retry' }),
    )
    .not.toBeInTheDocument();
  await page.getByRole('button', { name: 'Retry' }).click();
  expect(resume).toHaveBeenCalledWith('child');
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
