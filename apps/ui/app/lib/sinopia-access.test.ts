// @vitest-environment jsdom
/**
 * The entry criteria, read through the real supabase-js client from a scripted Sinopia project: every branch of
 * Sinopia's own gates (`MfaChallengeGate`, `fetchUserProfile`, `BetaGate`, `ProtectedRoute`, `TermsGate`), and how a
 * failed read is answered.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSinopiaAccess, sinopiaRefusalNotice } from '#lib/sinopia-access.js';
import type { SinopiaAccess } from '#lib/sinopia-access.js';
import { createSinopiaSupabaseClient } from '#lib/sinopia-session.js';
import {
  scriptSinopiaBackend,
  sinopiaTestConfig,
  sinopiaTestFactor,
  sinopiaTestStorageKey,
  sinopiaTestUser,
  sinopiaTokenResponse,
} from '#lib/testing/sinopia-backend.js';
import type { SinopiaTestAccount } from '#lib/testing/sinopia-backend.js';

const clients: SupabaseClient[] = [];

/** A client signed in as the test account, with the given token extras. */
const signedInClient = async (extra?: Parameters<typeof sinopiaTokenResponse>[2]): Promise<SupabaseClient> => {
  localStorage.setItem(sinopiaTestStorageKey, JSON.stringify(sinopiaTokenResponse('stored', 3600, extra)));
  const client = await createSinopiaSupabaseClient(sinopiaTestConfig, sinopiaTestStorageKey);
  clients.push(client);
  return client;
};

const check = async (account: SinopiaTestAccount): Promise<SinopiaAccess> => {
  scriptSinopiaBackend({}, account);
  return checkSinopiaAccess(await signedInClient(), sinopiaTestUser.id);
};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.auth.stopAutoRefresh()));
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('checkSinopiaAccess', () => {
  describe('the reserved preview: administrators only', () => {
    it.each<{ name: string; account: SinopiaTestAccount }>([
      { name: 'a superadmin', account: { role: 'superadmin', beta: 'not_applicable' } },
      { name: 'a superadmin whose beta status is anything', account: { role: 'superadmin', beta: 'needs_profile' } },
      { name: 'a superadmin that accepted later Terms', account: { role: 'superadmin', terms: '2026-11-02' } },
    ])('should let in $name', async ({ account }) => {
      await expect(check(account)).resolves.toEqual({ verdict: 'allowed' });
    });

    it.each<{ name: string; account: SinopiaTestAccount }>([
      { name: 'a complete designer in the beta', account: { role: 'designer' } },
      { name: 'a supplier', account: { role: 'supplier', beta: 'needs_profile' } },
      { name: 'a supervisor', account: { role: 'supervisor' } },
      { name: 'a legacy designer role', account: { role: 'pro' } },
      { name: 'no profile row', account: { withoutProfile: true } },
      { name: 'a role that is not an account role', account: { role: 'lookbook_guest' } },
    ])('should answer reserved for $name', async ({ account }) => {
      await expect(check(account)).resolves.toEqual({ verdict: 'reserved' });
    });
  });

  describe('administrators sinopialab.com keeps out', () => {
    it.each<{ name: string; account: SinopiaTestAccount; reason: string }>([
      {
        name: 'a profession still to choose outside the beta',
        account: { role: 'superadmin', needsProfession: true, beta: 'not_applicable' },
        reason: 'profession',
      },
      { name: 'Terms never accepted', account: { role: 'superadmin', withoutTerms: true }, reason: 'terms' },
      {
        name: 'Terms older than the current ones',
        account: { role: 'superadmin', terms: '2026-07-01' },
        reason: 'terms',
      },
    ])('should keep out $name', async ({ account, reason }) => {
      await expect(check(account)).resolves.toEqual({ verdict: 'refused', reason });
    });
  });

  describe('reads that fail', () => {
    it.each<{ name: string; account: SinopiaTestAccount }>([
      { name: 'the profile', account: { role: 'superadmin', failing: ['profile'] } },
      { name: 'the profession step', account: { role: 'superadmin', failing: ['profession'] } },
      { name: 'the Terms consent', account: { role: 'superadmin', failing: ['terms'] } },
    ])('should answer unverified, never allowed or reserved, when $name cannot be read', async ({ account }) => {
      await expect(check(account)).resolves.toEqual({ verdict: 'unverified' });
      expect(console.error).toHaveBeenCalledWith(
        expect.stringMatching(/^\[sinopia] could not read /),
        expect.anything(),
      );
    });
  });

  describe('second factor', () => {
    it('should ask for the second factor of an account that has one, before reading anything', async () => {
      const { calls } = scriptSinopiaBackend();

      await expect(
        checkSinopiaAccess(await signedInClient({ factors: [sinopiaTestFactor], aal: 'aal1' }), sinopiaTestUser.id),
      ).resolves.toEqual({ verdict: 'second-factor' });
      expect(calls).toEqual([]);
    });

    it('should go on once this session has confirmed it', async () => {
      scriptSinopiaBackend({}, { role: 'superadmin' });

      await expect(
        checkSinopiaAccess(await signedInClient({ factors: [sinopiaTestFactor], aal: 'aal2' }), sinopiaTestUser.id),
      ).resolves.toEqual({ verdict: 'allowed' });
    });
  });
});

describe('sinopiaRefusalNotice', () => {
  it('should send every refusal to sign in on sinopialab.com, where Sinopia takes the account to its next step', () => {
    expect(sinopiaRefusalNotice('profession')).toEqual({
      code: 'profession',
      link: { href: 'https://sinopialab.com/auth' },
    });
  });
});
