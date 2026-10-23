// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinopiaSessionState } from '#lib/sinopia-session.js';
import { getSinopiaDataClient, requireSinopiaUser } from '#lib/sinopia-data-client.js';
const fake = vi.hoisted(() => {
  let state: SinopiaSessionState = { status: 'signed-in', user: { id: 'one', email: undefined } };
  return {
    state: () => state,
    change: (next: SinopiaSessionState) => {
      state = next;
    },
    access: vi.fn<() => Promise<string | undefined>>(async () => 'first'),
  };
});
vi.mock('#lib/sinopia-session.js', () => ({
  sinopiaSession: () => ({ getState: fake.state, accessToken: fake.access }),
  readSinopiaConfig: () => ({ url: 'https://sinopia.example.test', publishableKey: 'public-key' }),
}));
beforeEach(() => {
  fake.change({ status: 'signed-in', user: { id: 'one', email: undefined } });
  fake.access.mockReset();
  fake.access.mockResolvedValue('first');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('admitted Sinopia data transport', () => {
  it('never exposes data access for an unadmitted session', async () => {
    fake.change({ status: 'unverified', user: { id: 'one', email: undefined } });
    await expect(getSinopiaDataClient()).rejects.toThrow('SINOPIA_SESSION_REQUIRED');
    expect(fake.access).not.toHaveBeenCalled();
  });
  it('refuses an account that changes while the token is refreshing', async () => {
    fake.access.mockImplementationOnce(async () => {
      fake.change({ status: 'signed-in', user: { id: 'two', email: undefined } });
      return 'other';
    });
    await expect(requireSinopiaUser('one')).rejects.toThrow('SINOPIA_SESSION_CHANGED');
  });
  it('reads a refreshed JWT for each request rather than storing a second session', async () => {
    const { client, userId } = await getSinopiaDataClient();
    expect(userId).toBe('one');
    await client.from('cad_models').select('id');
    fake.access.mockResolvedValue('refreshed');
    await client.from('cad_models').select('id');
    const { calls } = vi.mocked(fetch).mock;
    expect(new Headers(calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer first');
    expect(new Headers(calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer refreshed');
  });
  it('fences an already-created client after switching accounts before another request', async () => {
    const { client } = await getSinopiaDataClient();
    fake.change({ status: 'signed-in', user: { id: 'two', email: undefined } });
    const result = await client.from('cad_models').select('id').retry(false);
    expect(result.error).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
