import { setLanguage } from '#i18n/language.js';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import type * as ProjectWorkspaceContext from '#routes/w.$workspace.$project/project-workspace-context.js';

const viewport = vi.hoisted(() => ({ mode: 'desktop' }));
const workspaceUi = vi.hoisted(() => ({ assistantEntryOpen: false }));
const setChatOpen = vi.hoisted(() => vi.fn());
vi.mock('#hooks/use-cad-viewport.js', () => ({ useCadViewport: () => viewport.mode }));
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
  useProjectWorkspace: () => ({ setChatOpen, setWorkbenchOpen, ...workspaceUi }),
}));
/* The right lane (inspector with the assistant under it) has its own suites; here it only has to take its place. */
vi.mock('#routes/w.$workspace.$project/inspector-lane.js', () => ({
  InspectorLane: ({ isVisible }: { readonly isVisible: boolean }) => (
    <div data-testid='chat-lane' data-hosts-tools={isVisible}>
      <input aria-label='Assistant message' />
      <button type='button'>Assistant composer action</button>
    </div>
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
  WorkbenchDockview: () => (
    <div data-testid='workbench-lane'>
      <button type='button'>Piece inspector action</button>
    </div>
  ),
}));
vi.mock('#routes/w.$workspace.$project/project-unavailable-overlay.js', () => ({
  ProjectUnavailableOverlay: () => null,
}));
vi.mock('#components/ui/sidebar.js', () => ({ useSidebar: () => sidebar }));
/* The bar has its own suite (`project-top-bar.test.tsx`); here it only has to head the workspace. */
vi.mock('#routes/w.$workspace.$project/project-top-bar.js', () => ({
  ProjectTopBar: () => <section aria-label='Project bar' data-testid='top-bar' />,
}));
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
    setLanguage('en');
    viewport.mode = 'desktop';
    workspaceUi.assistantEntryOpen = false;
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

  it('should show one tablet sheet over the same viewer when switching lanes', () => {
    setLanguage('it');
    viewport.mode = 'tablet';
    renderDesktop();
    const viewer = screen.getByTestId('viewer-lane');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Ispettore' })).toContainElement(screen.getByTestId('chat-lane'));
    expect(screen.queryByTestId('workbench-lane')).not.toBeInTheDocument();
    desktopLayout.compactAuxiliary = 'workbench';
    resizeTo(compactWorkspaceWidth - 1);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Pezzi e misure' })).toContainElement(
      screen.getByTestId('workbench-lane'),
    );
    expect(screen.queryByTestId('chat-lane')).not.toBeInTheDocument();
    expect(screen.getByTestId('viewer-lane')).toBe(viewer);
  });

  it('should keep Misure, the model and the inspector together: no mode closes a lane', () => {
    renderDesktop();
    const viewer = screen.getByTestId('viewer-lane');
    const lane = screen.getByTestId('chat-lane');
    const pieces = screen.getByTestId('workbench-lane');
    expect(paneOf('chat-lane')).toHaveAttribute('data-visible', 'true');
    expect(paneOf('workbench-lane')).toHaveAttribute('data-visible', 'true');
    // The visible inspector hosts the viewer's tools; nothing else decides whether they are on.
    expect(lane).toHaveAttribute('data-hosts-tools', 'true');
    expect(screen.getByRole('textbox', { name: 'Assistant message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Piece inspector action' })).toBeInTheDocument();
    // Only the width makes them share: below the compact boundary one auxiliary stays, the viewer never moves.
    resizeTo(compactWorkspaceWidth - 1);
    expect(paneOf('workbench-lane')).toHaveAttribute('data-visible', 'false');
    expect(pieces.closest('[data-slot=workbench-lane-content]')).toHaveAttribute('inert');
    expect(screen.getByTestId('chat-lane')).toBe(lane);
    expect(screen.getByTestId('viewer-lane')).toBe(viewer);
  });

  it('shows and hides the inspector lane with ⌃C, by what is on screen', async () => {
    const user = userEvent.setup();
    renderDesktop();
    await screen.findByTestId('viewer-lane');
    await user.keyboard('{Control>}c{/Control}');
    expect(setChatOpen).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('should open the entry assistant locally even when the saved lanes are closed', () => {
    desktopLayout.chatOpen = false;
    desktopLayout.workbenchOpen = false;
    workspaceUi.assistantEntryOpen = true;
    renderDesktop();
    resizeTo(compactWorkspaceWidth - 1);
    expect(paneOf('chat-lane')).toHaveAttribute('data-visible', 'true');
    expect(paneOf('workbench-lane')).toHaveAttribute('data-visible', 'false');
    expect(send).not.toHaveBeenCalled();
  });

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

    resizeTo(1500);
    resizeTo(1450);
    resizeTo(compactWorkspaceWidth);
    expect(renderViewer).not.toHaveBeenCalled();

    resizeTo(compactWorkspaceWidth - 1);
    expect(renderViewer).toHaveBeenCalledOnce();
    expect(paneOf('workbench-lane')).toHaveAttribute('data-visible', 'false');
    renderViewer.mockClear();
    resizeTo(900);
    expect(renderViewer).not.toHaveBeenCalled();
  });

  /* Below 1360 the viewport retains useful working space beside one auxiliary. */
  it('uses the 1359/1360 workspace boundary and keeps all three pane children stable', async () => {
    renderDesktop();
    const viewer = await screen.findByTestId('viewer-lane');
    expect(compactWorkspaceWidth).toBe(1360);
    expect(compactWorkspaceWidth).toBeGreaterThan(1280 - 224);

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
    expect(workbenchLane).toHaveClass('@min-[1360px]:flex', 'border-r');
    expect(compactWorkspaceWidth).toBe(1360);
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

  /* SinopiaCAD (UI-UX-SinopiaCAD §3.1, §3.3): one bar across the three lanes, and no file tabs over the model. */
  it('heads the three lanes with the project’s top bar, which leaves room for the window’s own controls', async () => {
    sidebar.open = false;
    renderDesktop();
    await screen.findByTestId('viewer-lane');

    const bar = screen.getByTestId('top-bar');
    expect(bar.nextElementSibling).toContainElement(screen.getByTestId('allotment'));
    // The lanes' own headers reserve nothing: the bar takes the inset the leftmost header used to.
    expect(screen.getByTestId('workbench-lane').parentElement).not.toHaveClass(/titlebar-controls-width/u);
    expect(screen.getByTestId('viewer-lane').parentElement?.className).not.toMatch(/titlebar-controls-width/u);
  });

  it('hides the viewer’s tab bar, so no file name or split control shows over the model', async () => {
    renderDesktop();
    const viewer = await screen.findByTestId('viewer-lane');

    // `global.css` hides the tab bar under this attribute (Dockview's own styles are unlayered).
    expect(viewer.parentElement).toHaveAttribute('data-viewer-tab-bar', 'hidden');
    expect(screen.getByTestId('workbench-lane').parentElement).not.toHaveAttribute('data-viewer-tab-bar');
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

  it('leaves the lane toggles to the top bar and the lane headers, with nothing floating over them', async () => {
    renderDesktop();
    await screen.findByTestId('viewer-lane');

    const workspaceButtons = screen
      .queryAllByRole('button')
      .filter((button) => !button.closest('[data-slot=chat-lane-content], [data-slot=workbench-lane-content]'));
    expect(workspaceButtons).toHaveLength(0);
  });

  it('does not render a workspace-global Files toggle', async () => {
    renderDesktop();

    await screen.findByTestId('viewer-lane');
    expect(screen.queryByRole('button', { name: /files pane/i })).not.toBeInTheDocument();
  });
});
