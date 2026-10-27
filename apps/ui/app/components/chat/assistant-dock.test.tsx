import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { AssistantDockPosition } from '#lib/assistant-dock-position.js';

type Message = { role: string; parts: Array<{ type: string; text?: string }> };
const chat = vi.hoisted(() => ({
  status: 'ready' as string,
  messages: [] as Message[],
  tray: undefined as
    | { modello: { pieces: unknown[] }; sessione?: { id: number; stato: string }; modifica?: { id: number } }
    | undefined,
}));
const submit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'project-1' }) }));
vi.mock('#hooks/use-chat.js', () => ({
  useChatContext: () => ({ activeChatId: 'chat-1' }),
  useChatSelector: <T,>(
    selector: (state: { status: string; messages: Message[]; messageOrder: string[]; turnGroups: unknown[] }) => T,
  ): T =>
    selector({
      status: chat.status,
      messages: chat.messages,
      messageOrder: chat.messages.map((_, index) => `m${index}`),
      turnGroups: [],
    }),
}));
vi.mock('#chat-clients/use-cad-chat-client.js', () => ({ useCadChatClient: () => ({ submit }) }));
vi.mock('#hooks/use-inspector-selection.js', () => ({
  useInspectorSelection: () => ({ selection: { kind: 'model', pieceCount: 0 }, piece: undefined }),
}));
vi.mock('#components/chat/chat-textarea.js', () => ({
  ChatTextarea: () => <textarea aria-label='Scrivi o detta una modifica…' />,
}));
vi.mock('#components/chat/attachment-preview.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  chatAttachmentDirectories: () => ({}),
}));
vi.mock('#components/chat/chat-questions-context.js', () => ({
  ChatQuestionsProvider: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('#components/chat/assistant-suggestions.js', () => ({
  AssistantComposerProvider: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
  AssistantContextChips: () => <div data-testid='chips' />,
  AssistantStarts: () => <div data-testid='starts'>Da dove partiamo?</div>,
}));
vi.mock('#components/chat/assistant-tray.js', () => ({
  AssistantTrayProvider: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
  AssistantTrayCard: () => <div data-testid='tray-card' />,
  AssistantBrief: () => <div data-testid='brief'>Il modello</div>,
  AssistantNextSteps: () => <div data-testid='next-steps' />,
  useAssistantTray: () => chat.tray,
}));
vi.mock('#components/chat/turn-summary-card.js', () => ({ TurnModelSummary: () => <div data-testid='turn' /> }));
vi.mock('#routes/w.$workspace.$project/chat-history.js', () => ({
  ChatHistory: ({ setIsExpanded }: { readonly setIsExpanded: (value: boolean) => void }) => (
    <div data-testid='conversation'>
      <button
        type='button'
        onClick={() => {
          setIsExpanded(false);
        }}
      >
        Riduci l’assistente
      </button>
    </div>
  ),
}));
vi.mock('#routes/w.$workspace.$project/focused-chat-gate.js', () => ({
  ChatHistoryGate: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
}));

// The jsdom runtime has no PointerEvent: the drag test needs `pointerId` and `clientY` on the events it fires.
class TestPointerEvent extends MouseEvent {
  public readonly pointerId: number;
  public constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}
Object.assign(globalThis, { PointerEvent: TestPointerEvent });

const { AssistantDock } = await import('#components/chat/assistant-dock.js');

const onPositionChange = vi.fn<(position: AssistantDockPosition) => void>();
const onExpandedChange = vi.fn<(expanded: boolean) => void>();

const renderDock = (position: AssistantDockPosition) =>
  render(
    <TooltipProvider>
      <AssistantDock
        position={position}
        onPositionChange={onPositionChange}
        onExpandedChange={onExpandedChange}
        keyHint='⌃J'
      />
    </TooltipProvider>,
  );

const dockAt = (position: AssistantDockPosition) => (
  <TooltipProvider>
    <AssistantDock
      position={position}
      onPositionChange={onPositionChange}
      onExpandedChange={onExpandedChange}
      keyHint='⌃J'
    />
  </TooltipProvider>
);

const answer = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const line = (): HTMLElement =>
  screen.getByRole('button', { name: /Mostra le proposte|Riduci l’assistente alla linea/u });

beforeEach(() => {
  setLanguage('it');
  vi.clearAllMocks();
  chat.status = 'ready';
  chat.messages = [];
  chat.tray = { modello: { pieces: [{}] } };
});
afterEach(() => {
  resetLanguageForTests();
});

describe('AssistantDock', () => {
  it('should keep the composer at every height, and hide only the body at the line', () => {
    const { rerender } = renderDock('open');
    const strip = screen.getByRole('region', { name: 'Assistente' });
    expect(strip).toHaveAttribute('data-position', 'open');
    expect(within(strip).getByRole('textbox', { name: 'Scrivi o detta una modifica…' })).toBeInTheDocument();
    expect(screen.getByTestId('brief')).toBeInTheDocument();
    expect(line()).toHaveAttribute('aria-expanded', 'true');

    rerender(dockAt('line'));
    expect(screen.getByRole('region', { name: 'Assistente' })).toHaveAttribute('data-position', 'line');
    expect(screen.getByRole('textbox', { name: 'Scrivi o detta una modifica…' })).toBeInTheDocument();
    expect(screen.queryByTestId('brief')).not.toBeInTheDocument();
    expect(line()).toHaveAttribute('aria-expanded', 'false');
    expect(line()).toHaveAccessibleName('Mostra le proposte dell’assistente');
  });

  it('should open and close the body with a click on the line, and open the conversation with its button', async () => {
    const user = userEvent.setup();
    const { rerender } = renderDock('line');
    await user.click(line());
    expect(onPositionChange).toHaveBeenLastCalledWith('open');
    rerender(dockAt('open'));
    await user.click(line());
    expect(onPositionChange).toHaveBeenLastCalledWith('line');
    const expand = screen.getByRole('button', { name: 'Apri la conversazione' });
    expect(expand).toHaveAttribute('aria-keyshortcuts', 'Control+J');
    await user.click(expand);
    expect(onPositionChange).toHaveBeenLastCalledWith('tall');
  });

  it('should grow when the line is dragged up and shrink when it is dragged down', () => {
    const { rerender } = renderDock('line');
    const handle = line();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 290 });
    expect(onPositionChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 260 });
    expect(onPositionChange).toHaveBeenLastCalledWith('open');
    fireEvent.pointerUp(handle, { pointerId: 1 });
    // The click the same gesture ends with is not a toggle.
    fireEvent.click(line());
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    rerender(dockAt('open'));
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientY: 300 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 340 });
    expect(onPositionChange).toHaveBeenLastCalledWith('line');
    fireEvent.pointerUp(handle, { pointerId: 2 });
  });

  it('should say on the line what the assistant is doing: working, answered, a new proposal, a change', () => {
    const { container, rerender } = renderDock('open');
    const status = (): HTMLElement => container.querySelector<HTMLElement>('[data-slot=assistant-line-status]')!;
    const dot = (): HTMLElement => container.querySelector<HTMLElement>('[data-slot=assistant-dot]')!;
    expect(status()).toHaveAttribute('role', 'status');
    expect(status()).toHaveTextContent('');
    expect(dot()).toHaveAttribute('data-state', 'idle');

    // Everything shown while the body is open counts as seen: the line then rests.
    chat.messages = [answer('Ho allargato il telaio.')];
    rerender(dockAt('open'));
    rerender(dockAt('line'));
    expect(dot()).toHaveAttribute('data-state', 'idle');
    expect(status()).toHaveTextContent('Ho allargato il telaio.');

    chat.status = 'streaming';
    rerender(dockAt('line'));
    expect(dot()).toHaveAttribute('data-state', 'working');
    expect(status()).toHaveTextContent('Al lavoro…');

    chat.status = 'ready';
    chat.messages = [answer('Ho allargato il telaio.'), answer('Ho stretto l’ardiglione.')];
    rerender(dockAt('line'));
    expect(dot()).toHaveAttribute('data-state', 'answered');
    expect(status()).toHaveTextContent('Ha risposto · Ho stretto l’ardiglione.');

    chat.tray = { modello: { pieces: [{}] }, sessione: { id: 7, stato: 'pronto' } };
    rerender(dockAt('line'));
    expect(dot()).toHaveAttribute('data-state', 'proposal');
    expect(status()).toHaveTextContent('Nuova ipotesi');

    chat.tray = { modello: { pieces: [{}] }, modifica: { id: 3 } };
    rerender(dockAt('line'));
    expect(dot()).toHaveAttribute('data-state', 'change');
    expect(status()).toHaveTextContent('Ha fatto una modifica');

    // Opening the body reads it all; back at the line, nothing is new any more.
    rerender(dockAt('open'));
    rerender(dockAt('line'));
    expect(dot()).toHaveAttribute('data-state', 'idle');
  });

  it('should show the conversation when tall and hand its collapse back to the owner', async () => {
    renderDock('tall');
    expect(screen.getByTestId('conversation')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Assistente' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Riduci l’assistente' }));
    expect(onExpandedChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('should write the line in English too', () => {
    setLanguage('en');
    chat.status = 'streaming';
    const { container } = renderDock('line');
    expect(screen.getByRole('button', { name: 'Show the assistant’s proposals' })).toBeInTheDocument();
    expect(container.querySelector('[data-slot=assistant-line-status]')).toHaveTextContent('Working…');
  });
});
