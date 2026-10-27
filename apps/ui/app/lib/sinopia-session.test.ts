// @vitest-environment jsdom
/**
 * SinopiaCAD's Sinopia session over the real supabase-js client. The network is a scripted `fetch` standing in for
 * Sinopia's Supabase project (`#lib/testing/sinopia-backend.js`), so sign-in, the Google round trip, the access check,
 * refresh and sign-out run their real code paths and nothing leaves the test.
 */
import { AuthError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSinopiaSession,
  createSinopiaSupabaseClient,
  sinopiaGoogleErrorCode,
  sinopiaSignInErrorCode,
  sinopiaStorageKey,
} from '#lib/sinopia-session.js';
import type { SinopiaMessageCode } from '#lib/sinopia-access.js';
import type { SinopiaSession } from '#lib/sinopia-session.js';
import { rememberSinopiaReturn } from '#lib/sinopia-oauth-return.js';
import {
  scriptSinopiaBackend,
  sinopiaTestConfig as config,
  sinopiaTestFactor,
  sinopiaTestStorageKey as sinopiaKey,
  sinopiaTokenResponse as tokenResponse,
} from '#lib/testing/sinopia-backend.js';
import type { SinopiaTestAccount, SinopiaTestCall } from '#lib/testing/sinopia-backend.js';

const signedInState = {
  status: 'signed-in',
  user: { id: 'user-sinopia', email: 'pilota@sinopialab.com' },
};

/** Auth's calls only, as `path` and `grant`. */
const authCalls = (calls: readonly SinopiaTestCall[]) =>
  calls.filter((call) => call.path.startsWith('/auth/')).map(({ path, grant }) => ({ path, grant }));
/** The database's reads, as paths. */
const databaseReads = (calls: readonly SinopiaTestCall[]) =>
  calls.filter((call) => call.path.startsWith('/rest/')).map((call) => call.path);

const opened: SinopiaSession[] = [];
const open = (createClient = createSinopiaSupabaseClient): SinopiaSession => {
  const session = createSinopiaSession(config, createClient);
  opened.push(session);
  return session;
};

/** Open a session whose client's `signInWithOAuth` is a spy, so the browser stays on the page. */
const openWithGoogleSpy = () => {
  const openGoogle = vi.fn<SupabaseClient['auth']['signInWithOAuth']>();
  const session = open(async (...parameters) => {
    const client = await createSinopiaSupabaseClient(...parameters);
    vi.spyOn(client.auth, 'signInWithOAuth').mockImplementation(openGoogle);
    return client;
  });
  return { session, openGoogle };
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  /* Each test opens its own client on the same key, which supabase-js warns about; one document has one. */
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (session) => session.dispose()));
  localStorage.clear();
  sessionStorage.clear();
  globalThis.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('sinopiaStorageKey', () => {
  it("should name the key supabase-js gives Sinopia's project by default", () => {
    expect(sinopiaStorageKey(config.url)).toBe(sinopiaKey);
  });
});

describe('createSinopiaSession', () => {
  it('should pick up the session Sinopia stored under its own key and admit a complete account', async () => {
    const { calls } = scriptSinopiaBackend();
    const stored = tokenResponse('stored');
    localStorage.setItem(sinopiaKey, JSON.stringify(stored));
    const session = open();
    expect(session.getState()).toEqual({ status: 'checking' });

    const unsubscribe = session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toEqual(signedInState);
    });
    await expect(session.accessToken()).resolves.toBe(stored.access_token);
    expect(authCalls(calls)).toEqual([]);
    expect(databaseReads(calls).toSorted()).toEqual([
      '/rest/v1/profiles',
      '/rest/v1/rpc/needs_profession_selection',
      '/rest/v1/user_consents',
    ]);
    unsubscribe();
  });

  it('should read as signed out when nothing is stored', async () => {
    scriptSinopiaBackend();
    const session = open();

    session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toEqual({ status: 'signed-out' });
    });
    await expect(session.accessToken()).resolves.toBeUndefined();
  });

  it('should sign in with a password into the shared key and hand out the token only once admitted', async () => {
    const signedIn = tokenResponse('signed-in');
    const { calls } = scriptSinopiaBackend({ password: signedIn });
    const session = open();
    const tokens: Array<string | undefined> = [];
    const states: string[] = [];
    session.subscribe(() => {
      states.push(session.getState().status);
    });
    session.onAccessToken((token) => {
      tokens.push(token);
    });
    await vi.waitFor(() => {
      expect(session.getState()).toEqual({ status: 'signed-out' });
    });

    await expect(session.signIn('pilota@sinopialab.com', 'segreta')).resolves.toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(tokens).toEqual([signedIn.access_token]);
    });
    expect(session.getState()).toEqual(signedInState);
    expect(states).toEqual(['signed-out', 'checking', 'signed-in']);
    expect(JSON.parse(localStorage.getItem(sinopiaKey) ?? '{}')).toMatchObject({
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase Auth's stored session is snake_case.
      access_token: signedIn.access_token,
    });
    expect(authCalls(calls)).toEqual([{ path: '/auth/v1/token', grant: 'password' }]);
  });

  it('should answer a refused sign-in with a message code and stay signed out', async () => {
    scriptSinopiaBackend({
      password: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
      },
      passwordStatus: 400,
    });
    const session = open();
    session.subscribe(() => undefined);

    await expect(session.signIn('pilota@sinopialab.com', 'sbagliata')).resolves.toEqual({
      ok: false,
      code: 'invalidCredentials',
    });
    expect(session.getState()).toEqual({ status: 'signed-out' });
  });

  it('should refresh the token itself before it lapses in a hidden tab, and hand listeners the new one', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'Date'],
      now: Date.now(),
    });
    /* The supabase-js client stops its own refresh ticker while the tab is hidden; an agent run in the worker goes on. */
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const refreshed = tokenResponse('refreshed');
    const { calls } = scriptSinopiaBackend({ refresh: refreshed });
    /* Outside supabase-js's 90-second margin, so opening the session refreshes nothing. */
    const stored = tokenResponse('stored', 120);
    localStorage.setItem(sinopiaKey, JSON.stringify(stored));
    const session = open();
    const tokens: Array<string | undefined> = [];
    session.onAccessToken((token) => {
      tokens.push(token);
    });
    await vi.waitFor(() => {
      expect(tokens).toEqual([stored.access_token]);
    });
    expect(authCalls(calls)).toEqual([]);

    /* A minute before expiry. */
    await vi.advanceTimersByTimeAsync(61_000);

    await vi.waitFor(() => {
      expect(tokens).toEqual([stored.access_token, refreshed.access_token]);
    });
    expect(authCalls(calls)).toEqual([{ path: '/auth/v1/token', grant: 'refresh_token' }]);
    await expect(session.accessToken()).resolves.toBe(refreshed.access_token);
  });

  it('should sign out on this browser only and tell token listeners there is no token', async () => {
    const { calls } = scriptSinopiaBackend();
    localStorage.setItem(sinopiaKey, JSON.stringify(tokenResponse('stored')));
    const session = open();
    const tokens: Array<string | undefined> = [];
    session.onAccessToken((token) => {
      tokens.push(token);
    });
    await vi.waitFor(() => {
      expect(session.getState()).toEqual(signedInState);
    });

    await session.signOut();

    await vi.waitFor(() => {
      expect(session.getState()).toEqual({ status: 'signed-out' });
    });
    expect(tokens.at(-1)).toBeUndefined();
    expect(localStorage.getItem(sinopiaKey)).toBeNull();
    expect(authCalls(calls)).toEqual([{ path: '/auth/v1/logout', grant: undefined }]);
  });

  it('should stay disabled, gate nothing and send no token without a Sinopia project', async () => {
    const session = createSinopiaSession(undefined);

    session.subscribe(() => undefined);

    expect(session.getState()).toEqual({ status: 'disabled' });
    expect(session.getInitialState()).toEqual({ status: 'disabled' });
    await expect(session.accessToken()).resolves.toBeUndefined();
  });
});

describe('createSinopiaSession entry criteria', () => {
  it.each<{ account: SinopiaTestAccount; code: SinopiaMessageCode }>([
    {
      account: { withoutTerms: true },
      code: 'terms',
    },
    {
      account: { needsProfession: true, beta: 'not_applicable' },
      code: 'profession',
    },
  ])(
    'should sign out an account sinopialab.com keeps out ($account) and say where to complete it',
    async ({ account, code }) => {
      const signedIn = tokenResponse('signed-in');
      const { calls } = scriptSinopiaBackend({ password: signedIn }, account);
      const session = open();
      const tokens: Array<string | undefined> = [];
      session.onAccessToken((token) => {
        tokens.push(token);
      });
      await vi.waitFor(() => {
        expect(session.getState()).toEqual({ status: 'signed-out' });
      });

      await session.signIn('pilota@sinopialab.com', 'segreta');

      await vi.waitFor(() => {
        expect(session.getState()).toEqual({
          status: 'signed-out',
          notice: { code, link: { href: 'https://sinopialab.com/auth' } },
        });
      });
      expect(tokens).toEqual([]);
      expect(localStorage.getItem(sinopiaKey)).toBeNull();
      expect(authCalls(calls)).toEqual([
        { path: '/auth/v1/token', grant: 'password' },
        { path: '/auth/v1/logout', grant: undefined },
      ]);
      await expect(session.accessToken()).resolves.toBeUndefined();
    },
  );

  it.each<{ name: string; account: SinopiaTestAccount }>([
    { name: 'a designer', account: { role: 'designer' } },
    { name: 'an account without a profile row', account: { withoutProfile: true } },
  ])(
    'should keep $name in the reserved preview: signed in on the browser, never admitted, no token out',
    async ({ account }) => {
      localStorage.setItem(sinopiaKey, JSON.stringify(tokenResponse('stored')));
      scriptSinopiaBackend({}, account);
      const session = open();
      const tokens: Array<string | undefined> = [];
      session.onAccessToken((token) => {
        tokens.push(token);
      });

      await vi.waitFor(() => {
        expect(session.getState()).toMatchObject({ status: 'reserved' });
      });
      expect(tokens.filter((token) => token !== undefined)).toEqual([]);
      await expect(session.accessToken()).resolves.toBeUndefined();
    },
  );

  it('should clear the notice at the next sign-in attempt', async () => {
    scriptSinopiaBackend({ password: tokenResponse('signed-in') }, { withoutTerms: true });
    const session = open();
    session.subscribe(() => undefined);
    await session.signIn('pilota@sinopialab.com', 'segreta');
    await vi.waitFor(() => {
      expect(session.getState()).toHaveProperty('notice.link.href', 'https://sinopialab.com/auth');
    });

    const again = session.signIn('pilota@sinopialab.com', 'segreta');

    expect(session.getState()).toEqual({ status: 'signed-out' });
    await again;
  });

  it('should hold a valid account at «Riprova» when a read fails, without signing it out, and admit it on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stored = tokenResponse('stored');
    localStorage.setItem(sinopiaKey, JSON.stringify(stored));
    scriptSinopiaBackend({}, { failing: ['profile'] });
    const session = open();
    session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toEqual({
        ...signedInState,
        status: 'unverified',
      });
    });
    expect(localStorage.getItem(sinopiaKey)).not.toBeNull();
    await expect(session.accessToken()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[sinopia] could not read the profile', expect.anything());

    const { calls } = scriptSinopiaBackend();
    session.retryAccess();

    await vi.waitFor(() => {
      expect(session.getState()).toEqual(signedInState);
    });
    expect(authCalls(calls)).toEqual([]);
    await expect(session.accessToken()).resolves.toBe(stored.access_token);
  });

  it('should ask an account with a second factor to confirm it before reading anything of Sinopia', async () => {
    const { calls } = scriptSinopiaBackend();
    localStorage.setItem(
      sinopiaKey,
      JSON.stringify(
        tokenResponse('stored', 3600, {
          factors: [sinopiaTestFactor],
          aal: 'aal1',
        }),
      ),
    );
    const session = open();
    session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toEqual({
        ...signedInState,
        status: 'second-factor',
      });
    });
    expect(calls).toEqual([]);
    await expect(session.accessToken()).resolves.toBeUndefined();
  });
});

describe('createSinopiaSession with Google', () => {
  it("should leave for Google's account chooser and come back to this page", async () => {
    scriptSinopiaBackend();
    globalThis.history.replaceState(null, '', '/w/studio/scarpa?chat=uno#vista');
    const { session, openGoogle } = openWithGoogleSpy();
    openGoogle.mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.example/' },
      error: null,
    });

    await expect(session.signInWithGoogle()).resolves.toEqual({ ok: true });

    expect(openGoogle).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:3000/w/studio/scarpa',
        queryParams: { prompt: 'select_account' },
      },
    });
    expect(JSON.parse(sessionStorage.getItem('sinopiacad:auth-return') ?? '{}')).toMatchObject({
      path: '/w/studio/scarpa?chat=uno#vista',
    });
  });

  it('should name the cause when Google is not enabled, with the raw message in the console only', async () => {
    scriptSinopiaBackend();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session, openGoogle } = openWithGoogleSpy();
    const error = new AuthError('Unsupported provider: provider is not enabled', 400, 'validation_failed');
    openGoogle.mockResolvedValue({
      data: { provider: 'google', url: null },
      error,
    });

    await expect(session.signInWithGoogle()).resolves.toEqual({
      ok: false,
      code: 'googleDisabled',
    });
    expect(consoleError).toHaveBeenCalledWith('[sinopia] the Google sign-in did not start', error);
  });

  it('should exchange the code on the way back, take it out of the address and return where the person was', async () => {
    const returned = tokenResponse('google');
    const { calls } = scriptSinopiaBackend({ pkce: returned });
    rememberSinopiaReturn({
      pathname: '/w/studio/scarpa',
      search: '?chat=uno',
      hash: '#vista',
    });
    localStorage.setItem(`${sinopiaKey}-code-verifier`, JSON.stringify('verifier-sinopia'));
    globalThis.history.replaceState(null, '', '/w/studio/scarpa?code=codice-google');
    const session = open();
    session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toEqual(signedInState);
      expect(session.getPendingReturn()).toBe('/w/studio/scarpa?chat=uno#vista');
    });
    expect(calls.find((call) => call.grant === 'pkce')?.body).toEqual({
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase Auth's wire is snake_case.
      auth_code: 'codice-google',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase Auth's wire is snake_case.
      code_verifier: 'verifier-sinopia',
    });
    expect(globalThis.location.search).toBe('');
    expect(sessionStorage.getItem('sinopiacad:auth-return')).toBeNull();
    await expect(session.accessToken()).resolves.toBe(returned.access_token);

    session.settleReturn('/w/studio/scarpa?chat=uno#vista');

    expect(session.getPendingReturn()).toBeUndefined();
  });

  it('should sign out a brand-new Google account Sinopia has not admitted yet', async () => {
    scriptSinopiaBackend(
      { pkce: tokenResponse('google') },
      { needsProfession: true, beta: 'needs_profile', withoutTerms: true },
    );
    rememberSinopiaReturn({ pathname: '/', search: '', hash: '' });
    localStorage.setItem(`${sinopiaKey}-code-verifier`, JSON.stringify('verifier-sinopia'));
    globalThis.history.replaceState(null, '', '/?code=codice-google');
    const session = open();
    session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toMatchObject({
        status: 'signed-out',
        notice: { link: { href: 'https://sinopialab.com/auth' } },
      });
    });
    expect(localStorage.getItem(sinopiaKey)).toBeNull();
    await expect(session.accessToken()).resolves.toBeUndefined();
  });

  it('should explain a failed way back in Italian and still clean the address', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    scriptSinopiaBackend();
    rememberSinopiaReturn({
      pathname: '/w/studio/scarpa',
      search: '',
      hash: '',
    });
    globalThis.history.replaceState(
      null,
      '',
      '/w/studio/scarpa?error=access_denied&error_code=bad_oauth_callback&error_description=Unable+to+exchange+external+code',
    );
    const session = open();
    session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toEqual({
        status: 'signed-out',
        notice: { code: 'googleFailed' },
      });
      expect(session.getPendingReturn()).toBe('/w/studio/scarpa');
    });
    expect(consoleError).toHaveBeenCalledWith('[sinopia] the Google sign-in did not complete', expect.anything());
  });
});

describe('sinopiaSignInErrorCode', () => {
  it('should name each refusal by a code the screen words', () => {
    expect(
      sinopiaSignInErrorCode({
        name: 'AuthApiError',
        status: 400,
        code: 'email_not_confirmed',
      }),
    ).toBe('emailNotConfirmed');
    expect(
      sinopiaSignInErrorCode({
        name: 'AuthApiError',
        status: 429,
        code: 'over_request_rate_limit',
      }),
    ).toBe('tooMany');
    expect(
      sinopiaSignInErrorCode({
        name: 'AuthRetryableFetchError',
        status: 0,
        code: undefined,
      }),
    ).toBe('unreachable');
    expect(
      sinopiaSignInErrorCode({
        name: 'AuthApiError',
        status: 500,
        code: 'unexpected_failure',
      }),
    ).toBe('signInFailed');
  });
});

describe('sinopiaGoogleErrorCode', () => {
  it('should name each Google failure by a code, never with the raw message', () => {
    expect(
      sinopiaGoogleErrorCode({
        message: 'Unsupported provider: provider is not enabled',
        status: 400,
      }),
    ).toBe('googleDisabled');
    expect(sinopiaGoogleErrorCode(new TypeError('Failed to fetch'))).toBe('unreachable');
    expect(
      sinopiaGoogleErrorCode({
        message: 'Request rate limit reached',
        status: 429,
      }),
    ).toBe('tooMany');
    expect(
      sinopiaGoogleErrorCode({
        message: 'Unable to exchange external code: 4/0AQ',
        status: 500,
      }),
    ).toBe('googleFailed');
    expect(sinopiaGoogleErrorCode('boom')).toBe('googleFailed');
  });
});
