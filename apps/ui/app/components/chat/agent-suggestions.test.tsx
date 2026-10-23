// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryComponentReference } from '@taucad/types';
import { AgentSuggestions } from '#components/chat/agent-suggestions.js';
import { setLanguage } from '#i18n/language.js';
const state = vi.hoisted(() => ({
  stone: false,
  selected: false,
  status: 'ready',
  submit: vi.fn().mockResolvedValue(undefined),
}));
const reference: GeometryComponentReference = {
  scheme: 'tau-cad',
  filePath: 'main.ts',
  componentId: 'stone',
  selector: '/nodes/0',
  label: 'Pietra',
  kind: 'part',
};
vi.mock('#hooks/use-selected-piece.js', () => ({
  useSelectedPiece: () =>
    state.selected ? { node: { name: state.stone ? 'pietra' : 'castone' }, reference } : undefined,
}));
vi.mock('#hooks/use-chat.js', () => ({
  useChatSelector: (select: (input: unknown) => unknown) =>
    select({ status: state.status, messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'Fatto' }] }] }),
}));
vi.mock('#chat-clients/use-cad-chat-client.js', () => ({ useCadChatClient: () => ({ submit: state.submit }) }));
beforeEach(() => {
  setLanguage('it');
  state.selected = false;
  state.stone = false;
  state.status = 'ready';
  state.submit.mockClear();
});
describe('agent suggestions', () => {
  it('should send a stone edit with the selected component reference', async () => {
    state.selected = true;
    state.stone = true;
    render(<AgentSuggestions />);
    fireEvent.click(screen.getByRole('button', { name: 'Portala a 12 × 5 mm' }));
    await waitFor(() => {
      expect(state.submit).toHaveBeenCalledExactlyOnceWith({
        text: 'Portala a 12 × 5 mm',
        references: [
          {
            resource: { kind: 'workspace-file', path: 'main.ts' },
            target: {
              kind: 'component',
              componentId: 'stone',
              selector: '/nodes/0',
              label: 'Pietra',
              componentKind: 'part',
            },
          },
        ],
      });
    });
  });
  it('should offer metal-specific changes and English general suggestions', () => {
    state.selected = true;
    const view = render(<AgentSuggestions />);
    expect(screen.getByRole('button', { name: 'Riduci lo spessore' })).toBeInTheDocument();
    state.selected = false;
    setLanguage('en');
    view.rerender(<AgentSuggestions />);
    expect(screen.getByRole('button', { name: 'Describe the pieces' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add four prongs' })).not.toBeInTheDocument();
  });
  it('should withhold suggestions while a turn runs', () => {
    state.status = 'streaming';
    render(<AgentSuggestions />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
