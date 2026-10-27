/**
 * Sinopia's Supabase project as a scripted `fetch`, for tests of SinopiaCAD's Sinopia session and access check. Auth
 * (password, refresh and PKCE grants, logout) and the PostgREST reads the access check makes answer from a script, so
 * the real supabase-js client runs its own code paths and nothing leaves the test.
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';

/** Sinopia's project as the tests configure it. */
export const sinopiaTestConfig = {
  url: 'https://zixducvzqlgpvurbqfuz.supabase.co',
  publishableKey: 'sinopia-publishable-key',
} as const;

/** The key sinopialab.com's own supabase-js client keeps its session under (its default for this project). */
export const sinopiaTestStorageKey = 'sb-zixducvzqlgpvurbqfuz-auth-token';

/* eslint-disable @typescript-eslint/naming-convention -- Supabase's wire is snake_case. */
/** The signed-in account of every scripted session. */
export const sinopiaTestUser = {
  id: 'user-sinopia',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'pilota@sinopialab.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};

/** A verified authenticator (TOTP) on the account: the second factor Sinopia asks for. */
export const sinopiaTestFactor = { id: 'factor-totp', factor_type: 'totp', status: 'verified' };

const base64Url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A Supabase token response, which is also the session supabase-js stores. */
export type SinopiaTestTokenResponse = {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly expires_at: number;
  readonly refresh_token: string;
  readonly user: typeof sinopiaTestUser & { readonly factors?: readonly unknown[] };
};

/**
 * A Supabase token response that expires `lifetime` seconds from now.
 *
 * @param name - Marks the token, so tests can tell tokens apart.
 * @param lifetime - Seconds until it expires.
 * @param extra - Fields to put on the user (a second factor's `factors`) and on the JWT (its `aal`).
 * @returns The token response, also the shape supabase-js stores.
 */
export const sinopiaTokenResponse = (
  name: string,
  lifetime = 3600,
  extra: { readonly factors?: readonly unknown[]; readonly aal?: 'aal1' | 'aal2' } = {},
): SinopiaTestTokenResponse => {
  const expiresAt = Math.floor(Date.now() / 1000) + lifetime;
  const claims = {
    sub: sinopiaTestUser.id,
    exp: expiresAt,
    name,
    ...(extra.aal === undefined ? {} : { aal: extra.aal }),
  };
  return {
    access_token: `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url(claims)}.${base64Url('signature')}`,
    token_type: 'bearer',
    expires_in: lifetime,
    expires_at: expiresAt,
    refresh_token: `refresh-${name}`,
    user: { ...sinopiaTestUser, ...(extra.factors === undefined ? {} : { factors: extra.factors }) },
  };
};

/** What Sinopia's database says about the signed-in account. A complete administrator by default (SinopiaCAD is a reserved preview). */
export type SinopiaTestAccount = {
  /** `profiles.role`. */
  readonly role?: string;
  /** No `profiles` row at all. */
  readonly withoutProfile?: boolean;
  readonly needsProfession?: boolean;
  /** `get_my_beta_status().state`. */
  readonly beta?: 'not_applicable' | 'needs_profile' | 'waitlisted' | 'active';
  /** The accepted Terms version. */
  readonly terms?: string;
  /** No Terms accepted at all. */
  readonly withoutTerms?: boolean;
  /** Reads that answer 500. */
  readonly failing?: ReadonlyArray<'profile' | 'profession' | 'beta' | 'terms'>;
};

/** The script's answers to Auth. */
export type SinopiaTestAuth = {
  readonly password?: unknown;
  readonly passwordStatus?: number;
  readonly refresh?: unknown;
  readonly pkce?: unknown;
};

/** One request the scripted project received. */
export type SinopiaTestCall = {
  readonly method: string;
  readonly path: string;
  readonly grant: string | undefined;
  readonly body: unknown;
};

const versioned = { 'x-supabase-api-version': '2024-01-01' };

const readBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text === '' ? undefined : (JSON.parse(text) as unknown);
};

/** The scripted project: every call it received, in order, and the `fetch` stub. */
export type SinopiaTestBackend = { readonly calls: SinopiaTestCall[]; readonly fetchMock: Mock<typeof fetch> };

/**
 * Stub the global `fetch` with Sinopia's project.
 *
 * @param auth - How Auth answers each grant.
 * @param account - What the database says about the account.
 * @returns Every call received, in order, and the stub.
 */
export const scriptSinopiaBackend = (
  auth: SinopiaTestAuth = {},
  account: SinopiaTestAccount = {},
): SinopiaTestBackend => {
  const calls: SinopiaTestCall[] = [];
  const { role = 'superadmin', needsProfession = false, beta = 'active', terms = '2026-08-17', failing = [] } = account;
  const profileRows = account.withoutProfile === true ? [] : [{ role }];
  const termsRows = account.withoutTerms === true ? [] : [{ version: terms }];
  const failure = () => Response.json({ message: 'boom', code: 'XX000' }, { status: 500 });
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const grant = url.searchParams.get('grant_type') ?? undefined;
    calls.push({ method: request.method, path: url.pathname, grant, body: await readBody(request) });
    switch (url.pathname) {
      case '/auth/v1/token': {
        if (grant === 'password') {
          /* Supabase Auth names the API version it answers in, which is how supabase-js reads an error's `code`. */
          return Response.json(auth.password, { status: auth.passwordStatus ?? 200, headers: versioned });
        }
        return Response.json(grant === 'pkce' ? auth.pkce : auth.refresh, { headers: versioned });
      }
      case '/auth/v1/logout': {
        return new Response(null, { status: 204 });
      }
      case '/rest/v1/profiles': {
        return failing.includes('profile') ? failure() : Response.json(profileRows);
      }
      case '/rest/v1/rpc/needs_profession_selection': {
        return failing.includes('profession') ? failure() : Response.json(needsProfession);
      }
      case '/rest/v1/rpc/get_my_beta_status': {
        return failing.includes('beta')
          ? failure()
          : Response.json({
              state: beta,
              open: true,
              profile: null,
              prefill: { full_name: null, has_name: false },
              defaults: { credits: 300, validity_days: 60 },
            });
      }
      case '/rest/v1/user_consents': {
        return failing.includes('terms') ? failure() : Response.json(termsRows);
      }
      default: {
        return Response.json({ message: 'unexpected' }, { status: 500 });
      }
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
};
/* eslint-enable @typescript-eslint/naming-convention -- End Supabase wire fixtures. */
