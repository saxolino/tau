import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { messageRole } from '@taucad/chat/constants';
import type { MyMessagePart, MyUIMessage } from '@taucad/chat';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import { createModelAssembly } from '@taucad/viewer/graphics/three/react/model-assembly';
import type { ModelAssembly } from '@taucad/viewer/graphics/three/react/model-assembly';
import { setLanguage } from '#i18n/language.js';
import { useChatSidebarStatus } from '#hooks/use-sidebar-status.js';
import type { ChatSidebarStatus } from '#hooks/use-sidebar-status.js';
import type { ChatSidebarState } from '#types/chat-sidebar.types.js';

type SelectorState = Readonly<{ status: 'submitted' | 'streaming' | 'ready' | 'error'; messages: MyUIMessage[] }>;

const state = vi.hoisted(
  (): {
    chat: SelectorState;
    focusedChatId: string | undefined;
    reducedMotion: boolean;
    defaults: Record<string, unknown>;
  } => ({
    chat: { status: 'streaming', messages: [] },
    focusedChatId: 'chat-1',
    reducedMotion: false,
    defaults: {},
  }),
);

vi.mock('@xstate/react', () => ({
  useSelector: (actor: { getSnapshot: () => unknown } | undefined, selector: (snapshot: unknown) => unknown) =>
    selector(actor?.getSnapshot()),
}));
vi.mock('#hooks/use-chat.js', () => ({
  useChatContext: () => ({ activeChatId: 'chat-1' }),
  useChatSelector<T>(selector: (snapshot: SelectorState) => T): T {
    return selector(state.chat);
  },
}));
vi.mock('#hooks/use-sidebar-status.js', () => ({ useChatSidebarStatus: vi.fn() }));
vi.mock('#hooks/use-project.js', () => ({
  useProject: () => ({
    projectId: 'project-1',
    editorRef: { getSnapshot: () => ({ context: { focusedChatId: state.focusedChatId } }) },
    geometryUnits: new Map([
      ['main.ts', { getSnapshot: () => ({ context: { parameterManifest: { defaults: state.defaults } } }) }],
    ]),
  }),
  useParameterSetActor: () => undefined,
}));
vi.mock('#components/geometry/loader/metal-morph-playback-gates.js', () => ({
  useReducedMotion: () => state.reducedMotion,
}));

const { ViewerAgentLayer } = await import('#routes/w.$workspace.$project/viewer-cantiere.js');

const setRun = (runState: ChatSidebarState | undefined): void => {
  vi.mocked(useChatSidebarStatus).mockReturnValue(
    runState === undefined ? undefined : ({ state: runState } as unknown as ChatSidebarStatus),
  );
};

const request: MyUIMessage = {
  id: 'turn-1',
  role: messageRole.user,
  parts: [{ type: 'text', text: 'Una fibbia 30 mm per cinturino' }],
};

const answer = (...parts: MyMessagePart[]): MyUIMessage => ({ id: 'answer-1', role: messageRole.assistant, parts });

const tool = (toolName: string, isRunning = false): MyMessagePart =>
  isRunning
    ? { type: 'dynamic-tool', toolName, toolCallId: toolName, state: 'input-available', input: {} }
    : { type: 'dynamic-tool', toolName, toolCallId: toolName, state: 'output-available', input: {}, output: {} };

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const piece = (name: string): GeometryComponentNode => ({
  id: name,
  name,
  kind: 'part',
  selector: name,
  childIds: [],
  depth: 1,
  path: [name],
  meshNodeIndices: [],
  primitiveIndices: [],
  materialIndices: [],
  capabilities,
});
const buckle: GeometryComponentManifest = {
  schemaVersion: 1,
  rootId: 'root',
  nodeOrder: ['Telaio', 'Traversa', 'Ardiglione'],
  nodesById: { Telaio: piece('Telaio'), Traversa: piece('Traversa'), Ardiglione: piece('Ardiglione') },
  capabilities,
};

let assembly: ModelAssembly;

const renderLayer = (props: { isModelShown?: boolean; isModelEmpty?: boolean } = {}) =>
  render(
    <ViewerAgentLayer
      assembly={assembly}
      entryPath='main.ts'
      isModelShown={props.isModelShown ?? false}
      isModelEmpty={props.isModelEmpty ?? true}
    />,
  );

describe('ViewerAgentLayer', () => {
  beforeEach(() => {
    setLanguage('it');
    assembly = createModelAssembly();
    state.chat = { status: 'streaming', messages: [request] };
    state.focusedChatId = 'chat-1';
    state.reducedMotion = false;
    state.defaults = {};
    setRun('working');
  });
  afterEach(() => {
    cleanup();
    assembly.dispose();
    vi.useRealTimers();
  });

  // ── Cantiere ───────────────────────────────────────────────────────────────

  it('should list the agent’s steps with the last one running while it builds from an empty model', () => {
    state.chat = {
      status: 'streaming',
      messages: [request, answer(tool('use_skill'), tool('read_file'), tool('create_file', true))],
    };

    const { container } = renderLayer();

    expect(screen.getByText('Studio come costruirlo')).toBeInTheDocument();
    expect(screen.getByText('Leggo il progetto')).toBeInTheDocument();
    expect(screen.getByText('Scrivo i pezzi').closest('li')).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('Leggo il progetto').closest('li')).toHaveAttribute('data-state', 'done');
    expect(container.querySelector('[data-slot="viewer-cantiere"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('should draw the size the agent announced, quoted in millimetres', () => {
    state.chat = {
      status: 'streaming',
      messages: [request, answer({ type: 'text', text: 'Piano: telaio 38,5 × 32 mm, traversa, ardiglione.' })],
    };

    const { container } = renderLayer();

    expect(container.querySelector('[data-slot="viewer-cantiere-outline"]')).not.toBeNull();
    expect(screen.getByText('38,5 mm')).toBeInTheDocument();
    expect(screen.getByText('32 mm')).toBeInTheDocument();
  });

  it('should show only the steps when the text announces no size', () => {
    state.chat = {
      status: 'streaming',
      messages: [request, answer(tool('read_file'), { type: 'text', text: 'Preparo una fibbia da 30 mm.' })],
    };

    const { container } = renderLayer();

    expect(screen.getByText('Ragiono sul prossimo passo')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="viewer-cantiere-outline"]')).toBeNull();
  });

  it('should leave the viewer to the model once it has pieces', () => {
    const { container, rerender } = renderLayer();
    expect(container.querySelector('[data-slot="viewer-cantiere"]')).not.toBeNull();

    rerender(<ViewerAgentLayer assembly={assembly} entryPath='main.ts' isModelShown isModelEmpty={false} />);

    expect(container.querySelector('[data-slot="viewer-cantiere"]')).toBeNull();
  });

  it('should show nothing over a model with pieces or when no turn runs', () => {
    const { container, rerender } = renderLayer({ isModelShown: true, isModelEmpty: false });
    expect(container.querySelector('[data-slot="viewer-cantiere"]')).toBeNull();

    setRun('done');
    state.chat = { status: 'ready', messages: [request] };
    rerender(<ViewerAgentLayer assembly={assembly} entryPath='main.ts' isModelShown={false} isModelEmpty />);

    expect(container.querySelector('[data-slot="viewer-cantiere"]')).toBeNull();
  });

  it('should render no chat state without a focused chat', () => {
    state.focusedChatId = undefined;

    const { container } = renderLayer();

    expect(container).toBeEmptyDOMElement();
    expect(assembly.getSnapshot().request).toBeUndefined();
  });

  // ── Montaggio ──────────────────────────────────────────────────────────────

  it('should arm the viewer for the turn that builds from an empty model', () => {
    renderLayer();

    expect(assembly.getSnapshot().request).toEqual({ key: 'turn-1', stepMilliseconds: 380, holdMilliseconds: 2200 });
  });

  it('should arm with no step when the person asks for reduced motion', () => {
    state.reducedMotion = true;

    renderLayer();

    expect(assembly.getSnapshot().request?.stepMilliseconds).toBe(0);
  });

  it('should not arm the viewer when the turn changes a model with pieces', () => {
    renderLayer({ isModelShown: true, isModelEmpty: false });

    expect(assembly.getSnapshot().request).toBeUndefined();
  });

  it('should name each piece as it enters, with its measure, then count them', () => {
    vi.useFakeTimers();
    state.defaults = { telaio: { lunghezza: 38, larghezza: 32 }, ardiglione: { diametro: 2.5 } };
    const { container } = renderLayer();

    act(() => {
      assembly.present({ componentIds: buckle.nodeOrder, manifest: buckle, previousCount: 0 });
      assembly.measure({ Telaio: { x: 200, y: 150 } }, { width: 800, height: 600 });
    });
    expect(screen.getByText('Telaio')).toBeInTheDocument();
    expect(screen.getByText('38 × 32')).toBeInTheDocument();
    expect(screen.queryByText('Ardiglione')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(760);
      assembly.measure(
        { Telaio: { x: 200, y: 150 }, Traversa: { x: 200, y: 150 }, Ardiglione: { x: 260, y: 150 } },
        { width: 800, height: 600 },
      );
    });
    expect(container.querySelectorAll('[data-slot="viewer-montaggio-label"]')).toHaveLength(3);
    expect(screen.getByText('⌀ 2,5')).toBeInTheDocument();
    expect(screen.getByText('3 pezzi')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(container.querySelector('[data-slot="viewer-montaggio"]')).toBeNull();
  });
});
