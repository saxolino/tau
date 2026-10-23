// @vitest-environment jsdom
/**
 * SinopiaCAD's Sinopia session over the real supabase-js client. The network is a scripted `fetch` standing in for
 * Supabase Auth, so sign-in, refresh and sign-out run their real code paths and nothing leaves the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSinopiaSession, sinopiaSignInErrorMessage, sinopiaStorageKey } from '#lib/sinopia-session.js';
import type { SinopiaSession } from '#lib/sinopia-session.js';

const config = { url: 'https://zixducvzqlgpvurbqfuz.supabase.co', publishableKey: 'sinopia-publishable-key' };
/** The key sinopialab.com's own supabase-js client keeps its session under (its default for this project). */
const sinopiaKey = 'sb-zixducvzqlgpvurbqfuz-auth-token';

const base64Url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/* eslint-disable @typescript-eslint/naming-convention -- Supabase Auth's wire is snake_case. */
const user = {
  id: 'user-sinopia',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'pilota@sinopialab.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};

/** A Supabase token response that expires `lifetime` seconds from now. */
const tokenResponse = (name: string, lifetime = 3600) => {
  const expiresAt = Math.floor(Date.now() / 1000) + lifetime;
  return {
    access_token: `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ sub: user.id, exp: expiresAt, name })}.signature`,
    token_type: 'bearer',
    expires_in: lifetime,
    expires_at: expiresAt,
    refresh_token: `refresh-${name}`,
    user,
  };
};
/* eslint-enable @typescript-eslint/naming-convention -- End Supabase Auth wire fixtures. */

type AuthCall = { readonly path: string; readonly grant: string | undefined };

/** Supabase Auth as a scripted `fetch`: password and refresh grants answer the next session, logout answers 204. */
const scriptAuth = (answers: { password?: unknown; refresh?: unknown; passwordStatus?: number }) => {
  const calls: AuthCall[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const grant = url.searchParams.get('grant_type') ?? undefined;
    calls.push({ path: url.pathname, grant });
    if (url.pathname === '/auth/v1/token' && grant === 'password') {
      /* Supabase Auth names the API version it answers in, which is how supabase-js reads an error's `code`. */
      return Response.json(answers.password, {
        status: answers.passwordStatus ?? 200,
        headers: { 'x-supabase-api-version': '2024-01-01' },
      });
    }
    if (url.pathname === '/auth/v1/token' && grant === 'refresh_token') {
      return Response.json(answers.refresh);
    }
    if (url.pathname === '/auth/v1/logout') {
      return new Response(null, { status: 204 });
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
};

const opened: SinopiaSession[] = [];
const open = (): SinopiaSession => {
  const session = createSinopiaSession(config);
  opened.push(session);
  return session;
};

beforeEach(() => {
  localStorage.clear();
  /* Each test opens its own client on the same key, which supabase-js warns about; one document has one. */
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (session) => session.dispose()));
  localStorage.clear();
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
  it('should pick up the session Sinopia stored under its own key, without asking the server', async () => {
    const { fetchMock } = scriptAuth({});
    const stored = tokenResponse('stored');
    localStorage.setItem(sinopiaKey, JSON.stringify(stored));
    const session = open();
    expect(session.getState()).toEqual({ status: 'checking' });

    const unsubscribe = session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-sinopia', email: 'pilota@sinopialab.com' },
      });
    });
    await expect(session.accessToken()).resolves.toBe(stored.access_token);
    expect(fetchMock).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('should read as signed out when nothing is stored', async () => {
    scriptAuth({});
    const session = open();

    session.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(session.getState()).toEqual({ status: 'signed-out' });
    });
    await expect(session.accessToken()).resolves.toBeUndefined();
  });

  it('should sign in with a password into the shared key and tell token listeners', async () => {
    const signedIn = tokenResponse('signed-in');
    const { calls } = scriptAuth({ password: signedIn });
    const session = open();
    const tokens: Array<string | undefined> = [];
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
    expect(session.getState()).toMatchObject({ status: 'signed-in' });
    expect(JSON.parse(localStorage.getItem(sinopiaKey) ?? '{}')).toMatchObject({
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase Auth's stored session is snake_case.
      access_token: signedIn.access_token,
    });
    expect(calls).toEqual([{ path: '/auth/v1/token', grant: 'password' }]);
  });

  it('should answer a refused sign-in with an Italian message and stay signed out', async () => {
    scriptAuth({
      password: { code: 'invalid_credentials', message: 'Invalid login credentials' },
      passwordStatus: 400,
    });
    const session = open();
    session.subscribe(() => undefined);

    await expect(session.signIn('pilota@sinopialab.com', 'sbagliata')).resolves.toEqual({
      ok: false,
      message: 'Email o password non corretti.',
    });
    expect(session.getState()).toEqual({ status: 'signed-out' });
  });

  it('should refresh the token itself before it lapses in a hidden tab, and hand listeners the new one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.now() });
    /* The supabase-js client stops its own refresh ticker while the tab is hidden; an agent run in the worker goes on. */
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const refreshed = tokenResponse('refreshed');
    const { calls } = scriptAuth({ refresh: refreshed });
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
    expect(calls).toEqual([]);

    /* A minute before expiry. */
    await vi.advanceTimersByTimeAsync(61_000);

    await vi.waitFor(() => {
      expect(tokens).toEqual([stored.access_token, refreshed.access_token]);
    });
    expect(calls).toEqual([{ path: '/auth/v1/token', grant: 'refresh_token' }]);
    await expect(session.accessToken()).resolves.toBe(refreshed.access_token);
  });

  it('should sign out on this browser only and tell token listeners there is no token', async () => {
    const { calls } = scriptAuth({});
    localStorage.setItem(sinopiaKey, JSON.stringify(tokenResponse('stored')));
    const session = open();
    const tokens: Array<string | undefined> = [];
    session.onAccessToken((token) => {
      tokens.push(token);
    });
    await vi.waitFor(() => {
      expect(session.getState()).toMatchObject({ status: 'signed-in' });
    });

    await session.signOut();

    await vi.waitFor(() => {
      expect(session.getState()).toEqual({ status: 'signed-out' });
    });
    expect(tokens.at(-1)).toBeUndefined();
    expect(localStorage.getItem(sinopiaKey)).toBeNull();
    expect(calls).toEqual([{ path: '/auth/v1/logout', grant: undefined }]);
  });

  it('should stay disabled, gate nothing and send no token without a Sinopia project', async () => {
    const session = createSinopiaSession(undefined);

    session.subscribe(() => undefined);

    expect(session.getState()).toEqual({ status: 'disabled' });
    expect(session.getInitialState()).toEqual({ status: 'disabled' });
    await expect(session.accessToken()).resolves.toBeUndefined();
  });
});

describe('sinopiaSignInErrorMessage', () => {
  it('should explain each refusal in Italian', () => {
    expect(sinopiaSignInErrorMessage({ name: 'AuthApiError', status: 400, code: 'email_not_confirmed' })).toBe(
      'Conferma prima la tua email: apri il messaggio che ti ha mandato Sinopia.',
    );
    expect(sinopiaSignInErrorMessage({ name: 'AuthApiError', status: 429, code: 'over_request_rate_limit' })).toBe(
      'Troppi tentativi. Riprova tra qualche minuto.',
    );
    expect(sinopiaSignInErrorMessage({ name: 'AuthRetryableFetchError', status: 0, code: undefined })).toBe(
      'Non riesco a raggiungere Sinopia. Controlla la connessione e riprova.',
    );
    expect(sinopiaSignInErrorMessage({ name: 'AuthApiError', status: 500, code: 'unexpected_failure' })).toBe(
      'Accesso non riuscito. Riprova.',
    );
  });
});
