import { useCadViewport } from '#hooks/use-cad-viewport.js';
import { TabletLane } from '#components/layout/tablet-lane.js';
import { useTranslation } from '#i18n/translate.js';
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
import { ProjectTopBar } from '#routes/w.$workspace.$project/project-top-bar.js';
import { ChatContextInsertionProvider } from '#components/chat/chat-context-insertion.js';
import { useProject } from '#hooks/use-project.js';
import {
  resolveCompactAuxiliary,
  useProjectWorkspace,
  WorkspaceLanesContext,
} from '#routes/w.$workspace.$project/project-workspace-context.js';
import { panelMinSizeChat, panelMinSizeViewer, panelMinSizeWorkbench } from '#constants/editor.constants.js';

/**
 * Below this workspace width only one side lane shows beside the viewer: Misure (280 px) and the agent (320 px) by
 * default leave the viewer its 416 px minimum, so a 1280 px window with the sidebar open keeps all three.
 */
export const compactWorkspaceWidth = 1024;

export const ChatInterfaceDesktop = memo(function (): React.JSX.Element {
  const { editorRef } = useProject();
  const { t } = useTranslation();
  const isTablet = useCadViewport() === 'tablet';
  const { setChatOpen, setWorkbenchOpen } = useProjectWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState<boolean>();
  const isClient = isCompact !== undefined;
  const isEditorReady = useSelector(editorRef, (state) => state.matches('ready'));
  const desktopLayout = useSelector(editorRef, (state) => state.context.panelState.desktopLayout);
  const singleLane = isTablet || (isCompact ?? false);
  const compactAuxiliary = singleLane ? resolveCompactAuxiliary(desktopLayout) : undefined;
  const chatVisible = desktopLayout.chatOpen && (!singleLane || compactAuxiliary === 'chat');
  const workbenchVisible = desktopLayout.workbenchOpen && (!singleLane || compactAuxiliary === 'workbench');
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
        <div className='flex size-full flex-col overflow-hidden bg-background'>
          {/* SinopiaCAD: one bar across Misure, the model and the agent (UI-UX-SinopiaCAD §3.1). */}
          <ProjectTopBar />
          <div
            ref={containerRef}
            className='relative min-h-0 flex-1 overflow-hidden'
            data-project-workspace
            data-compact={isCompact}
          >
            {/* Until the editor state has loaded and the focused chat exists, the
              lanes stand in at their default widths rather than a blank page. */}
            <ChatInterfaceSessionGate fallback={<WorkspaceSkeleton />}>
              {isClient && isEditorReady ? (
                /* SinopiaCAD: Misure on the left, the model in the middle, the agent on the right. Each side lane's
                 toggle heads its own header while it shows and the viewer's while it does not. */
                <>
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
                      visible={workbenchVisible && !isTablet}
                    >
                      <div className='size-full'>{isTablet ? null : <WorkbenchDockview />}</div>
                    </Allotment.Pane>

                    <Allotment.Pane key='viewer' minSize={panelMinSizeViewer} priority={LayoutPriority.High}>
                      {/* SinopiaCAD: no file tabs over the model (UI-UX-SinopiaCAD §3.3). The viewer keeps one invisible
                      tab; `global.css` hides its tab bar (file names, split, «+»), and the top bar holds its actions. */}
                      <div
                        data-viewer-tab-bar='hidden'
                        className='@container/viewer relative size-full overflow-hidden'
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
                      visible={chatVisible && !isTablet}
                    >
                      {isTablet ? null : (
                        <ChatHistoryGate>
                          <ChatHistory
                            isExpanded={desktopLayout.chatOpen}
                            setIsExpanded={(value) => {
                              setChatOpen(typeof value === 'function' ? value(desktopLayout.chatOpen) : value);
                            }}
                          />
                        </ChatHistoryGate>
                      )}
                    </Allotment.Pane>
                  </Allotment>
                  {isTablet && compactAuxiliary !== undefined ? (
                    <TabletLane
                      label={t(chatVisible ? 'home.agentLane.label' : 'project.lanes.measures')}
                      side={chatVisible ? 'right' : 'left'}
                      onClose={() => {
                        (chatVisible ? setChatOpen : setWorkbenchOpen)(false);
                      }}
                    >
                      {chatVisible ? (
                        <ChatHistoryGate>
                          <ChatHistory />
                        </ChatHistoryGate>
                      ) : (
                        <WorkbenchDockview />
                      )}
                    </TabletLane>
                  ) : null}
                </>
              ) : (
                <WorkspaceSkeleton />
              )}
            </ChatInterfaceSessionGate>
          </div>
        </div>
      </WorkspaceLanesContext.Provider>
    </ChatContextInsertionProvider>
  );
});
