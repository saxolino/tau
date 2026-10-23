import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LayoutPriority } from 'allotment';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { Allotment } from '#components/panes/allotment.js';
import { useSelector } from '@xstate/react';
import { ChatHistory } from '#routes/w.$workspace.$project/chat-history.js';
import { ChatHistoryGate, ChatInterfaceSessionGate } from '#routes/w.$workspace.$project/focused-chat-gate.js';
import { ViewerDockview } from '#routes/w.$workspace.$project/chat-viewer-dockview.js';
import { WorkbenchDockview } from '#routes/w.$workspace.$project/chat-workbench-dockview.js';
import { toggleWorkbenchKeyCombination } from '#routes/w.$workspace.$project/workbench-toggle.js';
import { ProjectUnavailableOverlay } from '#routes/w.$workspace.$project/project-unavailable-overlay.js';
import { ProjectManifestIssueBanner } from '#routes/w.$workspace.$project/project-manifest-issue-banner.js';
import { WorkspaceSkeleton } from '#routes/w.$workspace.$project/workspace-skeleton.js';
import { ChatContextInsertionProvider } from '#components/chat/chat-context-insertion.js';
import { useSidebar } from '#components/ui/sidebar.js';
import { useProject } from '#hooks/use-project.js';
import {
  resolveCompactAuxiliary,
  useProjectWorkspace,
  WorkspaceLanesContext,
} from '#routes/w.$workspace.$project/project-workspace-context.js';
import { panelMinSizeChat, panelMinSizeViewer, panelMinSizeWorkbench } from '#constants/editor.constants.js';
import { cn } from '@taucad/ui/utils/cn';

/**
 * Below this workspace width only one side lane shows beside the viewer: Misure (280 px) and the agent (320 px) by
 * default leave the viewer its 416 px minimum, so a 1280 px window with the sidebar open keeps all three.
 */
export const compactWorkspaceWidth = 1024;

/**
 * Reserve the titlebar-controls width in front of the leftmost lane's top-left
 * group's tab bar only: a group inside any non-first `.dv-view` sits below or
 * right of another one. A `::before` flex item rather than padding so the tab
 * bar's bottom border, which the children draw, continues under the controls.
 *
 * The inset stops one spacing step short because the Misure lane toggle leads
 * that tab bar with `pl-1`, in the Misure lane and in the viewer alike, so the
 * toggle keeps its pixel when the lane opens or closes.
 */
const topLeftTabBarInset = [
  "[&_.dv-tabs-and-actions-container:not(.dv-view:not(:first-child)_*)]:before:content-['']",
  '[&_.dv-tabs-and-actions-container:not(.dv-view:not(:first-child)_*)]:before:w-[calc(var(--titlebar-controls-width)-var(--spacing))]',
  '[&_.dv-tabs-and-actions-container:not(.dv-view:not(:first-child)_*)]:before:shrink-0',
  '[&_.dv-tabs-and-actions-container:not(.dv-view:not(:first-child)_*)]:before:border-b',
  '[&_.dv-tabs-and-actions-container:not(.dv-view:not(:first-child)_*)]:before:border-b-border',
].join(' ');

export const ChatInterfaceDesktop = memo(function (): React.JSX.Element {
  const { editorRef } = useProject();
  const { open: sidebarOpen } = useSidebar();
  const { setChatOpen, setWorkbenchOpen } = useProjectWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState<boolean>();
  const isClient = isCompact !== undefined;
  const isEditorReady = useSelector(editorRef, (state) => state.matches('ready'));
  const desktopLayout = useSelector(editorRef, (state) => state.context.panelState.desktopLayout);
  const compactAuxiliary = isCompact ? resolveCompactAuxiliary(desktopLayout) : undefined;
  const chatVisible = desktopLayout.chatOpen && (!isCompact || compactAuxiliary === 'chat');
  const workbenchVisible = desktopLayout.workbenchOpen && (!isCompact || compactAuxiliary === 'workbench');
  const lanes = useMemo(() => ({ chat: chatVisible, workbench: workbenchVisible }), [chatVisible, workbenchVisible]);

  // ⌃W shows or hides Misure; its two-place toggle advertises the binding (`WorkbenchLaneToggle`).
  useKeybinding(
    toggleWorkbenchKeyCombination,
    () => {
      setWorkbenchOpen(!workbenchVisible);
    },
    { enabled: isClient && isEditorReady },
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // Resolve the initial lanes before mounting their layout engines. Pixel
    // changes within the same mode must not rerender the workspace subtree.
    let compact = container.getBoundingClientRect().width < compactWorkspaceWidth;
    setIsCompact(compact);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const nextCompact = entry.contentRect.width < compactWorkspaceWidth;
      if (nextCompact === compact) {
        return;
      }
      compact = nextCompact;
      // ResizeObserver runs before paint; commit the lane change in that same
      // delivery instead of letting concurrent React show an intermediate mode.
      flushSync(() => {
        setIsCompact(nextCompact);
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  const persistWidths = useCallback(
    (sizes: readonly number[]) => {
      const workbenchWidth = sizes[0];
      const chatWidth = sizes[2];
      editorRef.send({
        type: 'setPanelState',
        panelState: {
          desktopLayout: {
            ...(workbenchWidth !== undefined && workbenchWidth > 0 ? { workbenchWidth } : {}),
            ...(chatWidth !== undefined && chatWidth > 0 ? { chatWidth } : {}),
          },
        },
      });
    },
    [editorRef],
  );

  return (
    <ChatContextInsertionProvider>
      <WorkspaceLanesContext.Provider value={lanes}>
        <div
          ref={containerRef}
          className='relative size-full overflow-hidden bg-background'
          data-project-workspace
          data-compact={isCompact}
        >
          {/* Until the editor state has loaded and the focused chat exists, the
              lanes stand in at their default widths rather than a blank page. */}
          <ChatInterfaceSessionGate fallback={<WorkspaceSkeleton />}>
            {isClient && isEditorReady ? (
              /* SinopiaCAD: Misure on the left, the model in the middle, the agent on the right. Each side lane's
                 toggle heads its own header while it shows and the viewer's while it does not. */
              <Allotment
                paneLabels={['Workbench', 'Viewer', 'Chat']}
                separator={false}
                proportionalLayout={false}
                /* The lanes land rather than snap in: the skeleton they replace holds the same
                   background, so a short fade reads as the workspace resolving (soft land). */
                className='size-full animate-in duration-200 fade-in-50 motion-reduce:animate-none [&_.split-view-view:not(:last-child)]:border-r [&_.split-view-view:not(:last-child)]:border-border'
                onDragEnd={persistWidths}
              >
                <Allotment.Pane
                  key='workbench'
                  minSize={panelMinSizeWorkbench}
                  preferredSize={desktopLayout.workbenchWidth}
                  priority={LayoutPriority.Low}
                  visible={workbenchVisible}
                >
                  {/* The leftmost lane makes room for the window's own controls while the sidebar is closed. */}
                  <div className={cn('size-full', !sidebarOpen && workbenchVisible && topLeftTabBarInset)}>
                    <WorkbenchDockview />
                  </div>
                </Allotment.Pane>

                <Allotment.Pane key='viewer' minSize={panelMinSizeViewer} priority={LayoutPriority.High}>
                  <div
                    className={cn(
                      '@container/viewer relative size-full overflow-hidden',
                      !sidebarOpen && !workbenchVisible && topLeftTabBarInset,
                    )}
                  >
                    <ViewerDockview />
                    <ProjectManifestIssueBanner />
                    <ProjectUnavailableOverlay />
                  </div>
                </Allotment.Pane>

                <Allotment.Pane
                  key='chat'
                  minSize={panelMinSizeChat}
                  preferredSize={desktopLayout.chatWidth}
                  priority={LayoutPriority.Low}
                  visible={chatVisible}
                >
                  <ChatHistoryGate>
                    <ChatHistory
                      isExpanded={desktopLayout.chatOpen}
                      setIsExpanded={(value) => {
                        setChatOpen(typeof value === 'function' ? value(desktopLayout.chatOpen) : value);
                      }}
                    />
                  </ChatHistoryGate>
                </Allotment.Pane>
              </Allotment>
            ) : (
              <WorkspaceSkeleton />
            )}
          </ChatInterfaceSessionGate>
        </div>
      </WorkspaceLanesContext.Provider>
    </ChatContextInsertionProvider>
  );
});
