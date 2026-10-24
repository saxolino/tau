import type { CadAgentExecution } from '@taucad/chat';

/**
 * The execution a SinopiaCAD chat runs with: its own model in this page's agent, never a daemon or another agent.
 * SinopiaCAD shows no agent or host picker, so a chat saved on one (the prototype ran Claude Code on a local Tau
 * daemon) would otherwise wait forever on a host the designer cannot see or change.
 *
 * @param stored - The chat's saved execution, if any.
 * @param fallback - The catalog's recommended execution in this page.
 * @returns The stored execution when it runs in this page, the fallback otherwise.
 */
export const designerExecution = (
  stored: CadAgentExecution | undefined,
  fallback: CadAgentExecution,
): CadAgentExecution => designerStoredExecution(stored) ?? fallback;

/**
 * A chat's or a queued message's saved execution as SinopiaCAD reads it: kept when it runs in this page's agent,
 * dropped otherwise so the catalog's recommended model takes over. Every reader of a saved execution goes through this.
 *
 * @param stored - The saved execution, if any.
 * @returns The saved execution, or `undefined` when it names a daemon or another agent.
 */
export const designerStoredExecution = (stored: CadAgentExecution | undefined): CadAgentExecution | undefined =>
  // A Tau execution without a host is this page's own agent; anything with a host is a daemon (or a desktop launcher).
  stored !== undefined && stored.kind === 'tau' && stored.hostId === undefined ? stored : undefined;
