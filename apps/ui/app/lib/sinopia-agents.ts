import type { AgentHostPlacementTarget } from '#lib/agent-host-placement.js';

/**
 * External agents SinopiaCAD leaves out of its pickers. Hosts still discover and can run them; SinopiaCAD offers its
 * own agent and Claude Code.
 */
export const hiddenExternalAgentIds: ReadonlySet<string> = new Set(['codex', 'grok']);

/**
 * A placement target without the external agents SinopiaCAD does not offer.
 *
 * @param target - A discovered placement target.
 * @returns The same target when it offers none of them; otherwise a copy without them, and without
 *   `externalAgents` once none remain.
 */
export const withoutHiddenExternalAgents = (target: AgentHostPlacementTarget): AgentHostPlacementTarget => {
  const agents = target.externalAgents;
  if (agents === undefined) {
    return target;
  }
  const offered = agents.filter((agent) => !hiddenExternalAgentIds.has(agent.id));
  if (offered.length === agents.length) {
    return target;
  }
  const { externalAgents: _hidden, ...rest } = target;
  return offered.length > 0 ? { ...rest, externalAgents: offered } : rest;
};
