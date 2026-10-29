/**
 * Who may enter SinopiaCAD (SinopiaCAD addition): the Sinopia accounts sinopialab.com lets into its own app, and no
 * other.
 *
 * A Supabase session is not enough. Signing in with Google creates a brand-new auth user on first use, and Sinopia
 * keeps such an account out of its app until it has finished signing up. So after every sign-in SinopiaCAD asks
 * Sinopia's database, as the signed-in person and under its row-level security, the questions Sinopia's own gates ask
 * (Sinopia's sources named in brackets), in the same order:
 *
 * 1. Second factor (`MfaChallengeGate`, `verdictFromAssurance`): an account with a verified factor confirms it in this
 *    session (`aal2`) first; until then Sinopia's restrictive policies hide its rows.
 * 2. Profile (`authStore.fetchUserProfile`): `profiles.role` is an account role (`normalizePersistedRole`).
 * 3. Beta door (`BetaGate`, `get_my_beta_status()`): designers only. Here the pilot list (below) names who is in, so
 *    the door is not read.
 * 4. Profession (`ProtectedRoute`, `needs_profession_selection()`): a Google account that still has to choose its
 *    profession goes to Sinopia's onboarding.
 * 5. Terms (`TermsGate`, `user_consents` row `terms`): the current Terms are accepted.
 *
 * On top of Sinopia's gates, SinopiaCAD is a pilot: who is in it is the list of Sinopia's `sinopiacad` function
 * (`SINOPIACAD_ALLOWED_USERS`), and the CAD asks the function rather than deciding by itself (`checkSinopiaPilot`): an
 * account the list leaves out is `reserved` — the function would refuse its every call — and one it names goes on
 * whatever its role. Only where there is no function to ask does the old rule hold: administrators only
 * (`profiles.role` = `superadmin`). Fail-closed: a profile or a list that cannot be read is `unverified`, never
 * allowed.
 *
 * A read that fails never reads as a refusal. Sinopia then shows «Riprova» instead of its app (`sessionError`,
 * `BetaGateRetry`) and SinopiaCAD does the same; the one exception is Sinopia's own: when only the beta status cannot be
 * read, an account with Terms on file goes on as `not_applicable` (`statoBetaDaSmistare`, `BetaGate`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireClientEnvironment } from '#environment.config.js';

/**
 * What the check found: the account goes in, confirms its second factor, is sent to sinopialab.com, is kept out of the
 * reserved preview (`reserved`: a Sinopia account, but not an administrator), or is unknown.
 */
export type SinopiaAccess =
  | Readonly<{ verdict: 'allowed' }>
  | Readonly<{ verdict: 'second-factor' }>
  | Readonly<{ verdict: 'refused'; reason: SinopiaRefusal }>
  | Readonly<{ verdict: 'reserved' }>
  | Readonly<{ verdict: 'unverified' }>;

/** Why sinopialab.com would keep the account out of its app. */
export type SinopiaRefusal = 'no-profile' | 'beta-profile' | 'waitlisted' | 'profession' | 'terms';

/**
 * Every sentence the sign-in screens can show for a failure or a refusal, as a stable code: the screen writes it in the
 * language of the moment (`auth.messages.<code>`), so a language switch re-renders it.
 */
export type SinopiaMessageCode =
  | SinopiaRefusalMessage
  | 'unreachable'
  | 'tooMany'
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'banned'
  | 'signInFailed'
  | 'googleDisabled'
  | 'googleFailed'
  | 'secondFactorMissing'
  | 'secondFactorInvalid'
  | 'sessionEnded';

/** The codes of the messages that turn an account away. */
export type SinopiaRefusalMessage = 'noProfile' | 'betaProfile' | 'waitlisted' | 'profession' | 'terms';

/** A message for the sign-in screen, as a code, with where to go to put things right (the screen words the link). */
export type SinopiaNotice = Readonly<{
  code: SinopiaMessageCode;
  link?: Readonly<{ href: string }>;
}>;

/** Sinopia's sign-in page: once signed in there, Sinopia takes the account to whatever step it still owes. */
export const sinopiaAccessUrl = 'https://sinopialab.com/auth';

/**
 * The Terms version Sinopia asks for (`TERMS_CONSENT_VERSION` in Sinopia's `consent.service.ts`); keep the two in step.
 * Versions are ISO dates, so a version accepted later than this one also counts: when Sinopia moves on first, nobody
 * who accepted the new Terms is turned away here.
 */
export const sinopiaTermsVersion = '2026-08-17';

/** Sinopia's account roles (`normalizePersistedRole` in Sinopia's `account-roles.ts`), with the legacy names it maps. */
const accountRoles = new Set([
  'designer',
  'buyer',
  'commercial',
  'supplier',
  'manufacturer',
  'supervisor',
  'superadmin',
]);
const legacyRoles: Readonly<Record<string, string>> = {
  pro: 'designer',
  user: 'designer',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Sinopia's persisted role names are snake_case.
  pattern_maker: 'designer',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Sinopia's persisted role names are snake_case.
  project_manager: 'supervisor',
};

type Read<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>;

const allowed: SinopiaAccess = { verdict: 'allowed' };
const unverified: SinopiaAccess = { verdict: 'unverified' };
const reserved: SinopiaAccess = { verdict: 'reserved' };
const refused = (reason: SinopiaRefusal): SinopiaAccess => ({
  verdict: 'refused',
  reason,
});

const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>)[key] : undefined;

/**
 * Run one read; a failure is logged with its raw error and answered as unknown, never as a refusal.
 *
 * @param what - What is being read, for the log.
 * @param run - The read; it throws when the answer is missing or malformed.
 * @returns The value, or `{ ok: false }`.
 */
const read = async <T>(what: string, run: () => Promise<T>): Promise<Read<T>> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    console.error(`[sinopia] could not read ${what}`, error);
    return { ok: false };
  }
};

/** Sinopia's `needsSessionChallenge`: a verified factor on the account (`nextLevel` aal2) and this session still aal1. */
const needsSecondFactor = async (supabase: SupabaseClient): Promise<boolean> => {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error !== null) {
    throw error;
  }
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
};

/** `profiles.role` normalised as Sinopia does; `undefined` when there is no row or no account role. */
const readRole = async (supabase: SupabaseClient, userId: string): Promise<string | undefined> => {
  const { data, error } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error !== null) {
    throw error;
  }
  const role = fieldOf(data, 'role');
  if (typeof role !== 'string') {
    return undefined;
  }
  return accountRoles.has(role) ? role : legacyRoles[role];
};

const readNeedsProfession = async (supabase: SupabaseClient): Promise<boolean> => {
  const result = await supabase.rpc('needs_profession_selection');
  if (result.error !== null) {
    throw result.error;
  }
  const data: unknown = result.data;
  if (typeof data !== 'boolean') {
    throw new TypeError('needs_profession_selection answered without a boolean');
  }
  return data;
};

/** The accepted Terms version, whatever it is; `undefined` when the account never accepted them. */
const readTermsVersion = async (supabase: SupabaseClient, userId: string): Promise<string | undefined> => {
  const { data, error } = await supabase
    .from('user_consents')
    .select('version')
    .eq('user_id', userId)
    .eq('consent_key', 'terms')
    .maybeSingle();
  if (error !== null) {
    throw error;
  }
  const version = fieldOf(data, 'version');
  return typeof version === 'string' && version !== '' ? version : undefined;
};

/**
 * What the `sinopiacad` function says of the account: named in its pilot list, left out of it, or no clear answer.
 *
 * @public
 */
export type SinopiaPilotVerdict = 'allowed' | 'reserved' | 'unknown';

/**
 * The function's refusal of an account outside the pilot list: `CAD_PILOT_NOT_ALLOWED`, and the code it used before,
 * `BILLING_ACCOUNT_RESTRICTED`, until the new function is published everywhere.
 */
const pilotRefusals = new Set(['CAD_PILOT_NOT_ALLOWED', 'BILLING_ACCOUNT_RESTRICTED']);

/**
 * Ask Sinopia's `sinopiacad` function whether the account is in its pilot list, with the cheapest call it has: the model
 * catalog (`GET /v1/models`, no credits, no rate limit). 200 is the list naming the account; 403 with the pilot refusal
 * is the list leaving it out; anything else is no answer. Without the function's address there is no list to ask:
 * `undefined`. Never throws.
 *
 * @param token - The signed-in account's access token.
 * @param options - The function's base URL and `fetch`, for tests; the host's `TAU_API_URL` otherwise.
 * @returns The verdict, or `undefined` when there is no function to ask.
 */
export const checkSinopiaPilot = async (
  token: string,
  options: Readonly<{ base?: string; fetch?: typeof fetch }> = {},
): Promise<SinopiaPilotVerdict | undefined> => {
  let base = options.base;
  if (base === undefined) {
    try {
      base = requireClientEnvironment('TAU_API_URL');
    } catch {
      return undefined;
    }
  }
  try {
    const response = await (options.fetch ?? globalThis.fetch)(`${base.replace(/\/$/u, '')}/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      return 'allowed';
    }
    const body: unknown = await response.json().catch(() => undefined);
    const type = fieldOf(fieldOf(body, 'error'), 'type');
    if (response.status === 403 && typeof type === 'string' && pilotRefusals.has(type)) {
      return 'reserved';
    }
    console.error('[sinopia] could not read the pilot list', response.status, type);
    return 'unknown';
  } catch (error) {
    console.error('[sinopia] could not read the pilot list', error);
    return 'unknown';
  }
};

/**
 * Whether sinopialab.com would let this signed-in account into its app, and the pilot list into SinopiaCAD. Never
 * throws.
 *
 * @param supabase - The client holding the account's session.
 * @param userId - The signed-in account.
 * @param pilot - Asks the function's pilot list (`checkSinopiaPilot`); without it, or when it has no function to ask,
 *   administrators only.
 * @returns The verdict.
 */
export const checkSinopiaAccess = async (
  supabase: SupabaseClient,
  userId: string,
  pilot?: () => Promise<SinopiaPilotVerdict | undefined>,
): Promise<SinopiaAccess> => {
  const secondFactor = await read('the second-factor level', async () => needsSecondFactor(supabase));
  if (!secondFactor.ok) {
    return unverified;
  }
  if (secondFactor.value) {
    return { verdict: 'second-factor' };
  }

  /* One round trip. */
  const [role, needsProfession, terms, list] = await Promise.all([
    read('the profile', async () => readRole(supabase, userId)),
    read('the profession step', async () => readNeedsProfession(supabase)),
    read('the Terms consent', async () => readTermsVersion(supabase, userId)),
    pilot === undefined ? undefined : pilot().catch((): SinopiaPilotVerdict => 'unknown'),
  ]);

  if (!role.ok || !needsProfession.ok) {
    return unverified;
  }
  if (list === undefined) {
    /* No pilot list to ask (SinopiaCAD addition): administrators only, whatever the other gates would say. */
    if (role.value !== 'superadmin') {
      return reserved;
    }
  } else {
    /* The pilot list decides who is in (SinopiaCAD addition); the CAD never contradicts it. */
    if (list === 'unknown') {
      return unverified;
    }
    if (list === 'reserved') {
      return reserved;
    }
    /* Named in the list but without an account role: Sinopia itself would send it to complete its profile. */
    if (role.value === undefined) {
      return refused('no-profile');
    }
  }
  /* The profession step applies to every account (`ProtectedRoute`); the beta door is the pilot list's to decide. */
  if (needsProfession.value) {
    return refused('profession');
  }

  if (!terms.ok) {
    return unverified;
  }
  if (terms.value === undefined || terms.value < sinopiaTermsVersion) {
    return refused('terms');
  }
  return allowed;
};

const refusalMessages: Readonly<Record<SinopiaRefusal, SinopiaRefusalMessage>> = {
  'no-profile': 'noProfile',
  'beta-profile': 'betaProfile',
  waitlisted: 'waitlisted',
  profession: 'profession',
  terms: 'terms',
};

/**
 * What the sign-in screen says to an account SinopiaCAD has just signed out, and where to put it right.
 *
 * @param reason - Why sinopialab.com would keep the account out.
 * @returns The notice.
 */
export const sinopiaRefusalNotice = (reason: SinopiaRefusal): SinopiaNotice => ({
  code: refusalMessages[reason],
  link: { href: sinopiaAccessUrl },
});
