import { useCallback } from 'react';
import { Download, EllipsisVertical, Pencil } from 'lucide-react';
import { FloatingPanelMenuButton } from '#components/ui/floating-panel.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { useChatContext, useChatSelector } from '#hooks/use-chat.js';
import { useChatRecords } from '#hooks/use-chat-records.js';
import { useProject } from '#hooks/use-project.js';
import { useTranslation } from '#i18n/translate.js';
import { displayChatName } from '#routes/w.$workspace.$project/chat-display-name.js';
import { downloadBlob } from '@taucad/utils/file';
import { serializeTranscript } from '#utils/chat.utils.js';
import { toSnakeCase } from '#utils/string.utils.js';

/**
 * The chat menu: rename and export. Switching and archived conversations live in `ChatSwitcher`.
 *
 * @param props - `onRename` opens the header's inline editor.
 * @returns The ⋯ trigger and its menu.
 */
export function ChatHistorySettings({ onRename }: { readonly onRename: () => void }): React.ReactNode {
  const { chat, activeChatId } = useChatContext();
  const messages = useChatSelector((state) => state.messages);
  const { projectId } = useProject();
  const { chats } = useChatRecords(projectId);
  const { t } = useTranslation();
  const chatName = displayChatName(chats.find((c) => c.id === activeChatId)?.name, t);

  const handleExport = useCallback(() => {
    if (!chat) {
      return;
    }
    const transcript = serializeTranscript(messages, chatName);
    const blob = new Blob([transcript], {
      type: 'text/markdown;charset=utf-8',
    });
    const timestamp = new Date().toISOString().slice(0, 16).replaceAll(':', '-');
    const snakeName = toSnakeCase(chatName) || 'chat_transcript';
    downloadBlob(blob, `${snakeName}_${timestamp}.md`);
  }, [messages, chat, chatName]);

  return (
    <DropdownMenu modal={false}>
      <FloatingPanelMenuButton
        asChild
        tooltip={t('project.agent.chatOptions')}
        aria-label={t('project.agent.chatOptions')}
      >
        <DropdownMenuTrigger>
          <EllipsisVertical className='size-4' />
        </DropdownMenuTrigger>
      </FloatingPanelMenuButton>
      <DropdownMenuContent
        align='end'
        side='bottom'
        className='w-56'
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <DropdownMenuItem onSelect={onRename}>
          <Pencil />
          {t('project.agent.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!chat || messages.length === 0} onSelect={handleExport}>
          <Download />
          {t('project.agent.exportTranscript')}
        </DropdownMenuItem>
        {/* SinopiaCAD: no model name and no credits here (UI-UX-SinopiaCAD §1.3; credits wait for pricing). */}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
