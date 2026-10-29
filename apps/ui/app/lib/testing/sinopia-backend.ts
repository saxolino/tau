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
  /**
   * What the `sinopiacad` function answers on `GET /v1/models` (`SINOPIACAD_ALLOWED_USERS`): the account is in the
   * pilot list (by default), is left out with the new code or the old one, or the function fails.
   */
  readonly pilot?: 'allowed' | 'reserved' | 'restricted' | 'failing';
  /**
   * Che cosa risponde `POST /v1/views`: `assente` (funzione vecchia, 404, come predefinito), `genera` (una vista finta
   * della faccia di serie, senza rete né costi) o il `type` d'errore da rispondere.
   */
  readonly views?: 'assente' | 'genera' | { readonly errore: string; readonly stato: number };
};

/** Le facce che la vista finta dichiara, per ruolo (quelle di un tacco: di fianco, controllo da dietro). */
const facceFinte = { principale: 'fianco_esterno', controllo: 'dietro' } as const;

/**
 * La risposta finta di `/v1/views` a un corpo: stessa forma della funzione (§5.1), percorso nel progetto della scheda.
 *
 * @param body - Il corpo della richiesta.
 * @returns La risposta 200.
 */
export const sinopiaFakeView = (body: unknown): Record<string, unknown> => {
  const corpo = (body ?? {}) as {
    requestId?: string;
    ruolo?: 'principale' | 'controllo';
    famiglia?: string;
    schedaParte?: { progetto?: { id?: string } };
  };
  const ruolo = corpo.ruolo === 'controllo' ? 'controllo' : 'principale';
  const progettoId = corpo.schedaParte?.progetto?.id ?? '00000000-0000-4000-8000-000000000000';
  const requestId = corpo.requestId ?? '00000000-0000-4000-8000-000000000001';
  return {
    versione: 1,
    ruolo,
    famiglia: corpo.famiglia ?? 'tacco',
    faccia: facceFinte[ruolo],
    assetId: ruolo === 'principale' ? '7a000000-0000-4000-8000-000000000001' : '7a000000-0000-4000-8000-000000000002',
    progettoId,
    percorso: { bucket: 'creator-private', path: `projects/${progettoId}/canvas-gen/${requestId}-isolate-part.png` },
    mediaType: 'image/png',
    aiAct: 'ai-modified',
    costo: 2,
    modello: 'finto',
    millisecondi: 0,
    replayed: false,
  };
};

const viewsAnswer = (views: SinopiaTestAccount['views'], body: unknown): Response => {
  if (views === undefined || views === 'assente') {
    return Response.json({ message: 'unexpected' }, { status: 404 });
  }
  if (views === 'genera') {
    return Response.json(sinopiaFakeView(body));
  }
  return Response.json({ error: { type: views.errore, message: views.errore } }, { status: views.stato });
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

/** The `sinopiacad` function's catalog as the pilot list answers it. */
const pilotAnswer = (pilot: NonNullable<SinopiaTestAccount['pilot']>): Response => {
  switch (pilot) {
    case 'allowed': {
      return Response.json([]);
    }
    case 'reserved': {
      return Response.json({ error: { type: 'CAD_PILOT_NOT_ALLOWED', message: 'pilota' } }, { status: 403 });
    }
    case 'restricted': {
      return Response.json({ error: { type: 'BILLING_ACCOUNT_RESTRICTED', message: 'pilota' } }, { status: 403 });
    }
    case 'failing': {
      return Response.json({ message: 'boom', code: 'XX000' }, { status: 500 });
    }
  }
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
      case '/v1/models': {
        return pilotAnswer(account.pilot ?? 'allowed');
      }
      case '/v1/views': {
        return viewsAnswer(account.views, calls.at(-1)?.body);
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
