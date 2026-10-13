import { createMemoryProvider } from '@taucad/filesystem/backend';
import { expect, it } from 'vitest';
import { createChatEffects } from '#chat-effects.js';
import { createIsomorphicGitRevisionPort } from '#isomorphic-git-adapter.js';

it('records ordinary chats while protected project task records never become chat refs', async () => {
  const storage = await createMemoryProvider();
  const records = await createMemoryProvider();
  const port = createIsomorphicGitRevisionPort({ filesystem: storage });
  await records.writeFile('.tau/chats/ordinary/chat.json', JSON.stringify({ id: 'ordinary', name: 'Ordinary' }));
  await records.writeFile('.tau/chats/ordinary/events.jsonl', '{"event":"ordinary"}\n');
  await records.writeFile('.tau/chats/.project-tasks/records.jsonl', '{"protected":"task"}\n');
  const effects = createChatEffects({
    port,
    recordsFileSystem: async () => records,
    deviceId: () => 'host-device',
    recordDevices: { deviceFor: async () => 'record-device', ownDevices: async () => [] },
    actor: undefined,
    onChatsProjected: undefined,
    actorId: 'host-actor',
    now: () => 0,
  });
  const outcomes = await effects.recordChats(true, 'tau');
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0]?.name).toBe('refs/tau/chats/ordinary');
  expect(outcomes[0]?.status).toBe('upToDate');
  expect(await port.readRef('refs/tau/chats/ordinary')).toBeDefined();
  expect(await port.readRef('refs/tau/chats/.project-tasks')).toBeUndefined();
  expect(new TextDecoder().decode(await records.readFile('.tau/chats/.project-tasks/records.jsonl'))).toBe(
    '{"protected":"task"}\n',
  );
});
