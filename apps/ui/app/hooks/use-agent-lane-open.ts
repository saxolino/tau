import { cookieName } from '#constants/cookie.constants.js';
import { metaConfig } from '#constants/meta.constants.js';
import { store, useCookie } from '#hooks/use-cookie.js';

/** The agent lane starts open, as it does on a new project. */
const isAgentLaneOpenByDefault = true;

const storageName = `${metaConfig.cookiePrefix}${cookieName.chatOpLane}`;

/**
 * Whether the agent lane is open on this device, as the home shows it. The home's toggle and ⌃C write it, and so does
 * every project page's toggle, so leaving a project with the agent hidden comes home to a hidden agent too. A project
 * page itself keeps its own lane state with the project.
 *
 * @returns The remembered state and its setter.
 */
// oxlint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- the `useCookie` tuple, inferred
export const useAgentLaneOpen = () => useCookie<boolean>(cookieName.chatOpLane, isAgentLaneOpenByDefault);

/**
 * Record the agent lane's state from outside React, where a project page opens or closes it.
 *
 * @param isOpen - Whether the lane is now open.
 */
export const rememberAgentLaneOpen = (isOpen: boolean): void => {
  store.update(storageName, isOpen);
};
