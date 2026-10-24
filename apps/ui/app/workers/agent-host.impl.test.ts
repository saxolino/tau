import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine } from 'xstate';
import type { ParameterSetActor } from '@taucad/parameters/set-machine';
import { createGatewayModelTransport } from '@taucad/agent-host';
import type { ModelStreamRequest } from '@taucad/agent-host';
import { closeParameterActors, projectGatewayOptions } from '#workers/agent-host.impl.js';
import type { AgentHostProjectProvide } from '#workers/agent-host.contract.js';

/* W6.r2 M1 (D15): a parameter actor's close is bounded; one past the bound or left uncertain is stopped, and a
 * retried close passes a stopped actor instead of waiting the bound again. */
describe('closeParameterActors', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /* An actor whose write never settles, and one whose write settles uncertain once closed. */
  const stuck = createMachine({ initial: 'open', states: { open: { initial: 'writing', states: { writing: {} } } } });
  // The write is uncertain before the close arrives, so the close finds it there.
  const uncertain = createMachine({
    initial: 'open',
    states: { open: { initial: 'uncertain', states: { uncertain: {} } } },
  });
  const parameterActor = (onClose?: 'uncertain'): ParameterSetActor =>
    (onClose === 'uncertain' ? createActor(uncertain) : createActor(stuck)).start() as unknown as ParameterSetActor;

  it('should stop an actor whose write outlives the bound, and pass it when the close is retried', async () => {
    vi.useFakeTimers();
    const actor = parameterActor();
    let failures: unknown[] | undefined;
    const closing = (async () => {
      failures = await closeParameterActors(new Map([['main.ts', actor]]));
    })();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(failures).toHaveLength(1);
    expect(actor.getSnapshot().status).toBe('stopped');
    await closing;
    await expect(closeParameterActors(new Map([['main.ts', actor]]))).resolves.toEqual([]);
  });

  it('should stop an actor whose write stays uncertain, and report it', async () => {
    const actor = parameterActor('uncertain');

    const failures = await closeParameterActors(new Map([['main.ts', actor]]));

    expect(failures).toEqual([new Error('Parameter write for main.ts remains uncertain.')]);
    expect(actor.getSnapshot().status).toBe('stopped');
  });
});

/* SinopiaCAD: every model call carries the Sinopia session's token current at that call, so an hourly refresh reaches a
 * run already in flight. */
describe('projectGatewayOptions', () => {
  const ports = [new MessageChannel(), new MessageChannel(), new MessageChannel()];
  afterAll(() => {
    for (const { port1, port2 } of ports) {
      port1.close();
      port2.close();
    }
  });

  const provide: AgentHostProjectProvide = {
    projectId: 'project-one',
    hostId: 'host-one',
    fileSystemPort: ports[0]!.port1,
    projectRootPort: ports[1]!.port1,
    placementPort: ports[2]!.port1,
    projectStorage: { projectId: 'project-one', backend: 'opfs', providerBasePath: 'project-one' },
    authority: { projectId: 'project-one', workspaceId: 'workspace-one' },
    gatewayBaseUrl: 'https://sinopia.test/functions/v1/sinopiacad',
    systemPrompt: 'Build CAD.',
    systemPromptBlocks: [
      { type: 'text', text: 'static' },
      { type: 'text', text: 'dynamic' },
    ],
    runtimeConfig: { tauApiUrl: 'https://sinopia.test', tauWebSocketUrl: 'wss://sinopia.test' },
  };

  const request = (attemptId: string): ModelStreamRequest => ({
    attemptId,
    invocationPurpose: 'generation',
    modelId: 'gpt-6-astra',
    providerKind: 'openai',
    maxTokens: 1024,
    contextWindow: 200_000,
    systemPrompt: 'Build CAD.',
    messages: [{ id: 'user-1', role: 'user', content: 'Un anello.' }],
    tools: [],
    signal: new AbortController().signal,
  });

  /** Run one model call to its end; the scripted gateway refuses it, which is all this test needs. */
  const call = async (stream: AsyncIterable<unknown>): Promise<void> => {
    try {
      for await (const _event of stream) {
        /* Drain. */
      }
    } catch {
      /* The scripted 401. */
    }
  };

  it('should send the token current at each call as the bearer, and none once signed out', async () => {
    let token: string | undefined = 'token-one';
    const sent: Array<{ readonly url: string; readonly authorization: string | undefined }> = [];
    const transport = createGatewayModelTransport({
      ...projectGatewayOptions(provide, { accessToken: () => token }),
      fetch: async (input, init) => {
        sent.push({
          url: input instanceof Request ? input.url : input.toString(),
          authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        });
        return Response.json({ error: { type: 'UNAUTHENTICATED', message: 'Accedi a Sinopia.' } }, { status: 401 });
      },
    });

    await call(transport.stream(request('attempt-1')));
    token = 'token-refreshed';
    await call(transport.stream(request('attempt-2')));
    token = undefined;
    await call(transport.stream(request('attempt-3')));

    expect(sent.map((entry) => entry.authorization)).toEqual(['Bearer token-one', 'Bearer token-refreshed', undefined]);
    expect(sent[0]?.url).toBe('https://sinopia.test/functions/v1/sinopiacad/v1/llm/openai/v1/responses');
  });
});
