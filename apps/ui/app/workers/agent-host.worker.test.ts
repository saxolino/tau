// @vitest-environment node
/**
 * SinopiaCAD: the resident worker keeps the Sinopia session's latest access token, which every project host's gateway
 * reads on each request (`auth` in `agent-host.impl.ts`). The page drives the real worker module over the real control
 * channel; only the project-host composition is replaced, to capture what the worker hands it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@taucad/agent-host';
import { connectAgentWorkerChannel } from '@taucad/agent-host/channel-client';
import type { AgentHostProjectProvide, AgentHostWorkerProtocol } from '#workers/agent-host.contract.js';
import { agentHostWorkerProtocolSchemas, parseAgentHostWorkerConnect } from '#workers/agent-host.contract.js';
import type { BrowserProjectHost, ResidentWorkerContext } from '#workers/agent-host.impl.js';

const composed = vi.hoisted(() => ({
  hosts: [] as Array<{ readonly provide: AgentHostProjectProvide; readonly worker: ResidentWorkerContext }>,
}));
vi.mock('#workers/agent-host.impl.js', () => ({
  openBrowserProjectHost: async (
    provide: AgentHostProjectProvide,
    worker: ResidentWorkerContext,
  ): Promise<BrowserProjectHost> => {
    composed.hosts.push({ provide, worker });
    return {
      hostId: provide.hostId,
      needsRebridge: () => false,
      stoppability: () => 'background-window',
      connect: (port) => {
        port.close();
      },
      rebridge: async () => undefined,
      drain: async () => undefined,
      close: async () => undefined,
    };
  },
}));

let channel: Channel<AgentHostWorkerProtocol>;
const opened: MessagePort[] = [];

const provide = async (hostId: string, accessToken?: string): Promise<void> => {
  const ports = [new MessageChannel(), new MessageChannel(), new MessageChannel()].map(({ port1, port2 }) => {
    opened.push(port2);
    return port1;
  });
  const [fileSystemPort, projectRootPort, placementPort] = ports as [MessagePort, MessagePort, MessagePort];
  await channel.call('provide', {
    value: {
      projectId: 'project-one',
      hostId,
      fileSystemPort,
      projectRootPort,
      placementPort,
      projectStorage: { projectId: 'project-one', backend: 'opfs', providerBasePath: 'project-one' },
      authority: { projectId: 'project-one', workspaceId: 'workspace-one' },
      gatewayBaseUrl: 'https://sinopia.test/functions/v1/sinopiacad',
      systemPrompt: 'Build CAD.',
      systemPromptBlocks: [
        { type: 'text', text: 'static' },
        { type: 'text', text: 'dynamic' },
      ],
      runtimeConfig: { tauApiUrl: 'https://sinopia.test', tauWebSocketUrl: 'wss://sinopia.test' },
      ...(accessToken === undefined ? {} : { accessToken }),
    },
    transferables: ports,
  });
};

/** The token the gateway of the most recently opened host would send now. */
const gatewayToken = (): string | undefined => composed.hosts.at(-1)?.worker.accessToken?.();

beforeAll(async () => {
  const listeners = new Map<string, (event: { data: unknown }) => void>();
  vi.stubGlobal('addEventListener', (type: string, listener: (event: { data: unknown }) => void) => {
    listeners.set(type, listener);
  });
  await import('#workers/agent-host.worker.js');
  const { port1, port2 } = new MessageChannel();
  listeners.get('message')?.({
    data: parseAgentHostWorkerConnect({ type: 'agent-host/connect', sessionId: 'session-one', port: port1 }),
  });
  channel = connectAgentWorkerChannel<AgentHostWorkerProtocol>(port2, {
    sessionKey: 'session-one',
    protocolSchemas: agentHostWorkerProtocolSchemas,
  });
  await channel.call('init', { tabId: 'tab-one' });
});

afterAll(() => {
  channel.close();
  for (const port of opened) {
    port.close();
  }
  vi.unstubAllGlobals();
});

describe('agent host worker: Sinopia access token', () => {
  it("should give a project host's gateway the token its provide carried, kept off the host's own provide", async () => {
    await provide('host-one', 'token-one');

    expect(gatewayToken()).toBe('token-one');
    expect(composed.hosts.at(-1)?.provide).not.toHaveProperty('accessToken');
  });

  it('should hand an open host the refreshed token, then none after a sign-out', async () => {
    const host = composed.hosts.at(-1);

    await channel.call('accessToken', { token: 'token-refreshed' });
    expect(host?.worker.accessToken?.()).toBe('token-refreshed');

    await channel.call('accessToken', {});
    expect(host?.worker.accessToken?.()).toBeUndefined();
  });

  it('should take the token of a later provide, for every host of the worker', async () => {
    const first = composed.hosts.at(-1);

    await provide('host-two', 'token-two');

    expect(gatewayToken()).toBe('token-two');
    expect(first?.worker.accessToken?.()).toBe('token-two');
  });

  it('should refuse a token that is not a non-empty string', async () => {
    await expect(channel.call('accessToken', { token: '' })).rejects.toThrow();
    expect(gatewayToken()).toBe('token-two');
  });
});
