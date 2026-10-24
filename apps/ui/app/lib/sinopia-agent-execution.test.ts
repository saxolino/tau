import { describe, expect, it } from 'vitest';
import type { CadAgentExecution } from '@taucad/chat';
import { designerExecution, designerStoredExecution } from '#lib/sinopia-agent-execution.js';

const browserTau: CadAgentExecution = { kind: 'tau', model: 'gpt-6-astra' };

describe('designerExecution', () => {
  it('runs a chat saved on a local daemon (the prototype’s Claude Code on 127.0.0.1:7180) in the page’s own agent', () => {
    const stored = {
      kind: 'acp',
      agentId: 'claude-code',
      hostId: 'loopback:http://127.0.0.1:7180',
    } as unknown as CadAgentExecution;

    expect(designerExecution(stored, browserTau)).toBe(browserTau);
  });

  it('keeps a Tau model on a daemon off the daemon too, since SinopiaCAD offers no way back', () => {
    const stored = { kind: 'tau', model: 'gpt-6.1-sol', hostId: 'loopback:http://127.0.0.1:7180' } as CadAgentExecution;

    expect(designerExecution(stored, browserTau)).toBe(browserTau);
  });

  it('keeps a chat’s own in-browser model and falls back when none is stored', () => {
    const stored: CadAgentExecution = { kind: 'tau', model: 'gpt-6.1-sol' };

    expect(designerExecution(stored, browserTau)).toBe(stored);
    expect(designerExecution(undefined, browserTau)).toBe(browserTau);
  });
});

describe('designerStoredExecution', () => {
  it('drops a saved daemon execution so the recommended model takes over, and keeps an in-page one', () => {
    const daemon = { kind: 'tau', model: 'gpt-6.1-sol', hostId: 'loopback:http://127.0.0.1:7180' } as CadAgentExecution;

    expect(designerStoredExecution(daemon)).toBeUndefined();
    expect(designerStoredExecution(browserTau)).toBe(browserTau);
    expect(designerStoredExecution(undefined)).toBeUndefined();
  });
});
