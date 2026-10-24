/**
 * Sinopia's session in SinopiaCAD (SinopiaCAD addition).
 *
 * SinopiaCAD signs in with the person's Sinopia account, held by Supabase Auth in Sinopia's project: with the account's
 * email and password, or with Google exactly as sinopialab.com does (PKCE, the account chooser every time). The client
 * reads and writes the localStorage key Sinopia's own client uses, so on Sinopia's own origin the two share one
 * session; on SinopiaCAD's own origins (`cad.sinopialab.com`, previews, local) the session is SinopiaCAD's.
 *
 * A session is not a pass: after every sign-in SinopiaCAD asks Sinopia's database whether sinopialab.com would let the
 * account into its app (`sinopia-access.ts`). An account it would keep out (a Google account that has just been
 * created, a waiting list, Terms not accepted) is signed out on this browser and told where to put it right; an account
 * with a second factor confirms it first; a check that cannot be read offers «Riprova».
 *
 * The admitted session's access token authorises every call to Sinopia's `sinopiacad` function (`TAU_API_URL`): the
 * catalog, dictation and, through the agent-host worker, the model gateway. No token leaves before admission. Tau's
 * Better Auth wiring stays in place but inert.
 *
 * `@supabase/supabase-js` loads on first use in the browser only, so the server graph and the first chunk stay free of it.
 */
import type { AuthChangeEvent, AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import { Topic } from '@taucad/events';
import { ENV } from '#environment.config.js';
import { isDesktopTarget } from '#lib/build-target.js';
import { checkSinopiaAccess, sinopiaRefusalNotice } from '#lib/sinopia-access.js';
import type { SinopiaMessageCode, SinopiaNotice } from '#lib/sinopia-access.js';
import { isSinopiaAuthReturn, rememberSinopiaReturn, takeSinopiaReturn } from '#lib/sinopia-oauth-return.js';

/** Sinopia's Supabase project as the host injects it. */
export type SinopiaConfig = Readonly<{ url: string; publishableKey: string }>;

/** The signed-in Sinopia account, as SinopiaCAD shows it. */
export type SinopiaUser = Readonly<{ id: string; email: string | undefined }>;

/**
 * Where the session stands. `disabled` means no Sinopia project is configured (tests, the desktop build, a Tau
 * deployment): nothing is gated and no token is sent. `checking` lasts while the stored session is read and while a
 * signed-in account's access is checked. `signed-out` may carry a notice: why the last account was signed out, or why
 * the Google sign-in did not complete. `second-factor` waits for the account's authenticator code; `unverified` means
 * the access check could not be read. Only `signed-in` opens the workspace.
 */
export type SinopiaSessionState =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'checking' }>
  | Readonly<{ status: 'signed-out'; notice?: SinopiaNotice }>
  | Readonly<{ status: 'second-factor'; user: SinopiaUser }>
  | Readonly<{ status: 'unverified'; user: SinopiaUser }>
  | Readonly<{ status: 'signed-in'; user: SinopiaUser }>;

/** The outcome of a sign-in step, with the code of the sentence for the person when it failed. */
export type SinopiaSignInResult = Readonly<{ ok: true }> | Readonly<{ ok: false; code: SinopiaMessageCode }>;

/** The one Supabase client factory SinopiaCAD uses; a seam for tests. */
export type SinopiaClientFactory = (config: SinopiaConfig, storageKey: string) => Promise<SupabaseClient>;

/** One Sinopia session: its state for the gate, its current token for requests, and the sign-in steps. */
export type SinopiaSession = {
  /** The current state; the same object until it changes, as `useSyncExternalStore` needs. */
  readonly getState: () => SinopiaSessionState;
  /** The state before the stored session is read: what the server renders and hydration starts from. */
  readonly getInitialState: () => SinopiaSessionState;
  /** Hear every change of the state or of the pending return. Starts reading the stored session. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Hear the access token change (admitted, refreshed, signed out). Starts reading the stored session. */
  readonly onAccessToken: (listener: (token: string | undefined) => void) => () => void;
  /** The admitted account's access token, refreshed first when about to expire; otherwise `undefined`. */
  readonly accessToken: () => Promise<string | undefined>;
  readonly signIn: (email: string, password: string) => Promise<SinopiaSignInResult>;
  /** Leave for Google's account chooser; `ok` means the browser is on its way. */
  readonly signInWithGoogle: () => Promise<SinopiaSignInResult>;
  /** Confirm the account's second factor with the authenticator's current code. */
  readonly verifySecondFactor: (code: string) => Promise<SinopiaSignInResult>;
  /** Check the signed-in account's access again after the check could not be read. */
  readonly retryAccess: () => void;
  /**
   * After the Google round trip, the address to go back to, until the router has gone there (`settleReturn`). The
   * gate holds the workspace back meanwhile, so nothing renders on the address with the code in it.
   */
  readonly getPendingReturn: () => string | undefined;
  readonly settleReturn: (target: string) => void;
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

const isUnreachable = (error: Partial<Pick<AuthError, 'status' | 'name' | 'message'>>): boolean =>
  error.name === 'AuthRetryableFetchError' ||
  error.status === 0 ||
  (error.message ?? '').toLowerCase().includes('failed to fetch');

/**
 * The message a failed sign-in shows, as a code the screen words in the person's language.
 *
 * @param error - The error supabase-js answered with.
 * @returns The message code.
 */
export const sinopiaSignInErrorCode = (error: Pick<AuthError, 'code' | 'status' | 'name'>): SinopiaMessageCode => {
  if (isUnreachable(error)) {
    return 'unreachable';
  }
  switch (error.code) {
    case 'invalid_credentials': {
      return 'invalidCredentials';
    }
    case 'email_not_confirmed': {
      return 'emailNotConfirmed';
    }
    case 'user_banned': {
      return 'banned';
    }
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': {
      return 'tooMany';
    }
    default: {
      return error.status === 429 ? 'tooMany' : 'signInFailed';
    }
  }
};

/**
 * The message a failed Google sign-in shows, as a code; the raw message goes to the console only. As on
 * sinopialab.com (`handleGoogleAuth`), a message naming the provider means Google is not switched on in Supabase Auth.
 *
 * @param error - What supabase-js answered or threw, on the way out or on the way back.
 * @returns The message code.
 */
export const sinopiaGoogleErrorCode = (error: unknown): SinopiaMessageCode => {
  const details: Partial<Pick<AuthError, 'status' | 'name' | 'message' | 'code'>> =
    typeof error === 'object' && error !== null ? error : {};
  const message = (details.message ?? '').toLowerCase();
  if (message.includes('provider')) {
    return 'googleDisabled';
  }
  if (isUnreachable(details)) {
    return 'unreachable';
  }
  if (details.status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return 'tooMany';
  }
  return 'googleFailed';
};

/**
 * Creates SinopiaCAD's supabase-js client: Sinopia's storage key, PKCE as on sinopialab.com, and the code on the way
 * back from Google exchanged for a session as the client starts.
 *
 * @param config - Sinopia's project.
 * @param storageKey - The key the session lives under.
 * @returns The client.
 */
export const createSinopiaSupabaseClient: SinopiaClientFactory = async (config, storageKey) => {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.url, config.publishableKey, {
    auth: {
      storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
};

const sameState = (left: SinopiaSessionState, right: SinopiaSessionState): boolean => {
  if (left.status === 'signed-out' && right.status === 'signed-out') {
    return left.notice === right.notice;
  }
  if ('user' in left && 'user' in right) {
    return left.status === right.status && left.user.id === right.user.id && left.user.email === right.user.email;
  }
  return left.status === right.status;
};

const userOf = (session: Session): SinopiaUser => ({
  id: session.user.id,
  email: session.user.email,
});

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
  createClient: SinopiaClientFactory = createSinopiaSupabaseClient,
): SinopiaSession => {
  const initialState: SinopiaSessionState = config === undefined ? { status: 'disabled' } : { status: 'checking' };
  let state: SinopiaSessionState = initialState;
  let currentToken: string | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let client: Promise<SupabaseClient> | undefined;
  let stopListening: (() => void) | undefined;
  /** Why the last account left, shown on the sign-in screen until the next attempt. */
  let notice: SinopiaNotice | undefined;
  /** The account whose access was granted; its session alone sends a token. */
  let admittedUserId: string | undefined;
  let latestSession: Session | undefined;
  /** The account whose access check is in flight; the revision drops a check overtaken by a later event. */
  let checkingUserId: string | undefined;
  let revision = 0;
  let pendingReturn: string | undefined;
  const stateTopic = new Topic<undefined>({ name: 'SinopiaSession.state' });
  const tokenTopic = new Topic<string | undefined>({
    name: 'SinopiaSession.token',
  });

  const setState = (next: SinopiaSessionState): void => {
    if (!sameState(state, next)) {
      state = next;
      stateTopic.emit(undefined);
    }
  };

  const showSignedOut = (): void => {
    setState(notice === undefined ? { status: 'signed-out' } : { status: 'signed-out', notice });
  };

  const setNotice = (next: SinopiaNotice | undefined): void => {
    notice = next;
    if (state.status === 'signed-out') {
      showSignedOut();
    }
  };

  const publishToken = (token: string | undefined): void => {
    if (token !== currentToken) {
      currentToken = token;
      tokenTopic.emit(token);
    }
  };

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

  const admit = (supabase: SupabaseClient, session: Session): void => {
    setState({ status: 'signed-in', user: userOf(session) });
    publishToken(session.access_token);
    scheduleRefresh(supabase, session);
  };

  const signOutLocally = async (supabase: SupabaseClient): Promise<void> => {
    try {
      /* `local` drops this browser's session even when the server cannot be reached; `global` would end every device's. */
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.error('[sinopia] could not sign out', error);
    }
  };

  const runCheck = async (supabase: SupabaseClient, user: SinopiaUser, checkRevision: number): Promise<void> => {
    const access = await checkSinopiaAccess(supabase, user.id);
    if (checkRevision !== revision) {
      return;
    }
    checkingUserId = undefined;
    switch (access.verdict) {
      case 'allowed': {
        admittedUserId = user.id;
        notice = undefined;
        if (latestSession?.user.id === user.id) {
          admit(supabase, latestSession);
        }
        break;
      }
      case 'second-factor': {
        setState({ status: 'second-factor', user });
        break;
      }
      case 'unverified': {
        setState({ status: 'unverified', user });
        break;
      }
      case 'refused': {
        /* The account stays out of SinopiaCAD altogether: no session is left behind on this browser. */
        notice = sinopiaRefusalNotice(access.reason);
        await signOutLocally(supabase);
        /* SIGNED_OUT has normally moved the state on; if the client could not even drop the session, say so anyway. */
        if (checkRevision === revision) {
          showSignedOut();
        }
        break;
      }
    }
  };

  const startCheck = (supabase: SupabaseClient, user: SinopiaUser): void => {
    revision += 1;
    const checkRevision = revision;
    checkingUserId = user.id;
    setState({ status: 'checking' });
    /* Off supabase-js's auth callback, as Sinopia's store does: the check makes calls of its own. */
    setTimeout(() => {
      void runCheck(supabase, user, checkRevision);
    }, 0);
  };

  const apply = (supabase: SupabaseClient, event: AuthChangeEvent, session: Session | undefined): void => {
    latestSession = session;
    if (session === undefined) {
      revision += 1;
      checkingUserId = undefined;
      admittedUserId = undefined;
      publishToken(undefined);
      scheduleRefresh(supabase, undefined);
      showSignedOut();
      return;
    }
    if (session.user.id === admittedUserId) {
      admit(supabase, session);
      return;
    }
    /* Not admitted (yet): nothing leaves with this session's token. */
    admittedUserId = undefined;
    publishToken(undefined);
    scheduleRefresh(supabase, undefined);
    const userId = session.user.id;
    const isAwaitingThisAccount =
      checkingUserId === userId ||
      ((state.status === 'second-factor' || state.status === 'unverified') && state.user.id === userId);
    /* A verified second factor changes the answer; a refresh or a repeated sign-in event for the same account does not. */
    if (isAwaitingThisAccount && event !== 'MFA_CHALLENGE_VERIFIED') {
      return;
    }
    startCheck(supabase, userOf(session));
  };

  const clientOf = async (): Promise<SupabaseClient> => {
    if (config === undefined) {
      throw new Error('SinopiaCAD has no Sinopia project configured.');
    }
    client ??= (async () => {
      const storageKey = sinopiaStorageKey(config.url);
      /* Read before supabase-js starts: it exchanges the code and takes it out of the address as it initialises. */
      const isReturning = isSinopiaAuthReturn(new URL(globalThis.location.href), `${storageKey}-code-verifier`);
      const supabase = await createClient(config, storageKey);
      /* INITIAL_SESSION reads the stored session (or the one Google's code was exchanged for); SIGNED_IN,
       * TOKEN_REFRESHED, MFA_CHALLENGE_VERIFIED and SIGNED_OUT follow it, including those another tab of this origin
       * announces. The callback stays synchronous, as supabase-js asks. */
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        apply(supabase, event, session ?? undefined);
      });
      stopListening = () => {
        data.subscription.unsubscribe();
      };
      if (isReturning) {
        // async-iife: bootstrap -- the way back from Google settles once supabase-js has read the address.
        void (async (): Promise<void> => {
          const { error } = await supabase.auth.initialize();
          if (error !== null) {
            console.error('[sinopia] the Google sign-in did not complete', error);
            setNotice({ code: sinopiaGoogleErrorCode(error) });
          }
          pendingReturn = takeSinopiaReturn(new URL(globalThis.location.href));
          stateTopic.emit(undefined);
        })();
      }
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
          showSignedOut();
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
        return data.session !== null && data.session.user.id === admittedUserId ? data.session.access_token : undefined;
      } catch {
        return undefined;
      }
    },
    signIn: async (email, password) => {
      setNotice(undefined);
      try {
        const supabase = await clientOf();
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        return error === null ? { ok: true } : { ok: false, code: sinopiaSignInErrorCode(error) };
      } catch {
        return { ok: false, code: 'unreachable' };
      }
    },
    signInWithGoogle: async () => {
      setNotice(undefined);
      try {
        const supabase = await clientOf();
        const { location } = globalThis;
        rememberSinopiaReturn(location);
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            /* Back to this page; what followed the path comes back from `rememberSinopiaReturn`. */
            redirectTo: `${location.origin}${location.pathname}`,
            /* The account chooser every time, instead of Google's open session (as on sinopialab.com). */
            queryParams: { prompt: 'select_account' },
          },
        });
        if (error !== null) {
          console.error('[sinopia] the Google sign-in did not start', error);
          return { ok: false, code: sinopiaGoogleErrorCode(error) };
        }
        return { ok: true };
      } catch (error) {
        console.error('[sinopia] the Google sign-in did not start', error);
        return { ok: false, code: sinopiaGoogleErrorCode(error) };
      }
    },
    verifySecondFactor: async (code) => {
      try {
        const supabase = await clientOf();
        const { data } = await supabase.auth.getSession();
        let factorId = data.session?.user.factors?.find(
          (factor) => factor.status === 'verified' && factor.factor_type === 'totp',
        )?.id;
        if (factorId === undefined) {
          const factors = await supabase.auth.mfa.listFactors();
          if (factors.error !== null) {
            throw factors.error;
          }
          /* `totp` lists the verified TOTP factors only. */
          factorId = factors.data.totp[0]?.id;
        }
        if (factorId === undefined) {
          return { ok: false, code: 'secondFactorMissing' };
        }
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code,
        });
        if (error !== null) {
          console.error('[sinopia] the second factor was not confirmed', error);
          return {
            ok: false,
            code: isUnreachable(error) ? 'unreachable' : 'secondFactorInvalid',
          };
        }
        /* MFA_CHALLENGE_VERIFIED follows, and the access check runs again on the aal2 session. */
        return { ok: true };
      } catch (error) {
        console.error('[sinopia] the second factor was not confirmed', error);
        return { ok: false, code: 'unreachable' };
      }
    },
    retryAccess: () => {
      const session = latestSession;
      if (state.status !== 'unverified' || session === undefined) {
        return;
      }
      // async-iife: bootstrap -- the client already exists: the check reports through the state.
      void (async (): Promise<void> => {
        startCheck(await clientOf(), userOf(session));
      })();
    },
    getPendingReturn: () => pendingReturn,
    settleReturn: (target) => {
      if (pendingReturn === target) {
        pendingReturn = undefined;
        stateTopic.emit(undefined);
      }
    },
    signOut: async () => {
      setNotice(undefined);
      await signOutLocally(await clientOf());
    },
    dispose: async () => {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      revision += 1;
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
 * The `Authorization` header for a call to Sinopia's function: the admitted account's access token, or nothing when
 * there is none (the call then answers 401, which every caller already treats as unavailable).
 *
 * @returns Headers to spread into a request's headers.
 */
export const sinopiaAuthorization = async (): Promise<Readonly<Record<string, string>>> => {
  const token = await sinopiaSession().accessToken();
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
};
