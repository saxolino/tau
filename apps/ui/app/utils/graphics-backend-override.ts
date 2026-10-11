import type { GraphicsBackendPreference, ResolvedGraphicsBackend } from '@taucad/viewer/graphics/graphics-settings';
import { resolveGraphicsBackendPreference } from '@taucad/viewer/graphics/graphics-backend';
import { searchParameterName } from '#constants/search-parameter.constants.js';

/**
 * Query-param override for e2e and manual testing (whole-tab).
 *
 * Neither {@link useSearchParameter} nor a codec fits this one (D3): it is read
 * outside React, and its "absent" value is `undefined` rather than a member of
 * `GraphicsBackendPreference`, so a codec would need a sentinel that the domain
 * type does not have. What it does share is the name.
 */
const graphicsBackendQueryValues: readonly string[] = ['webgl', 'webgpu'] satisfies GraphicsBackendPreference[];

/**
 * Read `graphicsBackend` from the current URL (browser only).
 *
 * Validates against `GraphicsBackendPreference` tokens and returns undefined when absent / invalid.
 */
export function readGraphicsBackendQueryOverride(): GraphicsBackendPreference | undefined {
  const browserWindow = Reflect.get(globalThis, 'window') as Window | undefined;
  if (browserWindow === undefined) {
    return undefined;
  }

  const raw = new URLSearchParams(browserWindow.location.search).get(searchParameterName.graphicsBackend);
  return raw !== null && graphicsBackendQueryValues.includes(raw) ? (raw as GraphicsBackendPreference) : undefined;
}

/** The viewer's backend preference: the internal URL override, else the experimental flag. */
export function resolveViewerGraphicsBackendPreference(webGpuEnabled: boolean): GraphicsBackendPreference {
  return readGraphicsBackendQueryOverride() ?? (webGpuEnabled ? 'webgpu' : 'webgl');
}

/** Resolve the experimental viewer flag, with the internal URL override taking precedence. */
export function resolveViewerGraphicsBackend(webGpuEnabled: boolean, gpuAvailable: boolean): ResolvedGraphicsBackend {
  return resolveGraphicsBackendPreference(resolveViewerGraphicsBackendPreference(webGpuEnabled), gpuAvailable);
}
