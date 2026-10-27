import { ChatMessageQueue } from '#components/chat/chat-message-queue.js';
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { ScrollerProps, VirtuosoHandle } from 'react-virtuoso';
import { useLocation } from 'react-router';
import { ChevronDown, XIcon } from 'lucide-react';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { ChatMessagePlanning } from '#routes/w.$workspace.$project/chat-message-planning.js';
import { ChatMessage } from '#routes/w.$workspace.$project/chat-message.js';
import { TurnModelSummary } from '#components/chat/turn-summary-card.js';
import { AssistantComposerProvider } from '#components/chat/assistant-suggestions.js';
import { AssistantFooter } from '#components/chat/assistant-tray.js';
import type { TurnGroup as TurnGroupData } from '#routes/w.$workspace.$project/chat-turn-groups.js';
import { ScrollDownButton } from '#routes/w.$workspace.$project/scroll-down-button.js';
import {
  instantScrollBehavior,
  useFollowLatestOutput,
} from '#routes/w.$workspace.$project/use-follow-latest-output.js';
import { ChatError } from '#routes/w.$workspace.$project/chat-error.js';
import type { ChatTextareaProperties, ChatTextareaHandle } from '#components/chat/chat-textarea-types.js';
import { ChatTextarea } from '#components/chat/chat-textarea.js';
import { ChatQuestionQueue } from '#components/chat/chat-question-queue.js';
import { ChatQuestionsProvider } from '#components/chat/chat-questions-context.js';
import { useChatContext, useChatSelector } from '#hooks/use-chat.js';
import { useCadChatClient } from '#chat-clients/use-cad-chat-client.js';
import { ChatTitleBar } from '#routes/w.$workspace.$project/chat-title-bar.js';
import { toggleChatKeyCombination } from '#routes/w.$workspace.$project/agent-lane-toggle-button.js';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import {
  FloatingPanel,
  FloatingPanelClose,
  FloatingPanelContent,
  FloatingPanelContentHeader,
  FloatingPanelErrorContent,
} from '#components/ui/floating-panel.js';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { cn } from '@taucad/ui/utils/cn';
import { ChatHistoryEmpty } from '#routes/w.$workspace.$project/chat-history-empty.js';
import { AtReferenceProvider } from '#components/chat/at-reference-context.js';
import { ChatAttachmentDirectoriesContext, chatAttachmentDirectories } from '#components/chat/attachment-preview.js';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useChatRecords } from '#hooks/use-chat-records.js';
import { useProject } from '#hooks/use-project.js';
import { useSkillsCatalog } from '#hooks/use-skills-catalog.js';
import { useSearchParameter } from '#hooks/use-search-parameter.js';
import { searchParameterName } from '#constants/search-parameter.constants.js';
import { flagParameter } from '#utils/search-parameter.codecs.js';
import { useTranslation } from '#i18n/translate.js';
import { ArchivedChats } from '#routes/w.$workspace.$project/archived-chats.js';

// One conversational turn per virtual row, sized only by its content.
const TurnGroup = memo(function ({
  messageIds,
  isLast,
}: {
  readonly messageIds: readonly string[];
  readonly isLast: boolean;
}) {
  return (
    <div className='mx-auto flex w-[calc(100%_-_1rem)] max-w-xl flex-col gap-1 py-1'>
      {messageIds.map((id) => (
        <ChatMessage key={id} messageId={id} />
      ))}
      {messageIds[0] ? <TurnModelSummary turnId={messageIds[0]} /> : null}
      {isLast ? <ChatError className='mx-4' /> : null}
    </div>
  );
});

// Custom Virtuoso scroller. Single responsibility:
// `[scrollbar-gutter:stable]` permanently reserves a `--scrollbar-thickness`
// column on the inline-end edge so the inner content width does not change
// when content first overflows. Without this, the second message triggering
// overflow inserts a 9px-wide scrollbar that re-flows every bubble narrower
// (visible single-frame horizontal layout shift).
//
// `ScrollerProps` is `Pick<ComponentProps<'div'>, 'children' | 'style' | 'tabIndex'>`
// — Virtuoso also forwards `className` at runtime (so consumers can style via
// `<Virtuoso className=...>`), but the public type omits it. We widen here.
const ChatScroller = forwardRef<HTMLDivElement, ScrollerProps & { className?: string }>(function (props, ref) {
  const { t } = useTranslation();
  return (
    <div
      {...props}
      ref={ref}
      role='region'
      aria-label={t('project.agent.history')}
      className={cn('[scrollbar-gutter:stable]', props.className)}
    />
  );
});

const ChatHistoryHeader = (): undefined => undefined;
const ChatHistoryEmptyPlaceholder = (): React.JSX.Element => (
  <div className='mx-auto flex h-full w-[calc(100%_-_1rem)] max-w-xl px-5 py-6'>
    <ChatHistoryEmpty />
  </div>
);
// Initial positioning waits for Virtuoso's measured content, including an initially empty pane.
const initialChatTurn = { index: 'LAST', align: 'end' } as const;

const virtuosoComponents = {
  Scroller: ChatScroller,
  Header: ChatHistoryHeader,
  EmptyPlaceholder: ChatHistoryEmptyPlaceholder,
};

type ChatHistoryProps = {
  readonly className?: string;
  readonly isExpanded?: boolean;
  readonly setIsExpanded?: (value: boolean | ((current: boolean) => boolean)) => void;
  /**
   * `lane`: the conversation is a lane of its own (phone, tablet sheet). `dock`: it opens under the project's inspector,
   * and its header folds it back into the composer strip instead of hiding the lane.
   */
  readonly variant?: 'lane' | 'dock';
};

export const ChatHistory = memo(function ({
  isExpanded = true,
  setIsExpanded,
  variant = 'lane',
  ...props
}: ChatHistoryProps) {
  const toggleChatHistory = useCallback(() => {
    setIsExpanded?.((current) => !current);
  }, [setIsExpanded]);
  // In the dock ⌃C belongs to the lane (inspector and assistant together); the dock folds with ⌃J.
  const { formattedKeyCombination } = useKeybinding(toggleChatKeyCombination, toggleChatHistory, {
    enabled: variant !== 'dock',
  });
  const [isArchiveOpen] = useSearchParameter(searchParameterName.archivedChats, flagParameter);
  const { projectId } = useProject();

  return isExpanded && isArchiveOpen ? (
    <FloatingPanel isOpen side='right' className={props.className} onOpenChange={setIsExpanded}>
      <FloatingPanelContent className='ph-no-capture min-h-0 overflow-hidden'>
        <ArchivedChats key={projectId} />
      </FloatingPanelContent>
    </FloatingPanel>
  ) : isExpanded ? (
    <ExpandedChatHistory
      {...props}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      variant={variant}
      formattedKeyCombination={formattedKeyCombination}
    />
  ) : null;
});

const ExpandedChatHistory = memo(function ({
  className,
  isExpanded,
  setIsExpanded,
  variant,
  formattedKeyCombination,
}: ChatHistoryProps & { readonly formattedKeyCombination: string }) {
  const { t } = useTranslation();
  const messageIds = useChatSelector((state) => state.messageOrder);
  const cadChat = useCadChatClient();
  const { treeService } = useFileManager();
  const { projectId } = useProject();
  const { chats } = useChatRecords(projectId);
  const { activeChatId, persistenceActorRef } = useChatContext();
  const skillsCatalog = useSkillsCatalog();
  const agentInvocations = useChatSelector((state) => state.agentInvocations);
  const skillInvocations = skillsCatalog.map((skill) => `/${skill.name}`).join('\n');
  const knownTokens = useMemo(
    () => new Set(`${skillInvocations}\n${agentInvocations}`.split('\n').filter(Boolean)),
    [skillInvocations, agentInvocations],
  );
  const attachmentDirectories = useMemo(
    () => chatAttachmentDirectories(projectId, activeChatId),
    [activeChatId, projectId],
  );
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const chatTextareaRef = useRef<ChatTextareaHandle>(null);
  const focusComposer = useCallback(() => {
    chatTextareaRef.current?.focus();
  }, []);
  const location = useLocation();
  useEffect(() => {
    if (location.state?.focusChatComposer === true) {
      chatTextareaRef.current?.focus();
    }
  }, [location.state]);

  // Empty-cancel: the persistence machine has lifted the cancelled user
  // message back into the composer draft (via the store's
  // `restoreCancelledDraft` listener), so refocus the composer in the next
  // animation frame so Tiptap/HTMLTextArea can finish reflowing the restored
  // draft text before the cursor lands.
  useEffect(() => {
    if (!persistenceActorRef) {
      return;
    }
    let frame: number | undefined;
    const subscription = persistenceActorRef.on('restoreCancelledDraft', () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = undefined;
        chatTextareaRef.current?.focus();
      });
    });
    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      subscription.unsubscribe();
    };
  }, [persistenceActorRef]);

  // The turn host owns request configuration; the client exposes action verbs.
  // Memoising the call site avoids re-rendering tooltip-heavy children.
  const submitChat = cadChat.submit;
  const onSubmit: ChatTextareaProperties['onSubmit'] = useCallback(
    async ({ content, attachments, references }) => {
      // Pending until the message lands, so the composer stays busy through admission (R8).
      await submitChat({ text: content, attachments, ...(references === undefined ? {} : { references }) });
    },
    [submitChat],
  );

  const groups = useChatSelector((state) => state.turnGroups);

  const renderItem = useCallback(
    (index: number, group: TurnGroupData) => {
      const isLast = index === groups.length - 1;
      return <TurnGroup messageIds={group.messageIds} isLast={isLast} />;
    },
    [groups.length],
  );
  const computeItemKey = useCallback((_index: number, group: TurnGroupData) => group.messageIds[0]!, []);

  const [atBottom, setAtBottom] = useState(true);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setAtBottom(atBottom);
  }, []);

  // Follow streaming output only while the user stays pinned to the bottom —
  // otherwise leave the scroll position alone so they can read earlier messages.
  const followLatestOutput = useFollowLatestOutput(virtuosoRef);

  // Handler to scroll to the bottom of the chat
  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior: instantScrollBehavior,
      });
    }
  }, []);

  return (
    <ChatAttachmentDirectoriesContext.Provider value={attachmentDirectories}>
      <ChatQuestionsProvider>
        <AssistantComposerProvider focusComposer={focusComposer}>
          <FloatingPanel isOpen={isExpanded} side='right' className={className} onOpenChange={setIsExpanded}>
            <FloatingPanelContent
              // `ph-no-capture`: session replay never records chat transcripts.
              className={cn('ph-no-capture min-h-0 overflow-hidden [container-type:size]', !isExpanded && 'hidden')}
              errorFallback={(errorProps) => (
                <FloatingPanelErrorContent
                  {...errorProps}
                  title={t('project.agent.unavailableTitle')}
                  description={t('project.agent.unavailableText')}
                />
              )}
            >
              {/* Chat-restore time-travel: wire the store seams + surface a fork marker. */}
              {/* The one header row: name, rename in place, chat menu, close. */}
              <FloatingPanelContentHeader className='h-11 gap-1 border-b bg-background px-3'>
                <ChatTitleBar
                  trailing={
                    variant === 'dock' ? (
                      <PaneButton
                        aria-label={t('inspector.assistant.collapse')}
                        tooltip={t('inspector.assistant.collapse')}
                        tooltipSide='left'
                        onClick={() => {
                          setIsExpanded?.(false);
                        }}
                      >
                        <ChevronDown aria-hidden className='size-3.5' />
                      </PaneButton>
                    ) : undefined
                  }
                  closeButton={
                    <FloatingPanelClose
                      icon={XIcon}
                      tooltipContent={(isOpen) => (
                        <div className='flex items-center gap-2'>
                          {isOpen ? 'Close' : 'Open'} Chat
                          <KeyShortcut variant='tooltip'>{formattedKeyCombination}</KeyShortcut>
                        </div>
                      )}
                    />
                  }
                />
              </FloatingPanelContentHeader>

              {/* Main chat content area */}
              <AtReferenceProvider treeService={treeService} chats={chats} knownTokens={knownTokens}>
                <Virtuoso
                  ref={virtuosoRef}
                  data={groups}
                  initialTopMostItemIndex={initialChatTurn}
                  itemContent={renderItem}
                  computeItemKey={computeItemKey}
                  scrollerRef={followLatestOutput.scrollerRef}
                  followOutput={followLatestOutput.followOutput}
                  totalListHeightChanged={followLatestOutput.totalListHeightChanged}
                  className='mt-1 min-h-0 min-w-0 flex-1'
                  atBottomStateChange={handleAtBottomStateChange}
                  components={virtuosoComponents}
                />
              </AtReferenceProvider>
              {/*
          A refusal on an empty chat has to land somewhere (I12, W19-b).

          `ChatError` rides the last `TurnGroup`, and a submit that fails before
          the user message is appended — the durable workspace refusing the
          turn — leaves no group for it to ride. The person then saw nothing at
          all: their text still in the composer, no row, no banner. One banner
          at a time: while there are turns, the group above owns it.
        */}
              {groups.length === 0 ? <ChatError className='mx-4 mb-1 shrink-0' /> : null}
              {/* Chat input area. The agent's task list and its questions share one
              tray directly above the composer; the task list is keyed by chat so
              its fold never carries across chats (D8, agent questions D8). */}
              <div
                role='region'
                aria-label={t('project.agent.composer')}
                className='relative mx-auto mb-3 w-[calc(100%_-_1.5rem)] max-w-xl shrink-0'
              >
                <ScrollDownButton
                  hasContent={messageIds.length > 0}
                  isVisible={!atBottom}
                  onScrollToBottom={scrollToBottom}
                />
                <ChatMessagePlanning key={activeChatId} className='mb-3 px-3' />
                <AssistantFooter className='mb-2 px-1' />
                <div className='mx-2 -mb-3 flex flex-col rounded-t-2xl border border-b-0 border-border/60 bg-muted/20 pb-3 empty:hidden'>
                  <ChatMessageQueue key={`${activeChatId}:messages`} />
                  <ChatQuestionQueue key={`${activeChatId}:questions`} onDismissFocus={focusComposer} />
                </div>
                <ChatTextarea
                  ref={chatTextareaRef}
                  enableMobileCollapse
                  mode='main'
                  enableAutoFocus={false}
                  onSubmit={onSubmit}
                />
              </div>
            </FloatingPanelContent>
          </FloatingPanel>
        </AssistantComposerProvider>
      </ChatQuestionsProvider>
    </ChatAttachmentDirectoriesContext.Provider>
  );
});
