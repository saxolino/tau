import { useMemo } from 'react';
import { Link } from 'react-router';
import { Check, History } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { FloatingPanelMenuButton } from '#components/ui/floating-panel.js';
import { useChatContext } from '#hooks/use-chat.js';
import { useChatRecords } from '#hooks/use-chat-records.js';
import { useProject } from '#hooks/use-project.js';
import { useProjectSlugs } from '#hooks/use-project-slug-route.js';
import { useTranslation } from '#i18n/translate.js';
import { useSearchParameter } from '#hooks/use-search-parameter.js';
import { flagParameter } from '#utils/search-parameter.codecs.js';
import { searchParameterName } from '#constants/search-parameter.constants.js';
import { compareChatsByRecency } from '#utils/chat-recency.utils.js';
import { projectChatUrl } from '#utils/project-url.utils.js';
import { displayChatName } from '#routes/w.$workspace.$project/chat-display-name.js';

/**
 * «Conversazioni precedenti» in the agent lane's header (UI-UX-SinopiaCAD §3.4): the project's conversations, most
 * recent first, and the archived ones. SinopiaCAD's sidebar lists projects only, so this is where a designer switches.
 *
 * @returns The menu.
 */
export function ChatSwitcher(): React.JSX.Element {
  const { t } = useTranslation();
  const { projectId } = useProject();
  const { activeChatId } = useChatContext();
  const { chats } = useChatRecords(projectId);
  const slugs = useProjectSlugs(projectId);
  const [, setArchivedChats] = useSearchParameter(searchParameterName.archivedChats, flagParameter, {
    history: 'push',
  });
  const sorted = useMemo(() => [...chats].sort(compareChatsByRecency), [chats]);

  return (
    <DropdownMenu modal={false}>
      <FloatingPanelMenuButton
        asChild
        tooltip={t('project.agent.previousChats')}
        aria-label={t('project.agent.previousChats')}
      >
        <DropdownMenuTrigger>
          <History className='size-3.5' />
        </DropdownMenuTrigger>
      </FloatingPanelMenuButton>
      <DropdownMenuContent
        align='end'
        side='bottom'
        className='w-64'
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <DropdownMenuLabel className='text-xs font-normal text-muted-foreground'>
          {t('project.agent.previousChats')}
        </DropdownMenuLabel>
        {sorted.map((chat) =>
          slugs.status === 'resolved' ? (
            <DropdownMenuItem key={chat.id} asChild>
              <Link to={projectChatUrl(slugs.value, chat.id)} state={{ openChat: true }}>
                <span className='flex-1 truncate'>{displayChatName(chat.name, t)}</span>
                {chat.id === activeChatId ? <Check aria-hidden className='size-3.5' /> : null}
              </Link>
            </DropdownMenuItem>
          ) : null,
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            setArchivedChats(true);
          }}
        >
          {t('project.agent.archivedChats')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
