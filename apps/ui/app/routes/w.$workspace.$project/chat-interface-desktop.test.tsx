import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import type * as ProjectWorkspaceContext from '#routes/w.$workspace.$project/project-workspace-context.js';

const send = vi.fn();
const setWorkbenchOpen = vi.hoisted(() => vi.fn());
const sidebar = vi.hoisted(() => ({ open: true }));
const renderViewer = vi.hoisted(() => vi.fn());
const desktopLayout = {
  chatOpen: true,
  workbenchOpen: true,
  chatWidth: 320,
  workbenchWidth: 280,
  compactAuxiliary: 'chat' as 'chat' | 'workbench',
  layoutRevision: 1,
};
const editorState = { isReady: true };
const snapshot = {
  context: { panelState: { desktopLayout } },
  matches: () => editorState.isReady,
};

vi.mock('@xstate/react', () => ({
  useSelector: (_actor: unknown, selector: (value: typeof snapshot) => unknown) => selector(snapshot),
}));
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ editorRef: { send } }) }));
vi.mock('#routes/w.$workspace.$project/project-workspace-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectWorkspaceContext>()),
  useProjectWorkspace: () => ({ setChatOpen: vi.fn(), setWorkbenchOpen }),
}));
vi.mock('#routes/w.$workspace.$project/chat-history.js', () => ({
  ChatHistory: ({ className }: { readonly className?: string }) => (
    <div className={className} data-testid='chat-lane' />
  ),
}));
vi.mock('#routes/w.$workspace.$project/focused-chat-gate.js', () => ({
  ChatHistoryGate: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  ChatInterfaceSessionGate: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('#routes/w.$workspace.$project/chat-pane-skeleton.js', () => ({
  ChatPaneSkeleton: () => <div data-testid='chat-skeleton' />,
}));
vi.mock('#routes/w.$workspace.$project/chat-viewer-dockview.js', () => ({
  ViewerDockview: () => {
    renderViewer();
    return <div data-testid='viewer-lane' />;
  },
}));
vi.mock('#routes/w.$workspace.$project/chat-workbench-dockview.js', () => ({
  WorkbenchDockview: () => <div data-testid='workbench-lane' />,
}));
vi.mock('#routes/w.$workspace.$project/project-unavailable-overlay.js', () => ({
  ProjectUnavailableOverlay: () => null,
}));
vi.mock('#components/ui/sidebar.js', () => ({ useSidebar: () => sidebar }));
vi.mock('#components/chat/chat-context-insertion.js', () => ({
  ChatContextInsertionProvider: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('allotment', () => {
  const Pane = ({ children, visible = true }: React.PropsWithChildren<{ readonly visible?: boolean }>) => (
    <div data-pane data-visible={visible}>
      {children}
    </div>
  );
  const Allotment = Object.assign(
    ({ children }: React.PropsWithChildren) => <div data-testid='allotment'>{children}</div>,
    { Pane },
  );
  return { Allotment, LayoutPriority: { Low: 0, High: 1 } };
});

const resizeCallbacks = new Set<ResizeObserverCallback>();
class ResizeObserverMock {
  readonly #callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    resizeCallbacks.add(callback);
  }
  public observe(): void {
    return undefined;
  }
  public disconnect(): void {
    resizeCallbacks.delete(this.#callback);
  }
  public unobserve(): void {
    return undefined;
  }
}

const resizeObserver: ResizeObserver = {
  disconnect: () => undefined,
  observe: () => undefined,
  unobserve: () => undefined,
};

const { ChatInterfaceDesktop, compactWorkspaceWidth } = await import('./chat-interface-desktop.js');
const { revealDelayMilliseconds } = await import('./workspace-skeleton.js');

const renderDesktop = () =>
  render(
    <KeyboardProvider>
      <TooltipProvider>
        <ChatInterfaceDesktop />
      </TooltipProvider>
    </KeyboardProvider>,
  );

const resizeTo = (width: number): void => {
  act(() => {
    const entry: ResizeObserverEntry = {
      borderBoxSize: [{ inlineSize: width, blockSize: 800 }],
      contentBoxSize: [{ inlineSize: width, blockSize: 800 }],
      contentRect: DOMRect.fromRect({ width, height: 800 }),
      devicePixelContentBoxSize: [{ inlineSize: width, blockSize: 800 }],
      target: document.body,
    };
    for (const callback of resizeCallbacks) {
      callback([entry], resizeObserver);
    }
  });
};

describe('ChatInterfaceDesktop', () => {
  beforeEach(() => {
    resizeCallbacks.clear();
    desktopLayout.chatOpen = true;
    desktopLayout.workbenchOpen = true;
    desktopLayout.compactAuxiliary = 'chat';
    editorState.isReady = true;
    sidebar.open = true;
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 1400 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const paneOf = (testId: string): Element | undefined =>
    screen.getByTestId(testId).closest('[data-pane]') ?? undefined;

  it('places Misure on the left, the model in the middle and the agent on the right', async () => {
    renderDesktop();
    await screen.findByTestId('viewer-lane');

    const panes = [...document.querySelectorAll('[data-pane]')];
    expect(panes).toHaveLength(3);
    expect(panes[0]).toContainElement(screen.getByTestId('workbench-lane'));
    expect(panes[1]).toContainElement(screen.getByTestId('viewer-lane'));
    expect(panes[2]).toContainElement(screen.getByTestId('chat-lane'));
  });

  it('should initialize the compact lanes before displaying the workspace', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 1023.5 }));
    renderDesktop();

    expect(paneOf('workbench-lane')).toHaveAttribute('data-visible', 'false');
    expect(paneOf('chat-lane')).toHaveAttribute('data-visible', 'true');
  });

  it('should rerender the workspace only when resizing crosses the compact boundary', async () => {
    renderDesktop();
    await screen.findByTestId('viewer-lane');
    resizeTo(1400);
    renderViewer.mockClear();

    resizeTo(1300);
    resizeTo(1200);
    resizeTo(compactWorkspaceWidth);
    expect(renderViewer).not.toHaveBeenCalled();

    resizeTo(compactWorkspaceWidth - 1);
    expect(renderViewer).toHaveBeenCalledOnce();
    expect(paneOf('workbench-lane')).toHaveAttribute('data-visible', 'false');
    renderViewer.mockClear();
    resizeTo(900);
    expect(renderViewer).not.toHaveBeenCalled();
  });

  /* A 1280 px window with the 224 px sidebar leaves a 1056 px workspace: Misure (280), the viewer and the agent (320)
   * all fit, the viewer above its 416 px minimum. */
  it('uses the 1023/1024 workspace boundary and keeps all three pane children stable', async () => {
    renderDesktop();
    const viewer = await screen.findByTestId('viewer-lane');
    expect(compactWorkspaceWidth).toBe(1024);
    expect(compactWorkspaceWidth).toBeLessThanOrEqual(1280 - 224);

    resizeTo(compactWorkspaceWidth - 1);
    expect(paneOf('chat-lane')).toHaveAttribute('data-visible', 'true');
    expect(paneOf('workbench-lane')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('viewer-lane')).toBe(viewer);

    resizeTo(compactWorkspaceWidth);
    expect(paneOf('chat-lane')).toHaveAttribute('data-visible', 'true');
    expect(paneOf('workbench-lane')).toHaveAttribute('data-visible', 'true');
    expect(screen.getByTestId('viewer-lane')).toBe(viewer);
    expect(document.querySelectorAll('[data-pane]')).toHaveLength(3);
  });

  /* The editor state loads from storage before the lanes can take their
   * persisted widths; the lanes stand in at their defaults, never a blank. */
  it('shows the workspace skeleton instead of a blank while the editor state loads', async () => {
    editorState.isReady = false;
    /* Inside the load's first blink, where the lanes still ease in. */
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    renderDesktop();

    const skeleton = await screen.findByRole('status', { name: 'Opening project' });
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('chat-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('allotment')).not.toBeInTheDocument();
    /* The Misure lane drops at the compact width through the skeleton's own container query,
     * which jsdom does not evaluate: the class is the assertion, the width is checked in a browser. */
    const workbenchLane = skeleton.querySelector('[data-slot="workspace-skeleton-workbench"]');
    expect(workbenchLane).toHaveClass('@min-[1024px]:flex', 'border-r');
    expect(compactWorkspaceWidth).toBe(1024);
    // The agent stands in on the right, after the viewer.
    expect(workbenchLane?.nextElementSibling?.nextElementSibling).toContainElement(screen.getByTestId('chat-skeleton'));
    /* The frame paints at once; its lanes wait out a blink, so a warm load never flashes them. */
    expect(skeleton).toHaveClass('bg-background');
    expect(skeleton.querySelector('[data-slot="workspace-skeleton-lanes"]')).toHaveClass(
      'animate-in',
      'fade-in',
      'fill-mode-both',
      '[animation-delay:300ms]',
      'motion-reduce:animate-none',
    );
    clock.mockRestore();
  });

  /* Opening a project hands the skeleton from gate to gate. The blink belongs to the load, not to
   * each mount, or the lanes would fade in again at every handover and spend the wait invisible. */
  it('spends the blink once per load, so a later gate shows the lanes at once', async () => {
    editorState.isReady = false;
    const clock = vi.spyOn(performance, 'now').mockReturnValue(revealDelayMilliseconds);
    renderDesktop();

    const skeleton = await screen.findByRole('status', { name: 'Opening project' });
    expect(skeleton.querySelector('[data-slot="workspace-skeleton-lanes"]')).not.toHaveClass('animate-in');
    clock.mockRestore();
  });

  const titlebarInset =
    '[&_.dv-tabs-and-actions-container:not(.dv-view:not(:first-child)_*)]:before:w-[calc(var(--titlebar-controls-width)-var(--spacing))]';

  it('reserves fixed-control space inside the Misure lane header while it leads the workspace', async () => {
    sidebar.open = false;
    renderDesktop();
    // One spacing step short: the Misure toggle leads the tab bar with `pl-1`.
    const workbench = await screen.findByTestId('workbench-lane');
    expect(workbench.parentElement).toHaveClass(titlebarInset);
    expect(screen.getByTestId('viewer-lane').parentElement).not.toHaveClass(titlebarInset);
    // The agent lane is on the right, clear of the window's own controls.
    expect(screen.getByTestId('chat-lane')).not.toHaveAttribute('class');
  });

  it('reserves fixed-control space inside the viewer header while Misure is hidden', async () => {
    desktopLayout.workbenchOpen = false;
    sidebar.open = false;
    renderDesktop();
    const viewer = await screen.findByTestId('viewer-lane');
    expect(viewer.parentElement).toHaveClass(titlebarInset);
    expect(screen.getByTestId('workbench-lane').parentElement).not.toHaveClass(titlebarInset);
  });

  it('keeps the Viewer mounted when both auxiliary lanes are closed', async () => {
    desktopLayout.chatOpen = false;
    desktopLayout.workbenchOpen = false;
    renderDesktop();
    const viewer = await screen.findByTestId('viewer-lane');

    resizeTo(compactWorkspaceWidth - 1);
    expect(screen.getByTestId('chat-lane').closest('[data-pane]')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('workbench-lane').closest('[data-pane]')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('viewer-lane')).toBe(viewer);
    expect(document.querySelectorAll('[data-pane]')).toHaveLength(3);
  });

  it('shows and hides Misure with ⌃W, by what is on screen', async () => {
    const user = userEvent.setup();
    renderDesktop();
    await screen.findByTestId('viewer-lane');

    await user.keyboard('{Control>}w{/Control}');
    expect(setWorkbenchOpen).toHaveBeenCalledExactlyOnceWith(false);

    // Under the compact width Misure gives way to the agent, so ⌃W brings it back.
    resizeTo(compactWorkspaceWidth - 1);
    await user.keyboard('{Control>}w{/Control}');
    expect(setWorkbenchOpen).toHaveBeenLastCalledWith(true);
  });

  it('leaves the lane toggles to the lane and viewer headers, with nothing floating over them', async () => {
    renderDesktop();
    await screen.findByTestId('viewer-lane');

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not render a workspace-global Files toggle', async () => {
    renderDesktop();

    await screen.findByTestId('viewer-lane');
    expect(screen.queryByRole('button', { name: /files pane/i })).not.toBeInTheDocument();
  });
});
