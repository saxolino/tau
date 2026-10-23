import type { IDockviewHeaderActionsProps } from 'dockview-react';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import type { KeyCombination } from '@taucad/ui/utils/keys';
import { PanelLeftClose, SlidersHorizontal } from 'lucide-react';
import { Separator } from '@taucad/ui/components/separator';
import { cn } from '@taucad/ui/utils/cn';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { useSidebar } from '#components/ui/sidebar.js';
import { useIsTopLeftGroup } from '#components/panes/use-is-top-right-group.js';
import { useLaneToggleFocus } from '#routes/w.$workspace.$project/lane-toggle-focus.js';
import type { LaneTogglePlace } from '#routes/w.$workspace.$project/lane-toggle-focus.js';
import { useProjectWorkspace, useWorkspaceLanes } from '#routes/w.$workspace.$project/project-workspace-context.js';

/** ⌃W toggles the Misure lane; `ChatInterfaceDesktop` binds it, the lane toggle advertises it. */
export const toggleWorkbenchKeyCombination = {
  key: 'w',
  ctrlKey: true,
} satisfies KeyCombination;

/**
 * The one control for the Misure lane (the workbench lane, on the left): pressed at the head of the lane's own tab
 * bar while it shows, and at the head of the viewer's tab bar, labelled "Misure", while it does not — so a designer
 * who closed it sees by name where to get it back.
 *
 * @param props - Which of the two mounts this is.
 * @returns The toggle.
 */
export function WorkbenchLaneToggle({ place }: { readonly place: LaneTogglePlace }): React.JSX.Element {
  const { setWorkbenchOpen } = useProjectWorkspace();
  const { workbench: isOpen } = useWorkspaceLanes();
  const { ref, claimFocus } = useLaneToggleFocus('workbench', place, isOpen);
  const isInLane = place === 'lane';

  return (
    <PaneButton
      ref={ref}
      data-slot='workbench-lane-toggle'
      data-place={place}
      size={isInLane ? 'icon' : 'label'}
      aria-label='Misure'
      aria-pressed={isOpen}
      aria-keyshortcuts='Control+W'
      // The label folds to its glyph where Share and Export do, below the viewer's `@xl` width.
      className={cn('aria-pressed:text-foreground', !isInLane && '@max-xl/viewer:w-7 @max-xl/viewer:px-0')}
      tooltip={
        <span className='flex items-center gap-2'>
          {isOpen ? 'Nascondi le misure' : 'Mostra le misure'}
          <KeyShortcut variant='tooltip'>{formatKeyCombination(toggleWorkbenchKeyCombination)}</KeyShortcut>
        </span>
      }
      onClick={(event) => {
        claimFocus(event.currentTarget);
        setWorkbenchOpen(!isOpen);
      }}
    >
      {isInLane ? (
        <PanelLeftClose aria-hidden className='size-3.5' />
      ) : (
        <>
          <SlidersHorizontal aria-hidden className='size-3.5' />
          <span className='hidden @xl/viewer:inline'>Misure</span>
        </>
      )}
    </PaneButton>
  );
}

/** The toggle at the head of a tab bar, set apart from the tabs by the hairline the header clusters use. */
const LaneTogglePrefix = ({ place }: { readonly place: LaneTogglePlace }): React.JSX.Element => (
  <div className='flex h-full items-center gap-1 pl-1'>
    <WorkbenchLaneToggle place={place} />
    {/* The variant, not `h-4`: the separator's own `data-[orientation=vertical]:h-full` outranks a bare height. */}
    <Separator orientation='vertical' className='data-[orientation=vertical]:h-4' />
  </div>
);

/**
 * The viewer's tab-bar prefix: the Misure toggle at the head of the top-left group, on desktop, while the Misure
 * lane is hidden.
 *
 * @param properties - Dockview's header-action props for the group.
 * @returns The toggle, or nothing in every other group and state.
 */
export function ViewerWorkbenchLaneToggle(properties: IDockviewHeaderActionsProps): React.JSX.Element | undefined {
  const isTopLeft = useIsTopLeftGroup(properties.group, properties.containerApi);
  const { workbench: isWorkbenchVisible } = useWorkspaceLanes();
  const { isMobile } = useSidebar();
  if (!isTopLeft || isWorkbenchVisible || isMobile) {
    return undefined;
  }
  return <LaneTogglePrefix place='viewer' />;
}

/**
 * The Misure lane's own tab-bar prefix: the toggle at the head of its top-left group while the lane shows.
 *
 * @param properties - Dockview's header-action props for the group.
 * @returns The toggle, or nothing in every other group and state.
 */
export function WorkbenchLaneHead(properties: IDockviewHeaderActionsProps): React.JSX.Element | undefined {
  const isTopLeft = useIsTopLeftGroup(properties.group, properties.containerApi);
  const { workbench: isWorkbenchVisible } = useWorkspaceLanes();
  const { isMobile } = useSidebar();
  if (!isTopLeft || !isWorkbenchVisible || isMobile) {
    return undefined;
  }
  return <LaneTogglePrefix place='lane' />;
}
