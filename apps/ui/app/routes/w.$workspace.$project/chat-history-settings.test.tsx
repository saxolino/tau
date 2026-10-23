// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { ReactNode } from 'react';
import type { CombinedChatState } from '#hooks/use-chat.js';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { MemoryRouter, useLocation } from 'react-router';

type ChatState = {
  chat: { messages: unknown[] } | undefined;
  activeChatId: string;
  messages: CombinedChatState['messages'];
};
const chatState = vi.hoisted((): ChatState => ({ chat: { messages: [] }, activeChatId: 'chat_active', messages: [] }));
const downloadBlob = vi.fn();
const serializeTranscript = vi.fn(() => '# transcript');
const chats = [{ id: 'chat_active', name: 'Bracket design' }];

vi.mock('#hooks/use-chat.js', () => ({
  useChatContext: () => ({ chat: chatState.chat, activeChatId: chatState.activeChatId }),
  useChatSelector: <Selection,>(selector: (state: Pick<CombinedChatState, 'messages'>) => Selection): Selection =>
    selector({ messages: chatState.messages }),
}));
vi.mock('#hooks/use-project.js', () => ({
  useProject: () => ({ projectId: 'proj_one' }),
}));
vi.mock('#hooks/use-chats.js', () => ({
  useChats: () => ({ chats }),
}));
vi.mock('#hooks/use-chat-records.js', () => ({
  useChatRecords: () => ({ chats, isLoading: false, error: undefined }),
}));
vi.mock('@taucad/utils/file', () => ({ downloadBlob }));
vi.mock('#utils/chat.utils.js', () => ({ serializeTranscript }));

const { ChatHistorySettings } = await import('#routes/w.$workspace.$project/chat-history-settings.js');

function renderMenu(onRename = vi.fn()): { readonly onRename: ReturnType<typeof vi.fn> } {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <MemoryRouter initialEntries={['/?chat=chat_active&workbench=share']}>
      <TooltipProvider>{children}</TooltipProvider>
    </MemoryRouter>
  );
  render(
    <>
      <ChatHistorySettings onRename={onRename} />
      <Location />
    </>,
    { wrapper },
  );
  return { onRename };
}

function Location(): React.JSX.Element {
  return <output aria-label='Current URL'>{useLocation().search}</output>;
}

describe('ChatHistorySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatState.chat = { messages: [] };
    chatState.messages = [];
    chatState.activeChatId = 'chat_active';
  });

  afterEach(() => {
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });

  // SinopiaCAD: no model name and no credits in the menu (UI-UX-SinopiaCAD §1.3).
  it.each([
    ['it', 'Opzioni della conversazione', ['Rinomina', 'Scarica la conversazione', 'Conversazioni precedenti']],
    ['en', 'Conversation options', ['Rename', 'Download the conversation', 'Earlier conversations']],
  ] as const)(
    'should open a menu of Rename, Download and earlier conversations in %s, and nothing else',
    async (language, trigger, names) => {
      setLanguage(language);
      const user = userEvent.setup();
      renderMenu();

      await user.click(screen.getByRole('button', { name: trigger }));

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(names);
      expect(screen.getByRole('menu')).not.toHaveTextContent(/credit|crediti|runs on|model/iu);
    },
  );

  it('opens the project archive while preserving the current chat and other query state', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Conversation options' }));
    const menu = screen.getByRole('menu');
    expect(menu.querySelector('[role=separator]')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Earlier conversations' }));
    expect(screen.getByRole('status', { name: 'Current URL' })).toHaveTextContent(
      'chat=chat_active&workbench=share&archivedChats=1',
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('should hand Rename to the header and keep Export disabled with no messages', async () => {
    const user = userEvent.setup();
    chatState.chat = { messages: [{ id: 'stale-sdk-message' }] };
    const { onRename } = renderMenu();

    await user.click(screen.getByRole('button', { name: 'Conversation options' }));
    expect(screen.getByRole('menuitem', { name: 'Download the conversation' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledOnce();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('should export a transcript named after the chat once it has messages', async () => {
    const user = userEvent.setup();
    chatState.messages = [{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Authoritative history' }] }];
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Conversation options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download the conversation' }));

    expect(serializeTranscript).toHaveBeenCalledExactlyOnceWith(chatState.messages, 'Bracket design');
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^bracket_design_.*\.md$/));
  });
});
