import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import { browserProjectTasks } from '#browser/project-tasks.js';
import { createProjectOwnedBrowserChatStore } from '#browser/project-chat-store.js';
import { memoryFileSystem } from '#browser/leadership.fixture.js';
import type { AgentChannelSource } from '#launchers/agent-channel.js';
import { chatStoreBinding } from '#launchers/chat-store.js';
import type { ProjectTaskOwner, ProjectTaskOwnerInput } from '#launchers/project-task-platform.js';

const encoder = new TextEncoder();
const journalPath = '.tau/chats/.project-tasks/records.jsonl';
const owners: ProjectTaskOwner[] = [];
const channels: BroadcastChannel[] = [];

const until = async (condition: () => boolean, timeout = 6000): Promise<void> => {
  const deadline = performance.now() + timeout;
  while (!condition()) {
    if (performance.now() >= deadline) {
      throw new Error('Project task condition did not become true.');
    }
    // oxlint-disable-next-line no-await-in-loop -- bounded polling observes an asynchronous channel or retry.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
};

afterEach(async () => {
  vi.useRealTimers();
  for (const channel of channels.splice(0)) {
    channel.close();
  }
  for (const owner of owners.splice(0)) {
    // oxlint-disable-next-line no-await-in-loop -- close followers before the leader can release its lock.
    await owner.close();
  }
});

const createOwner = (
  request: ProjectTaskOwner['projectTasks']['request'] = async () => ({
    kind: 'refused',
    code: 'TASK_UNAVAILABLE',
    message: 'fixture',
  }),
) => {
  const requestMock = vi.fn(request);
  const source = mockDeep<AgentChannelSource>();
  source.execute.mockResolvedValue({
    commandId: 'attach-1',
    generation: 1,
    status: 'applied',
    effect: 'not-applied',
    details: {},
  });
  const create = vi.fn(async ({ storage }: ProjectTaskOwnerInput): Promise<ProjectTaskOwner> => {
    const bytes = new TextDecoder().decode(await storage.read()).trim();
    const previous = bytes === '' ? 0 : (JSON.parse(bytes.split('\n').at(-1)!) as { sequence: number }).sequence;
    await storage.append(
      encoder.encode(`${JSON.stringify({ version: 1, projectId: 'project-1', sequence: previous + 1, tasks: [] })}\n`),
    );
    const owner: ProjectTaskOwner = {
      source,
      projectTasks: { request: requestMock },
      stoppability: () => 'stoppable',
      drain: async () => undefined,
      close: async () => storage.close(),
    };
    return owner;
  });
  return { create, source, request: requestMock };
};

describe('browserProjectTasks', () => {
  it('should preserve a native writer marker while taking a project chat lock', async () => {
    const fileSystem = memoryFileSystem();
    const marker = '.tau/chats/chat-1/events.jsonl.lock';
    await fileSystem.writeFile(marker, '1234\n/native/project/.tau/chats/chat-1/events.jsonl\n');
    const chats = createProjectOwnedBrowserChatStore(
      'project-1',
      {
        projectId: 'project-1',
        tabId: 'browser',
        build: 'build-1',
        log: { kind: 'provider', fileSystem },
      },
      () => true,
    );
    await expect(chatStoreBinding(chats).openWriter('chat-1')).rejects.toMatchObject({ code: 'WRITER_LOCKED' });
    expect(new TextDecoder().decode(fileSystem.files.get(marker))).toContain('/native/project/');
    await fileSystem.writeFile(marker, `${Date.now()}\n`);
    const writer = await chatStoreBinding(chats).openWriter('chat-1');
    await writer.close();
  });

  it('should publish one owner only after its durable term claim and forward the task channel to it', async () => {
    const fileSystem = memoryFileSystem();
    const gate = Promise.withResolvers<void>();
    const first = createOwner();
    const leader = browserProjectTasks({ tabId: 'leader', build: 'build-1', log: { kind: 'provider', fileSystem } });
    const opening = leader.open({
      projectId: 'project-1',
      createOwner: async (input) => {
        await gate.promise;
        return first.create(input);
      },
    });
    const follower = browserProjectTasks({
      tabId: 'follower',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    });
    const attached = await follower.open({
      projectId: 'project-1',
      createOwner: async () => expect.fail('follower claimed'),
    });
    owners.push(attached);
    const requested = attached.projectTasks.request({ operation: 'read', input: { after: 0, limit: 1 } });
    expect(fileSystem.files.has(journalPath)).toBe(false);
    expect(first.request).not.toHaveBeenCalled();

    gate.resolve();
    const opened = await opening;
    owners.push(opened);
    await expect(requested).resolves.toEqual({ kind: 'refused', code: 'TASK_UNAVAILABLE', message: 'fixture' });
    expect(first.create).toHaveBeenCalledOnce();
    expect(first.request).toHaveBeenCalledOnce();
    const rows = new TextDecoder().decode(fileSystem.files.get(journalPath)).trim().split('\n');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!)).toEqual({ version: 1, projectId: 'project-1', sequence: 1, tasks: [] });
  });

  it('should keep a healthy forwarded projection pending beyond ten seconds', async () => {
    const fileSystem = memoryFileSystem();
    const first = createOwner();
    const leader = await browserProjectTasks({
      tabId: 'leader-long',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    }).open({ projectId: 'project-1', createOwner: first.create });
    owners.push(leader);
    const follower = await browserProjectTasks({
      tabId: 'follower-long',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    }).open({ projectId: 'project-1', createOwner: async () => expect.fail('follower claimed') });
    owners.unshift(follower);
    first.source.host.waitForAdmission.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 11_500);
      });
      return undefined;
    });
    const result = follower.source.host.waitForAdmission('chat-1');
    const observed = vi.fn();
    const observation = (async (): Promise<void> => {
      await result;
      observed();
    })();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10_500);
    });
    expect(observed).not.toHaveBeenCalled();
    await observation;
    await expect(result).resolves.toBeUndefined();
    expect(first.source.host.waitForAdmission).toHaveBeenCalledWith('chat-1', undefined);
  }, 20_000);

  it('should cancel an aborted follower request at the owner without appending a task row', async () => {
    const fileSystem = memoryFileSystem();
    const started = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const request = vi.fn(
      async (_input: Parameters<ProjectTaskOwner['projectTasks']['request']>[0], signal?: AbortSignal) => {
        await new Promise<never>((_resolve, reject) => {
          started.resolve();
          signal?.addEventListener(
            'abort',
            () => {
              cancelled.resolve();
              reject(new DOMException('cancelled', 'AbortError'));
            },
            { once: true },
          );
        });
        return { kind: 'refused', code: 'TASK_UNAVAILABLE', message: 'fixture' } as const;
      },
    );
    const first = createOwner(request);
    const leader = await browserProjectTasks({
      tabId: 'leader-cancel',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    }).open({ projectId: 'project-1', createOwner: first.create });
    owners.push(leader);
    const follower = await browserProjectTasks({
      tabId: 'follower-cancel',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    }).open({ projectId: 'project-1', createOwner: async () => expect.fail('follower claimed') });
    owners.unshift(follower);
    const abort = new AbortController();
    const answer = follower.projectTasks.request({ operation: 'read', input: { after: 0, limit: 1 } }, abort.signal);
    await started.promise;
    abort.abort();
    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
    await cancelled.promise;
    expect(request).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(fileSystem.files.get(journalPath)).trim().split('\n')).toHaveLength(1);
  });

  it('should retain the project lock after a failed close and allow a new owner only after retry', async () => {
    const fileSystem = memoryFileSystem();
    const first = createOwner();
    let closeAttempts = 0;
    const leader = await browserProjectTasks({
      tabId: 'leader-close',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    }).open({
      projectId: 'project-1',
      createOwner: async (input) => {
        const actual = await first.create(input);
        return {
          ...actual,
          close: async () => {
            closeAttempts += 1;
            if (closeAttempts === 1) {
              throw new Error('close failed before storage release');
            }
            await actual.close();
          },
        };
      },
    });
    owners.push(leader);
    const second = createOwner();
    const follower = await browserProjectTasks({
      tabId: 'follower-close',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    }).open({ projectId: 'project-1', createOwner: second.create });
    owners.unshift(follower);
    await expect(leader.close()).rejects.toThrow('close failed before storage release');
    expect(second.create).not.toHaveBeenCalled();
    await leader.close();
    await until(() => second.create.mock.calls.length === 1);
    const rows = new TextDecoder()
      .decode(fileSystem.files.get(journalPath))
      .trim()
      .split('\n')
      .map((row) => JSON.parse(row) as { sequence: number });
    expect(rows.map((row) => row.sequence)).toEqual([1, 2]);
  }, 10_000);

  it('should refuse an incompatible build and ignore stale-term requests and replies', async () => {
    const fileSystem = memoryFileSystem();
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<{ kind: 'refused'; code: 'TASK_UNAVAILABLE'; message: string }>();
    const request = vi.fn(async () => {
      started.resolve();
      return finish.promise;
    });
    const first = createOwner(request);
    const leader = await browserProjectTasks({
      tabId: 'leader-stale',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    }).open({ projectId: 'project-1', createOwner: first.create });
    owners.push(leader);
    const wrongBuild = await browserProjectTasks({
      tabId: 'wrong-build',
      build: 'build-2',
      log: { kind: 'provider', fileSystem },
    }).open({ projectId: 'project-1', createOwner: async () => expect.fail('wrong build claimed') });
    owners.unshift(wrongBuild);
    await expect(
      wrongBuild.projectTasks.request({ operation: 'read', input: { after: 0, limit: 1 } }),
    ).rejects.toMatchObject({ code: 'LEADER_VERSION_MISMATCH' });

    const follower = await browserProjectTasks({
      tabId: 'follower-stale',
      build: 'build-1',
      log: { kind: 'provider', fileSystem },
    }).open({ projectId: 'project-1', createOwner: async () => expect.fail('follower claimed') });
    owners.unshift(follower);
    const attacker = new BroadcastChannel('agent-host-project:project-1');
    channels.push(attacker);
    attacker.postMessage({
      projectId: 'project-1',
      sender: 'old-owner',
      build: 'build-1',
      term: 0,
      kind: 'call',
      id: 'old:1',
      to: 'leader-stale',
      operation: 'projectTasks',
      input: { operation: 'read', input: { after: 0, limit: 1 } },
    });
    const answer = follower.projectTasks.request({ operation: 'read', input: { after: 0, limit: 1 } });
    await started.promise;
    let settled = false;
    const observation = (async (): Promise<void> => {
      await answer;
      settled = true;
    })();
    attacker.postMessage({
      projectId: 'project-1',
      sender: 'leader-stale',
      build: 'build-1',
      term: 0,
      kind: 'reply',
      id: 'follower-stale:1',
      to: 'follower-stale',
      value: { kind: 'refused', code: 'TASK_UNAVAILABLE', message: 'stale' },
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(settled).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    finish.resolve({ kind: 'refused', code: 'TASK_UNAVAILABLE', message: 'real' });
    await observation;
    await expect(answer).resolves.toMatchObject({ message: 'real' });
  });
});
