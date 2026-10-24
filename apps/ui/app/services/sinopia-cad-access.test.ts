import { mock } from 'vitest-mock-extended';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinopiaSessionState } from '#lib/sinopia-session.js';
import type { SinopiaCadRecordFiles } from '#services/sinopia-cad.js';
import { canReadSinopiaCadProject, sinopiaProjectListingKey } from '#services/sinopia-cad-access.js';
const fake = vi.hoisted(() => {
  let state: SinopiaSessionState = { status: 'disabled' };
  return {
    state: () => state,
    change: (next: SinopiaSessionState) => {
      state = next;
    },
  };
});
vi.mock('#lib/sinopia-session.js', () => ({ sinopiaSession: () => ({ getState: fake.state }) }));
vi.mock('#lib/sinopia-data-client.js', () => ({
  requireSinopiaUser: async (expected: string) => {
    const state = fake.state();
    if (state.status !== 'signed-in' || state.user.id !== expected) {
      throw new Error('ACCOUNT_CHANGED');
    }
  },
}));
const firstUser = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000002';
const signIn = (id: string): void => {
  fake.change({ status: 'signed-in', user: { id, email: undefined } });
};
const record = new TextEncoder().encode(
  JSON.stringify({
    userId: firstUser,
    modelId: '00000000-0000-4000-8000-000000000003',
    projectId: '00000000-0000-4000-8000-000000000004',
    baseRevisionId: null,
  }),
);
const files = () =>
  mock<SinopiaCadRecordFiles>({ exists: vi.fn(async () => true), readFile: vi.fn(async () => record) });
beforeEach(() => {
  signIn(firstUser);
});
describe('local Sinopia account boundary', () => {
  it('retains the owner’s bytes while refusing another account or a malformed record', async () => {
    const port = files();
    expect(await canReadSinopiaCadProject(port, 'local')).toBe(true);
    signIn(otherUser);
    expect(await canReadSinopiaCadProject(port, 'local')).toBe(false);
    signIn(firstUser);
    vi.mocked(port.readFile).mockResolvedValueOnce(new TextEncoder().encode('{broken'));
    expect(await canReadSinopiaCadProject(port, 'local')).toBe(false);
  });
  it('rejects a delayed A-to-B completion and never adopts B as the caller mid-read', async () => {
    const port = files();
    vi.mocked(port.readFile).mockImplementationOnce(async () => {
      signIn(otherUser);
      return record;
    });
    expect(await canReadSinopiaCadProject(port, 'local', firstUser)).toBe(false);
    expect(await canReadSinopiaCadProject(port, 'local', firstUser)).toBe(false);
  });
  it('separates account listing keys and requires admission', async () => {
    const firstKey = sinopiaProjectListingKey();
    signIn(otherUser);
    expect(sinopiaProjectListingKey()).not.toEqual(firstKey);
    fake.change({ status: 'checking' });
    expect(await canReadSinopiaCadProject(files(), 'local')).toBe(false);
  });
});
