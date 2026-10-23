/**
 * The Google round trip's way back (SinopiaCAD addition).
 *
 * Google's sign-in leaves SinopiaCAD and comes back through Supabase Auth to `redirectTo`, the page's origin and path,
 * with `?code=` (or an error) appended; everything else of the address is lost on the way. Before leaving, the address
 * the person stood on is remembered in this tab (`sessionStorage`, ten minutes, as Sinopia's `rememberAuthReturn`
 * does), and on the way back the page goes there again, so the code never stays in the address bar or in history.
 */

const returnKey = 'sinopiacad:auth-return';
const returnLifetime = 10 * 60_000;

/** What Supabase Auth appends to `redirectTo`: the PKCE code and its flow id, or an error. */
const callbackParameters = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'] as const;

type Address = Pick<URL, 'pathname' | 'search' | 'hash'>;
type Remembered = Readonly<{ path: string; expiresAt: number }>;

const isSameOriginPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');

/**
 * Remember where the person stands before leaving for Google.
 *
 * @param address - The current address (`window.location`).
 * @param now - The current time, in milliseconds.
 */
export const rememberSinopiaReturn = (address: Address, now = Date.now()): void => {
  const path = `${address.pathname}${address.search}${address.hash}`;
  if (!isSameOriginPath(path)) {
    return;
  }
  try {
    sessionStorage.setItem(returnKey, JSON.stringify({ path, expiresAt: now + returnLifetime } satisfies Remembered));
  } catch {
    /* Storage can be denied (private browsing): the way back then keeps the path and drops what followed it. */
  }
};

const readRemembered = (now: number): string | undefined => {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(returnKey) ?? 'null');
    if (typeof saved !== 'object' || saved === null) {
      return undefined;
    }
    const { path, expiresAt } = saved as Partial<Remembered>;
    const isFresh = typeof expiresAt === 'number' && expiresAt > now && expiresAt <= now + returnLifetime;
    return isFresh && isSameOriginPath(path) ? path : undefined;
  } catch {
    return undefined;
  }
};

const forgetRemembered = (): void => {
  try {
    sessionStorage.removeItem(returnKey);
  } catch {
    /* Nothing was stored. */
  }
};

const hashParameters = (url: URL): URLSearchParams => new URLSearchParams(url.hash.replace(/^#/, ''));

const carriesCallback = (url: URL): boolean => {
  const fromHash = hashParameters(url);
  return callbackParameters.some((name) => url.searchParams.has(name) || fromHash.has(name));
};

/**
 * Whether this page load is the way back from the Google round trip this tab started: Supabase Auth's parameters are
 * in the address and the tab remembered a return, or the PKCE verifier waits in storage. A `code` some other page put
 * in the address is left alone.
 *
 * @param url - The page's address.
 * @param verifierKey - Where supabase-js keeps the PKCE verifier (`<storage key>-code-verifier`).
 * @param now - The current time, in milliseconds.
 * @returns Whether to finish the round trip.
 */
export const isSinopiaAuthReturn = (url: URL, verifierKey: string, now = Date.now()): boolean => {
  if (!carriesCallback(url)) {
    return false;
  }
  if (readRemembered(now) !== undefined) {
    return true;
  }
  try {
    return localStorage.getItem(verifierKey) !== null;
  } catch {
    return false;
  }
};

/**
 * Where the page goes once the round trip is over, and the memory of it spent: the remembered address when it is the
 * page Google came back to, otherwise this address without Supabase Auth's parameters.
 *
 * @param url - The page's address after supabase-js read it.
 * @param now - The current time, in milliseconds.
 * @returns A same-origin path with its search and hash.
 */
export const takeSinopiaReturn = (url: URL, now = Date.now()): string => {
  const remembered = readRemembered(now);
  forgetRemembered();
  if (remembered !== undefined && new URL(remembered, url.origin).pathname === url.pathname) {
    return remembered;
  }
  const search = new URLSearchParams(url.search);
  for (const name of callbackParameters) {
    search.delete(name);
  }
  const query = search.toString();
  const fromHash = hashParameters(url);
  const keepsHash = !callbackParameters.some((name) => fromHash.has(name));
  return `${url.pathname}${query === '' ? '' : `?${query}`}${keepsHash ? url.hash : ''}`;
};
