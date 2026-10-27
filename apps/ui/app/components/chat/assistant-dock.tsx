import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronUp, MessageCircle } from 'lucide-react';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { ChatTextarea } from '#components/chat/chat-textarea.js';
import type { ChatTextareaHandle, ChatTextareaProperties } from '#components/chat/chat-textarea-types.js';
import { ChatAttachmentDirectoriesContext, chatAttachmentDirectories } from '#components/chat/attachment-preview.js';
import { ChatQuestionsProvider } from '#components/chat/chat-questions-context.js';
import {
  AssistantComposerProvider,
  AssistantContextChips,
  AssistantStarts,
} from '#components/chat/assistant-suggestions.js';
import {
  AssistantBrief,
  AssistantNextSteps,
  AssistantTrayCard,
  AssistantTrayProvider,
  useAssistantTray,
} from '#components/chat/assistant-tray.js';
import { TurnModelSummary } from '#components/chat/turn-summary-card.js';
import { senzaVarianti } from '#lib/assistant-variants-marker.js';
import { useCadChatClient } from '#chat-clients/use-cad-chat-client.js';
import { useChatContext, useChatSelector } from '#hooks/use-chat.js';
import { useInspectorSelection } from '#hooks/use-inspector-selection.js';
import { useProject } from '#hooks/use-project.js';
import { useTranslation } from '#i18n/translate.js';
import { ChatHistory } from '#routes/w.$workspace.$project/chat-history.js';
import { ChatHistoryGate } from '#routes/w.$workspace.$project/focused-chat-gate.js';

/** The last thing the agent said, as one line for the strip. */
const latestAnswer = (
  messages: ReadonlyArray<{ role: string; parts: ReadonlyArray<{ type: string; text?: string }> }>,
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== 'assistant') {
      continue;
    }
    const text = message.parts
      .flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [senzaVarianti(part.text)] : []))
      .join(' ')
      .replaceAll(/\s+/gu, ' ')
      .trim();
    if (text !== '') {
      return text;
    }
  }
  return undefined;
};

/**
 * What the strip shows above its composer: an open card (the variants, «Cosa ho cambiato») in place of everything
 * else; otherwise the last turn's changes, then the selection's suggestions, the next steps of a conversation already
 * started, the card the assistant opens a model with (D4), or the starts of an empty project.
 */
function AssistantStripBody({
  hasMessages,
  isWorking,
}: Readonly<{ hasMessages: boolean; isWorking: boolean }>): React.JSX.Element {
  const { selection } = useInspectorSelection();
  const tray = useAssistantTray();
  const lastTurnId = useChatSelector((state) => state.turnGroups.at(-1)?.messageIds[0]);
  const [closedTurnId, setClosedTurnId] = useState<string>();
  const isModel = selection.kind === 'model';
  const hasCard = tray?.sessione !== undefined || tray?.modifica !== undefined;
  const hasPieces = (tray?.modello.pieces.length ?? 0) > 0;
  const showsTurn = !hasCard && hasMessages && !isWorking && lastTurnId !== undefined && lastTurnId !== closedTurnId;
  const suggestions =
    !isModel || !tray ? (
      <div className='px-1'>
        <AssistantContextChips />
      </div>
    ) : hasMessages ? (
      <AssistantNextSteps className='px-1' />
    ) : hasPieces ? (
      <AssistantBrief />
    ) : (
      <div className='px-1'>
        <AssistantStarts variant='row' />
      </div>
    );
  return (
    <div className='space-y-2 px-3 pt-2 pb-2 empty:hidden'>
      {hasCard ? <AssistantTrayCard /> : null}
      {showsTurn ? (
        <TurnModelSummary
          turnId={lastTurnId}
          className='mx-0 my-0'
          onChiudi={() => {
            setClosedTurnId(lastTurnId);
          }}
        />
      ) : null}
      {hasCard ? null : suggestions}
    </div>
  );
}

/**
 * The assistant while the inspector has the lane: its name, what it last said or that it is working, the starts or
 * the selection's suggestions, and the composer. Sending opens the conversation, so the answer is seen arriving.
 */
function AssistantStrip({ onExpand, keyHint }: Readonly<{ onExpand: () => void; keyHint: string }>): React.JSX.Element {
  const { t } = useTranslation();
  const { projectId } = useProject();
  const { activeChatId } = useChatContext();
  const attachmentDirectories = useMemo(
    () => chatAttachmentDirectories(projectId, activeChatId),
    [activeChatId, projectId],
  );
  const textarea = useRef<ChatTextareaHandle>(null);
  const focusComposer = useCallback(() => {
    textarea.current?.focus();
  }, []);
  const cadChat = useCadChatClient();
  const submitChat = cadChat.submit;
  const hasMessages = useChatSelector((state) => state.messageOrder.length > 0);
  const status = useChatSelector((state) => state.status);
  const latest = useChatSelector((state) => latestAnswer(state.messages));
  const isWorking = status === 'submitted' || status === 'streaming';
  const onSubmit: ChatTextareaProperties['onSubmit'] = useCallback(
    async ({ content, attachments, references }) => {
      await submitChat({ text: content, attachments, ...(references === undefined ? {} : { references }) });
      onExpand();
    },
    [submitChat, onExpand],
  );
  return (
    <ChatAttachmentDirectoriesContext.Provider value={attachmentDirectories}>
      <ChatQuestionsProvider>
        <AssistantComposerProvider focusComposer={focusComposer}>
          <section
            aria-label={t('inspector.assistant.label')}
            data-slot='assistant-strip'
            className='ph-no-capture shrink-0 border-t border-border bg-sidebar'
          >
            <div className='flex items-center gap-2 pt-2 pr-2 pl-4'>
              <MessageCircle aria-hidden className='size-3.5 text-titanium-foreground' />
              <Eyebrow>{t('inspector.assistant.label')}</Eyebrow>
              {isWorking ? (
                <span role='status' className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                  <span aria-hidden className='size-1.5 animate-pulse rounded-full bg-titanium' />
                  {t('inspector.assistant.working')}
                </span>
              ) : null}
              <PaneButton
                className='ml-auto'
                aria-label={t('inspector.assistant.expand')}
                aria-keyshortcuts='Control+J'
                tooltip={
                  <span className='flex items-center gap-2'>
                    {t('inspector.assistant.expand')}
                    <KeyShortcut variant='tooltip'>{keyHint}</KeyShortcut>
                  </span>
                }
                tooltipSide='left'
                onClick={onExpand}
              >
                <ChevronUp aria-hidden className='size-3.5' />
              </PaneButton>
            </div>
            {hasMessages && latest ? (
              <button
                type='button'
                className='mx-4 mt-1 line-clamp-2 block text-left text-xs leading-snug text-muted-foreground hover:text-foreground focus-visible:focus-outline'
                title={t('inspector.assistant.latest')}
                onClick={onExpand}
              >
                {latest}
              </button>
            ) : null}
            <AssistantStripBody hasMessages={hasMessages} isWorking={isWorking} />
            <div role='region' aria-label={t('project.agent.composer')} className='px-3 pb-3'>
              <ChatTextarea ref={textarea} mode='main' enableAutoFocus={false} onSubmit={onSubmit} />
            </div>
          </section>
        </AssistantComposerProvider>
      </ChatQuestionsProvider>
    </ChatAttachmentDirectoriesContext.Provider>
  );
}

/**
 * The assistant, always present under the inspector: a strip with the composer, or the whole conversation (⌃J).
 *
 * @param props - Whether the conversation is open, how to change it and the key that does.
 * @returns The dock.
 */
export function AssistantDock({
  isExpanded,
  onExpandedChange,
  keyHint,
}: Readonly<{
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  keyHint: string;
}>): React.JSX.Element {
  const expand = useCallback(() => {
    onExpandedChange(true);
  }, [onExpandedChange]);
  return (
    <AssistantTrayProvider>
      {isExpanded ? (
        <div data-slot='assistant-conversation' className='flex min-h-0 flex-1 flex-col border-t border-border'>
          <ChatHistoryGate>
            <ChatHistory
              variant='dock'
              isExpanded
              setIsExpanded={(value) => {
                onExpandedChange(typeof value === 'function' ? value(true) : value);
              }}
            />
          </ChatHistoryGate>
        </div>
      ) : (
        <ChatHistoryGate>
          <AssistantStrip onExpand={expand} keyHint={keyHint} />
        </ChatHistoryGate>
      )}
    </AssistantTrayProvider>
  );
}
