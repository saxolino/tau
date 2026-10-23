import { useSyncExternalStore } from 'react';
import { sinopiaSession } from '#lib/sinopia-session.js';
import type { SinopiaSessionState } from '#lib/sinopia-session.js';

/**
 * SinopiaCAD: where this document's Sinopia session stands. The server render and hydration read the initial state
 * (`checking`, or `disabled` without a Sinopia project), so both agree; the stored session is read after hydration.
 *
 * @returns The session state.
 */
export const useSinopiaSession = (): SinopiaSessionState => {
  const session = sinopiaSession();
  return useSyncExternalStore(session.subscribe, session.getState, session.getInitialState);
};

const noReturn = (): undefined => undefined;

/**
 * SinopiaCAD: after the Google round trip, the address to go back to until the router has gone there. The server and
 * hydration never have one.
 *
 * @returns The same-origin path, or `undefined`.
 */
export const useSinopiaReturn = (): string | undefined => {
  const session = sinopiaSession();
  return useSyncExternalStore(session.subscribe, session.getPendingReturn, noReturn);
};
