import { useCallback } from 'react';
import { Archive, Download, EllipsisVertical, Pencil } from 'lucide-react';
import { FloatingPanelMenuButton } from '#components/ui/floating-panel.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { useChatContext, useChatSelector } from '#hooks/use-chat.js';
import { useChatRecords } from '#hooks/use-chat-records.js';
import { useProject } from '#hooks/use-project.js';
import { useTranslation } from '#i18n/translate.js';
import { downloadBlob } from '@taucad/utils/file';
import { serializeTranscript } from '#utils/chat.utils.js';
import { toSnakeCase } from '#utils/string.utils.js';
import { useSearchParameter } from '#hooks/use-search-parameter.js';
import { searchParameterName } from '#constants/search-parameter.constants.js';
import { flagParameter } from '#utils/search-parameter.codecs.js';

/**
 * The chat menu: rename, export, then the chat's activity, model and credits as
 * a read-only block.
 *
 * @param props - `onRename` opens the header's inline editor.
 * @returns The ⋯ trigger and its menu.
 */
export function ChatHistorySettings({ onRename }: { readonly onRename: () => void }): React.ReactNode {
  const { chat, activeChatId } = useChatContext();
  const messages = useChatSelector((state) => state.messages);
  const { projectId } = useProject();
  const [, setArchivedChats] = useSearchParameter(searchParameterName.archivedChats, flagParameter, {
    history: 'push',
  });
  const { chats } = useChatRecords(projectId);
  const { t } = useTranslation();
  const chatName = chats.find((c) => c.id === activeChatId)?.name ?? t('project.agent.chatFallback');

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
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            setArchivedChats(true);
          }}
        >
          <Archive />
          {t('project.agent.archivedChats')}
        </DropdownMenuItem>
        {/* SinopiaCAD: no model name and no credits here (UI-UX-SinopiaCAD §1.3; credits wait for pricing). */}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
