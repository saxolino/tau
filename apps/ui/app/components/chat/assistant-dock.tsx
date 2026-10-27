import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUp } from 'lucide-react';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { cn } from '@taucad/ui/utils/cn';
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
import { assistantDockDragDirection, stepAssistantDockPosition } from '#lib/assistant-dock-position.js';
import type { AssistantDockPosition } from '#lib/assistant-dock-position.js';
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

/** What the line says the assistant is doing. */
type LineState = 'idle' | 'working' | 'answered' | 'proposal' | 'change';

/** What the strip had shown the last time its body was on screen, so the line can say what is new. */
type Seen = Readonly<{ answer: string | undefined; sessione: number | undefined; modifica: number | undefined }>;

const sameSeen = (left: Seen, right: Seen): boolean =>
  left.answer === right.answer && left.sessione === right.sessione && left.modifica === right.modifica;

/**
 * What the line says: the assistant at work first; at the line, what arrived since the body was last seen (a change
 * it made, a proposal, an answer); otherwise nothing.
 */
const lineStateOf = (strip: Readonly<{ isWorking: boolean; isOpen: boolean }>, now: Seen, seen: Seen): LineState => {
  if (strip.isWorking) {
    return 'working';
  }
  if (strip.isOpen) {
    return 'idle';
  }
  if (now.modifica !== undefined && now.modifica !== seen.modifica) {
    return 'change';
  }
  if (now.sessione !== undefined && now.sessione !== seen.sessione) {
    return 'proposal';
  }
  if (now.answer !== undefined && now.answer !== seen.answer) {
    return 'answered';
  }
  return 'idle';
};

/** The line's words for its state; at rest on the line, the last answer or «Pronto». */
const useLineText = (state: LineState, isOpen: boolean, latest: string | undefined): string => {
  const { t } = useTranslation();
  switch (state) {
    case 'working': {
      return `${t('inspector.assistant.working')}…`;
    }
    case 'answered': {
      return `${t('inspector.assistant.answered')} · ${latest ?? ''}`;
    }
    case 'proposal': {
      return t('inspector.assistant.newProposal');
    }
    case 'change': {
      return t('inspector.assistant.newChange');
    }
    default: {
      return isOpen ? '' : (latest ?? t('inspector.assistant.idle'));
    }
  }
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
    <div className='space-y-2 px-3 pt-1 pb-2 empty:hidden'>
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
 * The line's mark: still while nothing happens, Sinopia's titanium while the assistant works (the only thing that
 * moves) or has something new to show, sage once it has answered.
 */
const dotClass: Record<LineState, string> = {
  idle: 'border border-muted-foreground/50',
  working: 'bg-titanium motion-safe:animate-pulse',
  answered: 'bg-success',
  proposal: 'bg-titanium',
  change: 'bg-titanium',
};

/**
 * The assistant while the inspector has the lane, at one of two heights. At `line` it is one thin row — the live
 * status — over the composer, and the inspector has everything else; at `open` the body (the model's card, the
 * proposals, the last answer) sits between them. The line toggles the body with a click or Enter, grows or shrinks
 * the assistant when dragged, and the composer never leaves. Sending opens the conversation, so the answer is seen
 * arriving.
 */
function AssistantStrip({
  position,
  onPositionChange,
  keyHint,
}: Readonly<{
  position: Exclude<AssistantDockPosition, 'tall'>;
  onPositionChange: (position: AssistantDockPosition) => void;
  keyHint: string;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const { projectId } = useProject();
  const { activeChatId } = useChatContext();
  const attachmentDirectories = useMemo(
    () => chatAttachmentDirectories(projectId, activeChatId),
    [activeChatId, projectId],
  );
  const bodyId = useId();
  const textarea = useRef<ChatTextareaHandle>(null);
  const focusComposer = useCallback(() => {
    textarea.current?.focus();
  }, []);
  const cadChat = useCadChatClient();
  const submitChat = cadChat.submit;
  const hasMessages = useChatSelector((state) => state.messageOrder.length > 0);
  const status = useChatSelector((state) => state.status);
  const latest = useChatSelector((state) => latestAnswer(state.messages));
  const tray = useAssistantTray();
  const sessioneId = tray?.sessione?.stato === 'pronto' ? tray.sessione.id : undefined;
  const modificaId = tray?.modifica?.id;
  const isWorking = status === 'submitted' || status === 'streaming';
  const isOpen = position === 'open';

  // While the body is on screen, everything in it counts as seen; the line then only announces what came after.
  const now: Seen = { answer: latest, sessione: sessioneId, modifica: modificaId };
  const [seen, setSeen] = useState<Seen>(now);
  if (isOpen && !sameSeen(seen, now)) {
    setSeen(now);
  }
  const lineState = lineStateOf({ isWorking, isOpen }, now, seen);
  const lineText = useLineText(lineState, isOpen, latest);

  const expand = useCallback(() => {
    onPositionChange('tall');
  }, [onPositionChange]);
  const toggleBody = useCallback(() => {
    onPositionChange(isOpen ? 'line' : 'open');
  }, [isOpen, onPositionChange]);

  // Dragging the line: up grows the assistant (open, then the conversation), down shrinks it (the line).
  const drag = useRef<{ pointerId: number; startY: number; moved: boolean } | undefined>(undefined);
  // The handlers sit on the line's own button, which captures the pointer: a capturing ancestor would retarget the
  // pointer-up and the click would land beside the button instead of on it.
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) {
      return;
    }
    drag.current = { pointerId: event.pointerId, startY: event.clientY, moved: false };
    // Pointer capture keeps the gesture when the pointer leaves the line; a runtime without it still drags.
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const { current } = drag;
    if (!current || current.pointerId !== event.pointerId || current.moved) {
      return;
    }
    const direction = assistantDockDragDirection(event.clientY - current.startY);
    if (direction === undefined) {
      return;
    }
    current.moved = true;
    onPositionChange(stepAssistantDockPosition(position, direction));
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (
      drag.current?.pointerId === event.pointerId &&
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onLineClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    // A drag that already changed the height is not a click.
    if (drag.current?.moved) {
      drag.current = undefined;
      event.preventDefault();
      return;
    }
    drag.current = undefined;
    toggleBody();
  };

  const onSubmit: ChatTextareaProperties['onSubmit'] = useCallback(
    async ({ content, attachments, references }) => {
      await submitChat({ text: content, attachments, ...(references === undefined ? {} : { references }) });
      expand();
    },
    [submitChat, expand],
  );
  return (
    <ChatAttachmentDirectoriesContext.Provider value={attachmentDirectories}>
      <ChatQuestionsProvider>
        <AssistantComposerProvider focusComposer={focusComposer}>
          <section
            aria-label={t('inspector.assistant.label')}
            data-slot='assistant-strip'
            data-position={position}
            className='ph-no-capture shrink-0 border-t border-border bg-sidebar'
          >
            <div data-slot='assistant-line' className='flex h-8 items-center gap-1 pr-1.5 pl-3 select-none'>
              <button
                type='button'
                aria-expanded={isOpen}
                aria-controls={bodyId}
                aria-label={t(isOpen ? 'inspector.assistant.hideBody' : 'inspector.assistant.showBody')}
                title={t('inspector.assistant.dragHint')}
                className='flex h-full min-w-0 flex-1 cursor-ns-resize touch-none items-center gap-2 rounded-md text-left outline-hidden focus-visible:focus-outline'
                onClick={onLineClick}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
              >
                <span
                  aria-hidden
                  data-slot='assistant-dot'
                  data-state={lineState}
                  className={cn('size-1.5 shrink-0 rounded-full', dotClass[lineState])}
                />
                <Eyebrow className='shrink-0 text-titanium-foreground'>{t('inspector.assistant.label')}</Eyebrow>
                <span
                  role='status'
                  aria-live='polite'
                  data-slot='assistant-line-status'
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs',
                    lineState === 'idle' ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {lineText}
                </span>
                {isOpen ? (
                  <ChevronDown aria-hidden className='size-3.5 shrink-0 text-muted-foreground' />
                ) : (
                  <ChevronUp aria-hidden className='size-3.5 shrink-0 text-muted-foreground' />
                )}
              </button>
              <PaneButton
                aria-label={t('inspector.assistant.expand')}
                aria-keyshortcuts='Control+J'
                tooltip={
                  <span className='flex items-center gap-2'>
                    {t('inspector.assistant.expand')}
                    <KeyShortcut variant='tooltip'>{keyHint}</KeyShortcut>
                  </span>
                }
                tooltipSide='left'
                onClick={expand}
              >
                <ChevronsUp aria-hidden className='size-3.5' />
              </PaneButton>
            </div>
            {isOpen ? (
              <div id={bodyId} data-slot='assistant-body'>
                {hasMessages && latest ? (
                  <button
                    type='button'
                    className='mx-4 mb-1 line-clamp-2 block text-left text-xs leading-snug text-muted-foreground hover:text-foreground focus-visible:focus-outline'
                    title={t('inspector.assistant.latest')}
                    onClick={expand}
                  >
                    {latest}
                  </button>
                ) : null}
                <AssistantStripBody hasMessages={hasMessages} isWorking={isWorking} />
              </div>
            ) : null}
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
 * The assistant, always present under the inspector, at one of three heights: the line over its composer, the strip
 * with its body, or the whole conversation (⌃J). The project remembers the height.
 *
 * @param props - The height, how to change it, and the key that opens the conversation.
 * @returns The dock.
 */
export function AssistantDock({
  position,
  onPositionChange,
  onExpandedChange,
  keyHint,
}: Readonly<{
  position: AssistantDockPosition;
  onPositionChange: (position: AssistantDockPosition) => void;
  /** Open the conversation, or go back to the strip at the height it had before. */
  onExpandedChange: (isExpanded: boolean) => void;
  keyHint: string;
}>): React.JSX.Element {
  return (
    <AssistantTrayProvider>
      {position === 'tall' ? (
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
          <AssistantStrip position={position} onPositionChange={onPositionChange} keyHint={keyHint} />
        </ChatHistoryGate>
      )}
    </AssistantTrayProvider>
  );
}
