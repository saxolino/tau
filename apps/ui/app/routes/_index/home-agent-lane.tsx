import { Button } from '@taucad/ui/components/button';
import { useDraftActions } from '#hooks/use-chat.js';
import type { ChatTextareaHandle, ChatTextareaProperties } from '#components/chat/chat-textarea-types.js';
import { useTranslation } from '#i18n/translate.js';
import { NewProjectChatComposer } from '#components/chat/new-project-chat-composer.js';
import { FloatingPanel, FloatingPanelContent, FloatingPanelContentHeader } from '#components/ui/floating-panel.js';
import { AgentLaneToggleButton } from '#routes/w.$workspace.$project/agent-lane-toggle-button.js';

type HomeAgentLaneProps = {
  /** The composer, for the home to focus once a picture lands in its draft. */
  // oxlint-disable-next-line @typescript-eslint/no-restricted-types -- React ref object
  readonly composerRef: React.RefObject<ChatTextareaHandle | null>;
  /** Show or hide the lane. */
  readonly onSubmit: ChatTextareaProperties['onSubmit'];
  readonly isSubmitting: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
};

/**
 * The home's agent lane, drawn as the project page draws its own: the lane header ending with the same agent toggle,
 * the conversation area, and the composer at the bottom. Before the first message there is no project and no chat,
 * so the conversation area explains the first step, and the composer is the home's new-project composer: its first
 * message creates the project, which opens with this same message as its chat's first turn.
 *
 * @param props - The composer handle and the lane's open setter.
 * @returns The lane.
 */
export function HomeAgentLane({
  composerRef,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: HomeAgentLaneProps): React.JSX.Element {
  const { t } = useTranslation();
  const { setDraftText } = useDraftActions();
  return (
    <FloatingPanel isOpen side='right' onOpenChange={onOpenChange}>
      <FloatingPanelContent className='min-h-0 overflow-hidden'>
        <FloatingPanelContentHeader className='gap-1'>
          <span className='fade-label flex-1 text-sm font-medium text-foreground'>{t('home.agentLane.header')}</span>
          <AgentLaneToggleButton place='lane' isOpen onOpenChange={onOpenChange} />
        </FloatingPanelContentHeader>
        <div className='mx-auto flex min-h-0 w-[calc(100%_-_1rem)] max-w-xl flex-1 overflow-y-auto px-3 py-6'>
          <div className='m-auto space-y-3'>
            <h2 className='text-base font-semibold'>{t('home.agentLane.emptyTitle')}</h2>
            <p className='text-sm text-muted-foreground'>{t('home.agentLane.emptyDescription')}</p>
            <div className='flex flex-col items-start gap-2'>
              {(['home.agentLane.ring', 'home.agentLane.buckle', 'home.agentLane.pendant'] as const).map((key) => (
                <Button
                  key={key}
                  variant='outline'
                  className='h-auto text-left whitespace-normal'
                  disabled={isSubmitting}
                  onClick={() => {
                    setDraftText(t(key));
                    composerRef.current?.focus();
                  }}
                >
                  {t(key)}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div
          role='region'
          aria-label={t('home.intake.messageForAgent')}
          className='relative mx-auto mb-2 w-[calc(100%_-_1rem)] max-w-xl shrink-0'
        >
          <NewProjectChatComposer
            ref={composerRef}
            enableLocationPicker={false}
            onSubmit={onSubmit}
            isSubmitDisabled={isSubmitting}
          />
        </div>
      </FloatingPanelContent>
    </FloatingPanel>
  );
}
