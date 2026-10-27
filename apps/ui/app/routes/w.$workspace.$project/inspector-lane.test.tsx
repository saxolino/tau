import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryComponentNode } from '@taucad/types';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { InspectorSelection } from '#lib/inspector-selection.js';

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const frame: GeometryComponentNode = {
  id: 'frame',
  name: 'Telaio fibbia',
  kind: 'part',
  selector: 'frame',
  childIds: [],
  depth: 0,
  path: [],
  meshNodeIndices: [],
  primitiveIndices: [],
  materialIndices: [],
  capabilities,
  extras: { manualBounds: { min: [-18, -12.5, -2], max: [18, 12.5, 2] } },
};

type LaneState = {
  selection: InspectorSelection;
  expanded: boolean;
  scalePiece: ((componentId: string, factor: number) => Promise<boolean>) | undefined;
};
const state = vi.hoisted(
  (): LaneState => ({ selection: { kind: 'model', pieceCount: 2 }, expanded: false, scalePiece: undefined }),
);
const workspace = vi.hoisted(() => ({
  setInspectorSlot: vi.fn(),
  setInspectorHistorySlot: vi.fn(),
  setAssistantExpanded: vi.fn(),
  setChatOpen: vi.fn(),
}));

vi.mock('#hooks/use-inspector-selection.js', () => ({
  useInspectorSelection: () => ({
    selection: state.selection,
    piece:
      state.selection.kind === 'model'
        ? undefined
        : { node: state.selection.node, manifest: { sourceFile: 'main.ts' }, unitId: 'unit' },
  }),
}));
vi.mock('#routes/w.$workspace.$project/project-workspace-context.js', () => ({
  useProjectWorkspace: () => ({ ...workspace, assistantExpanded: state.expanded, scalePiece: state.scalePiece }),
  useWorkspaceLanes: () => ({ chat: true, workbench: true }),
}));
vi.mock('#components/chat/assistant-dock.js', () => ({
  AssistantDock: ({ isExpanded }: { readonly isExpanded: boolean }) => (
    <section aria-label='Assistente' data-expanded={isExpanded} />
  ),
}));
vi.mock('#routes/w.$workspace.$project/chat-parameters.js', () => ({ useProjectParametersSource: () => ({}) }));
// The recognition card has its own test (`inspector-recognition.test.tsx`); here it is a slot of the lane.
vi.mock('#routes/w.$workspace.$project/inspector-serie.js', () => ({ InspectorSerie: () => undefined }));
vi.mock('#routes/w.$workspace.$project/inspector-recognition.js', () => ({ InspectorRecognition: () => undefined }));
vi.mock('#routes/w.$workspace.$project/piece-measures-pane.js', () => ({
  InspectorPieceMeasures: ({ frame: wrap }: { readonly frame: (measures: React.ReactNode) => React.JSX.Element }) =>
    wrap(<div data-testid='piece-parameters' />),
}));

const { InspectorLane } = await import('#routes/w.$workspace.$project/inspector-lane.js');

const renderLane = (isVisible = true) =>
  render(
    <KeyboardProvider>
      <TooltipProvider>
        <InspectorLane isVisible={isVisible} />
      </TooltipProvider>
    </KeyboardProvider>,
  );

beforeEach(() => {
  setLanguage('it');
  state.selection = { kind: 'model', pieceCount: 2 };
  state.expanded = false;
  state.scalePiece = undefined;
  vi.clearAllMocks();
});
afterEach(() => {
  resetLanguageForTests();
});

describe('InspectorLane', () => {
  it('should follow the selection: the model, a piece with its size, a face, some edges', () => {
    const { rerender } = renderLane();
    const lane = screen.getByRole('region', { name: 'Ispettore' });
    expect(lane).toHaveTextContent('Modello');
    expect(screen.getByRole('heading', { name: 'Tutto il modello' })).toBeInTheDocument();
    expect(lane).toHaveTextContent('2 pezzi');
    expect(screen.queryByText('Ingombro')).not.toBeInTheDocument();

    state.selection = { kind: 'piece', node: frame };
    rerender(
      <KeyboardProvider>
        <TooltipProvider>
          <InspectorLane isVisible />
        </TooltipProvider>
      </KeyboardProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Telaio fibbia' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Porta lunghezza a…' })).toHaveValue('36,0');
    expect(screen.getByRole('textbox', { name: 'Porta profondità a…' })).toHaveValue('25,0');
    expect(screen.getByRole('textbox', { name: 'Porta altezza a…' })).toHaveValue('4,0');
    expect(screen.getByRole('region', { name: 'Misure del pezzo' })).toContainElement(
      screen.getByTestId('piece-parameters'),
    );

    state.selection = { kind: 'face', node: frame, direction: 'top' };
    rerender(
      <KeyboardProvider>
        <TooltipProvider>
          <InspectorLane isVisible />
        </TooltipProvider>
      </KeyboardProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Faccia superiore · Telaio fibbia' })).toBeInTheDocument();

    state.selection = { kind: 'edge', node: frame, edgeCount: 2 };
    rerender(
      <KeyboardProvider>
        <TooltipProvider>
          <InspectorLane isVisible />
        </TooltipProvider>
      </KeyboardProvider>,
    );
    expect(screen.getByRole('heading', { name: '2 spigoli · Telaio fibbia' })).toBeInTheDocument();
  });

  it('should keep the size read-only without a scaler and scale the piece in proportion with one', async () => {
    const user = userEvent.setup();
    state.selection = { kind: 'piece', node: frame };
    const { unmount } = renderLane();
    expect(screen.getByRole('textbox', { name: 'Porta lunghezza a…' })).toHaveAttribute('readonly');
    unmount();
    const scale = vi.fn(async () => true);
    state.scalePiece = scale;
    renderLane();
    expect(screen.getByText('Modificabile in proporzione')).toBeInTheDocument();
    const length = screen.getByRole('textbox', { name: 'Porta lunghezza a…' });
    await user.clear(length);
    await user.type(length, '45{Enter}');
    expect(scale).toHaveBeenCalledExactlyOnceWith('frame', 1.25);
    // Esc puts the value back and scales nothing.
    await user.clear(length);
    await user.type(length, '50{Escape}');
    expect(length).toHaveValue('36,0');
    expect(scale).toHaveBeenCalledOnce();
  });

  it('should host the viewer’s tools and history only while it is on screen', () => {
    const { unmount } = renderLane(true);
    expect(workspace.setInspectorSlot).toHaveBeenLastCalledWith(expect.any(HTMLDivElement));
    expect(workspace.setInspectorHistorySlot).toHaveBeenLastCalledWith(expect.any(HTMLDivElement));
    unmount();
    expect(workspace.setInspectorSlot).toHaveBeenLastCalledWith(undefined);
    vi.clearAllMocks();
    renderLane(false);
    expect(workspace.setInspectorSlot).toHaveBeenLastCalledWith(undefined);
  });

  it('should keep the assistant under the inspector and open its conversation with ⌃J', async () => {
    const user = userEvent.setup();
    renderLane();
    expect(screen.getByRole('region', { name: 'Assistente' })).toHaveAttribute('data-expanded', 'false');
    await user.keyboard('{Control>}j{/Control}');
    expect(workspace.setAssistantExpanded).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('should hide itself from its own header', async () => {
    const user = userEvent.setup();
    renderLane();
    await user.click(screen.getByRole('button', { name: 'Nascondi l’ispettore' }));
    expect(workspace.setChatOpen).toHaveBeenCalledExactlyOnceWith(false);
  });
});
