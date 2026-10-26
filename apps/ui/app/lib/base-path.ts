/**
 * Where the app is served from (SinopiaCAD addition).
 *
 * The statically served build lives under `/cad` on sinopialab.com (`SINOPIACAD_BASE`, Vite `base` = `/cad/`); the
 * router's `basename` is the same path without the trailing slash. Everything the router builds (`<Link>`,
 * `navigate()`, loader redirects) already carries the basename; only hand-written addresses (public files, the
 * address bar, a path remembered from `location`) need these helpers. At the root (`/`, development and the other
 * builds) they are the identity.
 */

/** Vite's `base`, always with a trailing slash (`/` or `/cad/`). */
export const baseUrl = (): string => {
  const base: string = import.meta.env.BASE_URL;
  return base.endsWith('/') ? base : `${base}/`;
};

/**
 * A file of `public/` as the browser must ask for it.
 *
 * @param path - The file's path under `public/`, with or without the leading slash.
 * @returns The path including the base, e.g. `/cad/fonts/Inter.woff2`.
 */
export const publicAsset = (path: string): string => `${baseUrl()}${path.replace(/^\/+/u, '')}`;

/**
 * Take the router's basename off a path read from `location.pathname`, so it can go back to `navigate()` (which adds
 * the basename itself). A path outside the basename is returned unchanged.
 *
 * @param path - A same-origin path with its search and hash, e.g. `/cad/w/home/gear?chat=1`.
 * @param basename - The router's basename without the trailing slash (`''` or `/cad`).
 * @returns The path relative to the router, e.g. `/w/home/gear?chat=1`.
 */
export const stripBasename = (path: string, basename: string): string => {
  if (basename === '' || basename === '/') {
    return path;
  }
  if (path === basename) {
    return '/';
  }
  const rest = path.slice(basename.length);
  return path.startsWith(basename) && /^[/?#]/u.test(rest) ? (rest.startsWith('/') ? rest : `/${rest}`) : path;
};
