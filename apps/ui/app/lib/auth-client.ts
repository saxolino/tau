import { createAuthClient } from 'better-auth/react';
import { apiKeyClient } from '@better-auth/api-key/client';
import { magicLinkClient, deviceAuthorizationClient } from 'better-auth/client/plugins';
import { requireClientEnvironment } from '#environment.config.js';
import { readSinopiaConfig } from '#lib/sinopia-session.js';

const runtimeAuthFetch: typeof globalThis.fetch = async (input, init) => {
  /* SinopiaCAD: Sinopia's session (`#lib/sinopia-session`) signs people in, and `TAU_API_URL` is Sinopia's function,
   * which serves no Tau accounts. Better Auth stays wired but inert: its calls fail here, as against an unreachable
   * API, so its session reads as undetermined and nothing reaches the function. */
  if (readSinopiaConfig() !== undefined) {
    throw new TypeError('SinopiaCAD signs in with Sinopia, not with a SinopiaCAD account.');
  }
  const apiBaseURL = requireClientEnvironment('TAU_API_URL').replace(/\/$/u, '');
  const requestUrl = new URL(input instanceof Request ? input.url : input);
  const runtimeUrl = `${apiBaseURL}${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`;
  const runtimeInput = input instanceof Request ? new Request(runtimeUrl, input) : runtimeUrl;
  return globalThis.fetch(runtimeInput, init);
};

export const authClient = createAuthClient({
  // Better Auth requires an absolute base URL at construction, then delegates
  // every real request to runtimeAuthFetch where the injected host is resolved.
  baseURL: 'https://window-env.invalid/v1/auth',
  fetchOptions: { customFetchImpl: runtimeAuthFetch },
  plugins: [magicLinkClient(), apiKeyClient(), deviceAuthorizationClient()],
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
});
