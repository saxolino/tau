import { describe, expect, it } from 'vitest';
import type { CadAgentConfigInput } from '@taucad/chat';
import { agentHostClientConfig } from '#chat-clients/_internal/turn-body.js';
import type { ResolvedModel } from '#hooks/use-models.js';

const unresolvedModel: ResolvedModel = {
  id: 'sinopia-model',
  name: 'sinopia-model',
  family: 'unknown',
  provider: { id: 'unknown', name: 'unknown' },
  isResolved: false,
};

const agent = (language?: 'it' | 'en'): CadAgentConfigInput => ({
  profile: 'cad',
  execution: { kind: 'tau', model: 'sinopia-model' },
  ...(language === undefined ? {} : { language }),
  mode: 'agent',
  toolChoice: 'auto',
  testingEnabled: true,
});

// SinopiaCAD: the system prompt the browser host runs with names the interface language (UI-UX-SinopiaCAD §1.1).
describe('agentHostClientConfig', () => {
  it.each([
    ['it', 'Reply language: Italian'],
    ['en', 'Reply language: English'],
  ] as const)('should carry the %s interface language into the system prompt', (language, line) => {
    const config = agentHostClientConfig({ agent: agent(language), chatId: 'chat-1', resolvedModel: unresolvedModel });

    expect(config.systemPrompt).toContain(line);
  });

  it('should reply in Italian for a config that names no language', () => {
    const config = agentHostClientConfig({ agent: agent(), chatId: 'chat-1', resolvedModel: unresolvedModel });

    expect(config.systemPrompt).toContain('Reply language: Italian');
  });
});
