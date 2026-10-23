import { useId } from 'react';
import { MessageCircle, PanelRightClose } from 'lucide-react';
import { cn } from '@taucad/ui/utils/cn';
import { StatusMark } from '#components/nav/status-mark.js';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import type { SidebarFacts } from '#hooks/use-sidebar-status.js';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import type { KeyCombination } from '@taucad/ui/utils/keys';
import { useLaneToggleFocus } from '#routes/w.$workspace.$project/lane-toggle-focus.js';
import type { LaneTogglePlace } from '#routes/w.$workspace.$project/lane-toggle-focus.js';

type Place = LaneTogglePlace;

/** ⌃C toggles the agent's lane; `ChatHistory` and the home bind it, this control advertises it. */
export const toggleChatKeyCombination = {
  key: 'c',
  ctrlKey: true,
} satisfies KeyCombination;

/**
 * Where the mark's centre sits: on the bubble's outline, 30° above its
 * right-hand edge. `MessageCircle` draws its bubble as a radius-9 circle on
 * lucide's 24-unit grid, centred in the 14 px icon the mark is placed in; the
 * mark's 24 px slot is centred on that point, whether the label shows or not.
 */
const markPosition = (() => {
  const icon = 14;
  const radius = (9 / 24) * icon;
  const angle = Math.PI / 6;
  return {
    left: icon / 2 + radius * Math.cos(angle) - 12,
    top: icon / 2 - radius * Math.sin(angle) - 12,
  };
})();

/**
 * The sidebar's own `StatusMark`, threaded on the bubble's stroke over a disc
 * of the strip's fill one pixel wider than the mark. No count: its numeral
 * would hang into the tab; the tooltip and the description carry it.
 */
const LaneMark = ({ facts }: { readonly facts: SidebarFacts }): React.ReactNode =>
  facts.mark === 'none' ? undefined : (
    <span
      aria-hidden
      data-slot='chat-toggle-mark'
      data-mark={facts.mark}
      className='pointer-events-none absolute flex size-6 items-center justify-center'
      style={markPosition}
    >
      <span
        className={cn(
          'absolute rounded-full bg-(--fade-scrim-into,var(--background))',
          facts.mark === 'failed' ? 'size-3.5' : 'size-2.5',
        )}
      />
      <StatusMark facts={{ ...facts, count: undefined }} />
    </span>
  );

type AgentLaneToggleButtonProps = {
  /** Which of the two mounts this is: the lane's own header, or the cluster beside it while the lane is hidden. */
  readonly place: Place;
  /** Whether the agent's lane is on screen. */
  readonly isOpen: boolean;
  /** Show or hide the lane. */
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The focused chat's sidebar facts, shown on the hidden lane's mount; none on the home, which has no chat yet. */
  readonly facts?: SidebarFacts;
};

const noFacts: SidebarFacts = { mark: 'none', sentence: undefined };

/**
 * The agent lane's toggle as the project page and the home both draw it: pressed at the end of the lane's header
 * while the lane is open, and labelled "Agente" at the end of the cluster beside it while it is not. The label folds to
 * its glyph below the `viewer` container's `@xl` width.
 *
 * @param props - The mount, the lane's state and how to change it.
 * @returns The toggle.
 */
export function AgentLaneToggleButton({
  place,
  isOpen,
  onOpenChange,
  facts = noFacts,
}: AgentLaneToggleButtonProps): React.JSX.Element {
  const sentenceId = useId();
  const { ref, claimFocus } = useLaneToggleFocus('chat', place, isOpen);
  const shownFacts = place === 'viewer' ? facts : noFacts;
  const isInLane = place === 'lane';

  return (
    <PaneButton
      ref={ref}
      data-slot='chat-lane-toggle'
      data-place={place}
      size={isInLane ? 'icon' : 'label'}
      aria-label='Agente'
      aria-pressed={isOpen}
      aria-keyshortcuts='Control+C'
      aria-describedby={shownFacts.sentence === undefined ? undefined : sentenceId}
      // The label folds to its glyph where Share and Export do, below the viewer's `@xl` width.
      className={cn('aria-pressed:text-foreground', !isInLane && '@max-xl/viewer:w-7 @max-xl/viewer:px-0')}
      tooltipSide={isInLane ? 'left' : 'bottom'}
      tooltip={
        <span className='flex items-center gap-2'>
          {isOpen ? "Nascondi l'agente" : "Mostra l'agente"}
          <KeyShortcut variant='tooltip'>{formatKeyCombination(toggleChatKeyCombination)}</KeyShortcut>
          {shownFacts.sentence === undefined ? undefined : <span className='opacity-70'>· {shownFacts.sentence}</span>}
        </span>
      }
      onClick={(event) => {
        claimFocus(event.currentTarget);
        onOpenChange(!isOpen);
      }}
    >
      {isInLane ? (
        <PanelRightClose aria-hidden className='size-3.5' />
      ) : (
        <>
          <span className='relative flex size-3.5'>
            <MessageCircle aria-hidden className='size-3.5' />
            <LaneMark facts={shownFacts} />
          </span>
          <span className='hidden @xl/viewer:inline'>Agente</span>
        </>
      )}
      {/* Inside the button: `sr-only` is absolutely positioned, and a sibling
          would escape the tab bar's overflow clip. */}
      {shownFacts.sentence === undefined ? undefined : (
        <span id={sentenceId} className='sr-only'>
          {shownFacts.sentence}
        </span>
      )}
    </PaneButton>
  );
}
