import { MessageSquare } from 'lucide-react';
import { PanelEmptyState } from '@taucad/ui/components/panel-empty-state';
import { NewProjectChatComposer } from '#components/chat/new-project-chat-composer.js';
import type { ChatTextareaHandle } from '#components/chat/chat-textarea-types.js';
import { FloatingPanel, FloatingPanelContent, FloatingPanelContentHeader } from '#components/ui/floating-panel.js';
import { AgentLaneToggleButton } from '#routes/w.$workspace.$project/agent-lane-toggle-button.js';

type HomeAgentLaneProps = {
  /** The composer, for the home to focus once a picture lands in its draft. */
  // oxlint-disable-next-line @typescript-eslint/no-restricted-types -- React ref object
  readonly composerRef: React.RefObject<ChatTextareaHandle | null>;
  /** Show or hide the lane. */
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
export function HomeAgentLane({ composerRef, onOpenChange }: HomeAgentLaneProps): React.JSX.Element {
  return (
    <FloatingPanel isOpen side='right' onOpenChange={onOpenChange}>
      <FloatingPanelContent className='min-h-0 overflow-hidden'>
        <FloatingPanelContentHeader className='gap-1'>
          <span className='fade-label flex-1 text-sm font-medium text-foreground'>Nuovo progetto</span>
          <AgentLaneToggleButton place='lane' isOpen onOpenChange={onOpenChange} />
        </FloatingPanelContentHeader>
        <div className='mx-auto flex min-h-0 w-[calc(100%_-_1rem)] max-w-xl flex-1 overflow-y-auto px-3 py-6'>
          <PanelEmptyState
            icon={MessageSquare}
            title='Cosa costruiamo?'
            description='Allega la foto o il disegno del pezzo e aggiungi due parole, scritte o dettate. Il primo messaggio crea il progetto.'
            className='m-auto h-auto max-w-xs py-6'
          />
        </div>
        <div
          role='region'
          aria-label='Messaggio per l’agente'
          className='relative mx-auto mb-2 w-[calc(100%_-_1rem)] max-w-xl shrink-0'
        >
          <NewProjectChatComposer ref={composerRef} enableLocationPicker={false} />
        </div>
      </FloatingPanelContent>
    </FloatingPanel>
  );
}
