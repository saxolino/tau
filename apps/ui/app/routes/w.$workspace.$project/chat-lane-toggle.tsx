import { useSelector } from '@xstate/react';
import { selectChatFacts, useChatSidebarStatus } from '#hooks/use-sidebar-status.js';
import type { SidebarFacts } from '#hooks/use-sidebar-status.js';
import { useProject } from '#hooks/use-project.js';
import { useProjectWorkspace, useWorkspaceLanes } from '#routes/w.$workspace.$project/project-workspace-context.js';
import { AgentLaneToggleButton } from '#routes/w.$workspace.$project/agent-lane-toggle-button.js';
import type { LaneTogglePlace } from '#routes/w.$workspace.$project/lane-toggle-focus.js';

/**
 * The one control for the agent's lane (the chat lane, on the right): pressed at the end of the agent pane's header
 * while the lane is open, and at the end of the project's top bar, labelled «Agente» and carrying the focused chat's
 * status mark (R3: the lane's own mount never shows a mark). Both mounts sit in the window's top-right corner, so
 * opening and closing the agent happen in one place.
 *
 * @param props - Which of the two mounts this is.
 * @returns The toggle.
 */
export function ChatLaneToggle({
  place,
  fold,
}: {
  readonly place: LaneTogglePlace;
  readonly fold?: Readonly<{ className: string; labelClassName: string }>;
}): React.JSX.Element {
  const { setChatOpen } = useProjectWorkspace();
  const { chat: isOpen } = useWorkspaceLanes();
  const { editorRef, projectId } = useProject();
  const focusedChatId = useSelector(editorRef, (state) => state.context.focusedChatId);
  const status = useChatSidebarStatus(projectId, focusedChatId ?? '');
  // The top bar's mount is always on screen; it marks the chat only while the lane is hidden (R3).
  const facts: SidebarFacts =
    place === 'viewer' && !isOpen && status !== undefined
      ? selectChatFacts(status)
      : { mark: 'none', sentence: undefined };

  return <AgentLaneToggleButton place={place} isOpen={isOpen} facts={facts} fold={fold} onOpenChange={setChatOpen} />;
}
