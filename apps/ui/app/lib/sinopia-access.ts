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
 * 3. Beta door (`BetaGate`, `useBetaStatus`, `get_my_beta_status()`): designers only; `needs_profile` and
 *    `waitlisted` stay out, `active` and `not_applicable` go on.
 * 4. Profession (`ProtectedRoute`, `needs_profession_selection()`): a Google account that still has to choose its
 *    profession goes to Sinopia's onboarding, unless the beta door has taken it (then the door decides).
 * 5. Terms (`TermsGate`, `user_consents` row `terms`): the current Terms are accepted.
 *
 * A read that fails never reads as a refusal. Sinopia then shows «Riprova» instead of its app (`sessionError`,
 * `BetaGateRetry`) and SinopiaCAD does the same; the one exception is Sinopia's own: when only the beta status cannot be
 * read, an account with Terms on file goes on as `not_applicable` (`statoBetaDaSmistare`, `BetaGate`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** What the check found: the account goes in, confirms its second factor, is sent to sinopialab.com, or is unknown. */
export type SinopiaAccess =
  | Readonly<{ verdict: 'allowed' }>
  | Readonly<{ verdict: 'second-factor' }>
  | Readonly<{ verdict: 'refused'; reason: SinopiaRefusal }>
  | Readonly<{ verdict: 'unverified' }>;

/** Why sinopialab.com would keep the account out of its app. */
export type SinopiaRefusal = 'no-profile' | 'beta-profile' | 'waitlisted' | 'profession' | 'terms';

/** A message for the sign-in screen, in Italian, with where to go to put things right. */
export type SinopiaNotice = Readonly<{ message: string; link?: Readonly<{ href: string; label: string }> }>;

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

const betaStates = new Set(['not_applicable', 'needs_profile', 'waitlisted', 'active']);
type BetaState = 'not_applicable' | 'needs_profile' | 'waitlisted' | 'active';

type Read<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>;

const allowed: SinopiaAccess = { verdict: 'allowed' };
const unverified: SinopiaAccess = { verdict: 'unverified' };
const refused = (reason: SinopiaRefusal): SinopiaAccess => ({ verdict: 'refused', reason });

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

/** `get_my_beta_status()`, validated as Sinopia's `readMyBetaStatus` and `betaRpc` validate it. */
const readBetaState = async (supabase: SupabaseClient): Promise<BetaState> => {
  const result = await supabase.rpc('get_my_beta_status');
  if (result.error !== null) {
    throw result.error;
  }
  const data: unknown = result.data;
  const state = fieldOf(data, 'state');
  if (
    fieldOf(data, 'success') === false ||
    typeof fieldOf(data, 'open') !== 'boolean' ||
    !betaStates.has(String(state))
  ) {
    throw new TypeError('get_my_beta_status answered an unknown state');
  }
  return state as BetaState;
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
 * Whether sinopialab.com would let this signed-in account into its app. Never throws.
 *
 * @param supabase - The client holding the account's session.
 * @param userId - The signed-in account.
 * @returns The verdict.
 */
export const checkSinopiaAccess = async (supabase: SupabaseClient, userId: string): Promise<SinopiaAccess> => {
  const secondFactor = await read('the second-factor level', async () => needsSecondFactor(supabase));
  if (!secondFactor.ok) {
    return unverified;
  }
  if (secondFactor.value) {
    return { verdict: 'second-factor' };
  }

  /* One round trip. The beta status is read alongside, but only a designer's counts, as only designers ask for it. */
  const [role, needsProfession, beta, terms] = await Promise.all([
    read('the profile', async () => readRole(supabase, userId)),
    read('the profession step', async () => readNeedsProfession(supabase)),
    read('the beta status', async () => readBetaState(supabase)),
    read('the Terms consent', async () => readTermsVersion(supabase, userId)),
  ]);

  if (!role.ok || !needsProfession.ok) {
    return unverified;
  }
  if (role.value === undefined) {
    return refused('no-profile');
  }

  let betaState: BetaState | undefined = 'not_applicable';
  if (role.value === 'designer') {
    betaState = beta.ok ? beta.value : terms.ok && terms.value !== undefined ? 'not_applicable' : undefined;
  }
  if (betaState === undefined) {
    return unverified;
  }
  if (betaState === 'needs_profile') {
    return refused('beta-profile');
  }
  if (betaState === 'waitlisted') {
    return refused('waitlisted');
  }
  if (needsProfession.value && betaState === 'not_applicable') {
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

const refusalMessages: Readonly<Record<SinopiaRefusal, string>> = {
  'no-profile':
    'Questo account non ha ancora un profilo Sinopia. Completa la registrazione su sinopialab.com, poi torna qui.',
  'beta-profile': 'Prima di usare SinopiaCAD completa l’iscrizione alla beta su sinopialab.com, poi torna qui.',
  waitlisted: 'Sei in lista d’attesa per la beta di Sinopia: SinopiaCAD si apre quando il tuo posto è attivo.',
  profession: 'Prima di usare SinopiaCAD scegli la tua professione su sinopialab.com, poi torna qui.',
  terms: 'Prima di usare SinopiaCAD accetta i Termini di servizio su sinopialab.com, poi torna qui.',
};

/**
 * What the sign-in screen says to an account SinopiaCAD has just signed out, and where to put it right.
 *
 * @param reason - Why sinopialab.com would keep the account out.
 * @returns The notice.
 */
export const sinopiaRefusalNotice = (reason: SinopiaRefusal): SinopiaNotice => ({
  message: refusalMessages[reason],
  link: { href: sinopiaAccessUrl, label: 'Vai a sinopialab.com' },
});
