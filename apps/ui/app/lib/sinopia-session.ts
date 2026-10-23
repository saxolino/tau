/**
 * Sinopia's session in SinopiaCAD (SinopiaCAD addition).
 *
 * SinopiaCAD signs in with the person's Sinopia account, held by Supabase Auth in Sinopia's project. Online it is
 * served at `sinopialab.com/cad`, the same origin as Sinopia, so the client reads and writes the very localStorage key
 * Sinopia's own client uses: whoever is signed in to Sinopia is signed in here, and signing out here signs out there.
 * Locally there is no shared session and the gate shows its own sign-in form.
 *
 * The session's access token authorises every call to Sinopia's `sinopiacad` function (`TAU_API_URL`): the catalog,
 * dictation and, through the agent-host worker, the model gateway. Tau's Better Auth wiring stays in place but inert.
 *
 * `@supabase/supabase-js` loads on first use in the browser only, so the server graph and the first chunk stay free of it.
 */
import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import { Topic } from '@taucad/events';
import { ENV } from '#environment.config.js';
import { isDesktopTarget } from '#lib/build-target.js';

/** Sinopia's Supabase project as the host injects it. */
export type SinopiaConfig = Readonly<{ url: string; publishableKey: string }>;

/** The signed-in Sinopia account, as SinopiaCAD shows it. */
export type SinopiaUser = Readonly<{ id: string; email: string | undefined }>;

/**
 * Where the session stands. `disabled` means no Sinopia project is configured (tests, the desktop build, a Tau
 * deployment): nothing is gated and no token is sent. `checking` lasts until the stored session has been read.
 */
export type SinopiaSessionState =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'checking' }>
  | Readonly<{ status: 'signed-out' }>
  | Readonly<{ status: 'signed-in'; user: SinopiaUser }>;

/** The outcome of a sign-in, with a sentence in Italian for the person when it failed. */
export type SinopiaSignInResult = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;

/** The one Supabase client factory SinopiaCAD uses; a seam for tests. */
export type SinopiaClientFactory = (config: SinopiaConfig, storageKey: string) => Promise<SupabaseClient>;

/** One Sinopia session: its state for the gate, its current token for requests, and sign-in and sign-out. */
export type SinopiaSession = {
  /** The current state; the same object until it changes, as `useSyncExternalStore` needs. */
  readonly getState: () => SinopiaSessionState;
  /** The state before the stored session is read: what the server renders and hydration starts from. */
  readonly getInitialState: () => SinopiaSessionState;
  /** Hear every state change. Starts reading the stored session. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Hear the access token change (signed in, refreshed, signed out). Starts reading the stored session. */
  readonly onAccessToken: (listener: (token: string | undefined) => void) => () => void;
  /** The current access token, refreshed first when it is about to expire; `undefined` signed out or disabled. */
  readonly accessToken: () => Promise<string | undefined>;
  readonly signIn: (email: string, password: string) => Promise<SinopiaSignInResult>;
  /** Sign out on this browser only; Sinopia's other devices keep their sessions. */
  readonly signOut: () => Promise<void>;
  /** Stop listening to the client and stop every refresh timer; the document's own session lives as long as the page. */
  readonly dispose: () => Promise<void>;
};

/**
 * The localStorage key supabase-js gives a project by default, `sb-<project ref>-auth-token`, which is the key
 * Sinopia's own client (`sinopialab.com`) keeps its session under.
 *
 * @param supabaseUrl - The project URL, `https://<project ref>.supabase.co`.
 * @returns The storage key.
 */
export const sinopiaStorageKey = (supabaseUrl: string): string =>
  `sb-${new URL(supabaseUrl).hostname.split('.')[0] ?? ''}-auth-token`;

/**
 * How long before the token expires SinopiaCAD refreshes it itself. Milliseconds. supabase-js stops its own refresh
 * ticker while the tab is hidden, but an agent run keeps calling the gateway from the worker, so the page refreshes
 * the token before it lapses whatever the tab's visibility. It sits inside supabase-js's own 90-second expiry margin,
 * so `getSession()` then refreshes.
 */
const refreshLead = 60_000;

const unreachableMessage = 'Non riesco a raggiungere Sinopia. Controlla la connessione e riprova.';

/**
 * The sentence a failed sign-in shows, in Italian.
 *
 * @param error - The error supabase-js answered with.
 * @returns The message.
 */
export const sinopiaSignInErrorMessage = (error: Pick<AuthError, 'code' | 'status' | 'name'>): string => {
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return unreachableMessage;
  }
  switch (error.code) {
    case 'invalid_credentials': {
      return 'Email o password non corretti.';
    }
    case 'email_not_confirmed': {
      return 'Conferma prima la tua email: apri il messaggio che ti ha mandato Sinopia.';
    }
    case 'user_banned': {
      return 'Questo account Sinopia è sospeso.';
    }
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': {
      return 'Troppi tentativi. Riprova tra qualche minuto.';
    }
    default: {
      return error.status === 429 ? 'Troppi tentativi. Riprova tra qualche minuto.' : 'Accesso non riuscito. Riprova.';
    }
  }
};

const createSupabaseClient: SinopiaClientFactory = async (config, storageKey) => {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.url, config.publishableKey, {
    auth: {
      storageKey,
      persistSession: true,
      autoRefreshToken: true,
      /* Sinopia's own pages handle its email and recovery links; SinopiaCAD only signs in with a password. */
      detectSessionInUrl: false,
    },
  });
};

const sameState = (left: SinopiaSessionState, right: SinopiaSessionState): boolean =>
  left.status === right.status &&
  (left.status !== 'signed-in' ||
    (right.status === 'signed-in' && left.user.id === right.user.id && left.user.email === right.user.email));

/**
 * Create a Sinopia session over one Supabase client. Nothing runs until something subscribes or asks for a token, and
 * nothing runs outside a browser.
 *
 * @param config - Sinopia's project, or `undefined` for a disabled session.
 * @param createClient - The client factory; supabase-js by default.
 * @returns The session.
 */
export const createSinopiaSession = (
  config: SinopiaConfig | undefined,
  createClient: SinopiaClientFactory = createSupabaseClient,
): SinopiaSession => {
  const initialState: SinopiaSessionState = config === undefined ? { status: 'disabled' } : { status: 'checking' };
  let state: SinopiaSessionState = initialState;
  let currentToken: string | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let client: Promise<SupabaseClient> | undefined;
  let stopListening: (() => void) | undefined;
  const stateTopic = new Topic<undefined>({ name: 'SinopiaSession.state' });
  const tokenTopic = new Topic<string | undefined>({ name: 'SinopiaSession.token' });

  const scheduleRefresh = (supabase: SupabaseClient, session: Session | undefined): void => {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (session?.expires_at === undefined) {
      return;
    }
    refreshTimer = setTimeout(
      () => {
        // async-iife: bootstrap -- a refresh announces itself through onAuthStateChange; a failed one is retried by
        // supabase-js's own ticker and by the next request's getSession().
        void (async (): Promise<void> => {
          try {
            await supabase.auth.getSession();
          } catch {
            /* See above. */
          }
        })();
      },
      Math.max(0, session.expires_at * 1000 - Date.now() - refreshLead),
    );
  };

  const apply = (supabase: SupabaseClient, session: Session | undefined): void => {
    const next: SinopiaSessionState =
      session === undefined
        ? { status: 'signed-out' }
        : { status: 'signed-in', user: { id: session.user.id, email: session.user.email } };
    if (!sameState(state, next)) {
      state = next;
      stateTopic.emit(undefined);
    }
    if (session?.access_token !== currentToken) {
      currentToken = session?.access_token;
      tokenTopic.emit(currentToken);
    }
    scheduleRefresh(supabase, session);
  };

  const clientOf = async (): Promise<SupabaseClient> => {
    if (config === undefined) {
      throw new Error('SinopiaCAD has no Sinopia project configured.');
    }
    client ??= (async () => {
      const supabase = await createClient(config, sinopiaStorageKey(config.url));
      /* INITIAL_SESSION reads the stored session; SIGNED_IN, TOKEN_REFRESHED and SIGNED_OUT follow it, including those
       * another tab of this origin (Sinopia's own) announces. The callback stays synchronous, as supabase-js asks. */
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        apply(supabase, session ?? undefined);
      });
      stopListening = () => {
        data.subscription.unsubscribe();
      };
      return supabase;
    })();
    return client;
  };

  const start = (): void => {
    // oxlint-disable-next-line @typescript-eslint/no-unnecessary-condition -- globalThis.window is absent during SSR.
    if (config === undefined || !globalThis.window) {
      return;
    }
    // async-iife: bootstrap -- the client's first event moves the state on; a client that cannot load reads as signed out.
    void (async (): Promise<void> => {
      try {
        await clientOf();
      } catch (error) {
        console.error('[sinopia] could not start the Sinopia session', error);
        if (state.status === 'checking') {
          state = { status: 'signed-out' };
          stateTopic.emit(undefined);
        }
      }
    })();
  };

  return {
    getState: () => state,
    getInitialState: () => initialState,
    subscribe: (listener) => {
      const unsubscribe = stateTopic.subscribe(() => {
        listener();
      });
      start();
      return unsubscribe;
    },
    onAccessToken: (listener) => {
      const unsubscribe = tokenTopic.subscribe(listener);
      start();
      return unsubscribe;
    },
    accessToken: async () => {
      // oxlint-disable-next-line @typescript-eslint/no-unnecessary-condition -- globalThis.window is absent during SSR.
      if (config === undefined || !globalThis.window) {
        return undefined;
      }
      try {
        const supabase = await clientOf();
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token;
      } catch {
        return undefined;
      }
    },
    signIn: async (email, password) => {
      try {
        const supabase = await clientOf();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return error === null ? { ok: true } : { ok: false, message: sinopiaSignInErrorMessage(error) };
      } catch {
        return { ok: false, message: unreachableMessage };
      }
    },
    signOut: async () => {
      const supabase = await clientOf();
      /* `local` drops this browser's session even when the server cannot be reached; `global` would end every device's. */
      await supabase.auth.signOut({ scope: 'local' });
    },
    dispose: async () => {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      stopListening?.();
      stopListening = undefined;
      const supabase = await client?.catch(() => undefined);
      await supabase?.auth.stopAutoRefresh();
    },
  };
};

/**
 * Sinopia's project as the host injected it, or `undefined` when it is absent or this is the desktop build.
 *
 * @returns The configuration.
 */
export const readSinopiaConfig = (): SinopiaConfig | undefined => {
  if (isDesktopTarget()) {
    return undefined;
  }
  try {
    const url = ENV.SINOPIA_SUPABASE_URL;
    const publishableKey = ENV.SINOPIA_SUPABASE_PUBLISHABLE_KEY;
    return url === undefined || publishableKey === undefined ? undefined : { url, publishableKey };
  } catch {
    /* A host that injected no environment at all (a worker, a node test) has no Sinopia project either. */
    return undefined;
  }
};

let documentSession: SinopiaSession | undefined;

/**
 * This document's Sinopia session, created on first use.
 *
 * @returns The session.
 */
export const sinopiaSession = (): SinopiaSession => {
  documentSession ??= createSinopiaSession(readSinopiaConfig());
  return documentSession;
};

/**
 * The `Authorization` header for a call to Sinopia's function: the current access token, or nothing when there is
 * no session (the call then answers 401, which every caller already treats as unavailable).
 *
 * @returns Headers to spread into a request's headers.
 */
export const sinopiaAuthorization = async (): Promise<Readonly<Record<string, string>>> => {
  const token = await sinopiaSession().accessToken();
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
};
