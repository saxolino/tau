import { describe, expect, it } from 'vitest';
import type { AgentHostPlacementTarget } from '#lib/agent-host-placement.js';
import { hiddenExternalAgentIds, withoutHiddenExternalAgents } from '#lib/sinopia-agents.js';

const claudeCode = { id: 'claude', displayName: 'Claude Code', models: [{ id: 'sonnet', name: 'Sonnet' }] };
const codex = { id: 'codex', displayName: 'Codex', models: [] };
const grokBuild = { id: 'grok', displayName: 'Grok Build', models: [] };

const host = (externalAgents?: AgentHostPlacementTarget['externalAgents']): AgentHostPlacementTarget => ({
  hostId: 'origin',
  rung: 1,
  label: 'studio-mini',
  workspaceRoot: '/Users/x/collana',
  online: true,
  ...(externalAgents === undefined ? {} : { externalAgents }),
});

describe('withoutHiddenExternalAgents', () => {
  it('offers Claude Code and leaves Codex and Grok Build out', () => {
    expect(withoutHiddenExternalAgents(host([claudeCode, codex, grokBuild]))).toEqual(host([claudeCode]));
    expect([...hiddenExternalAgentIds]).toEqual(['codex', 'grok']);
  });

  it('drops the agent list when only hidden agents were found', () => {
    expect(withoutHiddenExternalAgents(host([codex, grokBuild]))).toEqual(host());
    expect(withoutHiddenExternalAgents(host([codex]))).not.toHaveProperty('externalAgents');
  });

  it('keeps a host that offers nothing hidden as it is', () => {
    const offering = host([claudeCode]);
    expect(withoutHiddenExternalAgents(offering)).toBe(offering);
    const bare = host();
    expect(withoutHiddenExternalAgents(bare)).toBe(bare);
  });
});
