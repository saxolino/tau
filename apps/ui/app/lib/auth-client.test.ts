import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnvironment = globalThis.window.ENV;

describe('authClient runtime environment', () => {
  afterEach(() => {
    globalThis.window.ENV = originalEnvironment;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('imports with an empty injection and rejects the first request without fetching loopback', async () => {
    globalThis.window.ENV = {};
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ user: null, session: null }));

    const { authClient } = await import('#lib/auth-client.js');

    await expect(authClient.getSession()).rejects.toThrow(
      'Missing TAU_API_URL: the host must inject it through window.ENV before app-module evaluation.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the injected API URL when the first request starts', async () => {
    globalThis.window.ENV = {};
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ user: null, session: null }));
    const { authClient } = await import('#lib/auth-client.js');

    globalThis.window.ENV = {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- browser environment keys are uppercase by contract.
      TAU_API_URL: 'https://api.host.test',
    };
    await authClient.getSession();

    expect(fetch).toHaveBeenCalledWith('https://api.host.test/v1/auth/get-session', expect.any(Object));
  });

  /* SinopiaCAD: Sinopia's session signs people in; Better Auth stays wired but sends nothing to Sinopia's function. */
  it('stays inert, as against an unreachable API, while a Sinopia project is configured', async () => {
    /* eslint-disable @typescript-eslint/naming-convention -- browser environment keys are uppercase by contract. */
    globalThis.window.ENV = {
      TAU_API_URL: 'https://sinopia.test/functions/v1/sinopiacad',
      SINOPIA_SUPABASE_URL: 'https://sinopia.supabase.test',
      SINOPIA_SUPABASE_PUBLISHABLE_KEY: 'sinopia-publishable-key',
    };
    /* eslint-enable @typescript-eslint/naming-convention -- End environment keys. */
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ user: null, session: null }));
    const { authClient } = await import('#lib/auth-client.js');

    await expect(authClient.getSession()).rejects.toThrow(
      'SinopiaCAD signs in with Sinopia, not with a SinopiaCAD account.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
