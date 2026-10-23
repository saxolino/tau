import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActor } from 'xstate';
import type { Actor } from 'xstate';
import { modelInteractionMachine } from '@taucad/viewer/machines/model-interaction.machine';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { SelectedPieceChip } from '#components/chat/selected-piece-chip.js';
import { ChatContextInsertionProvider, useChatContextInsertion } from '#components/chat/chat-context-insertion.js';
import type { ChatContextReference } from '#components/chat/chat-context-insertion.js';
import { setLanguage } from '#i18n/language.js';

const state = vi.hoisted(
  (): {
    actor?: Actor<typeof modelInteractionMachine>;
    insert: ReturnType<typeof vi.fn<(references: ChatContextReference[]) => void>>;
    open: ReturnType<typeof vi.fn>;
  } => ({ insert: vi.fn(), open: vi.fn() }),
);
vi.mock('#hooks/use-project.js', () => ({
  useProject: () => ({ modelInteractionRef: state.actor, mainEntryPath: 'main.ts', geometryUnits: new Map() }),
  useParameterSetActor: () => undefined,
}));
vi.mock('#routes/w.$workspace.$project/project-workspace-context.js', () => ({
  useProjectWorkspace: () => ({ setChatOpen: state.open }),
}));
const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const node: GeometryComponentNode = {
  id: 'component:rametto_sx',
  name: 'rametto_sx',
  kind: 'part',
  selector: '/nodes/0',
  childIds: [],
  depth: 1,
  path: ['rametto_sx'],
  meshNodeIndices: [],
  primitiveIndices: [],
  materialIndices: [],
  capabilities,
};
const manifest: GeometryComponentManifest = {
  schemaVersion: 1,
  sourceFile: 'main.ts',
  rootId: 'root',
  nodeOrder: [node.id],
  nodesById: { [node.id]: node },
  capabilities,
};
function Inserter(): undefined {
  const { registerContextReferenceInserter } = useChatContextInsertion();
  useEffect(() => {
    registerContextReferenceInserter(state.insert);
    return () => {
      registerContextReferenceInserter(undefined);
    };
  }, [registerContextReferenceInserter]);
  return undefined;
}
function Harness({ isComposerMounted = false }: { readonly isComposerMounted?: boolean }): React.JSX.Element {
  return (
    <TooltipProvider>
      <ChatContextInsertionProvider>
        <SelectedPieceChip location='viewer' entryPath='main.ts' />
        <SelectedPieceChip location='composer' />
        {isComposerMounted ? <Inserter /> : null}
      </ChatContextInsertionProvider>
    </TooltipProvider>
  );
}
beforeEach(() => {
  setLanguage('it');
  state.insert.mockClear();
  state.open.mockClear();
  state.actor = createActor(modelInteractionMachine, { input: {} }).start();
  state.actor.send({ type: 'loadManifest', unitId: 'file:main.ts', manifest });
});
afterEach(() => state.actor?.stop());
describe('selected piece chips', () => {
  it('should show current selection in view and composer, then clear both from the chip', async () => {
    render(<Harness />);
    expect(screen.queryByText(/Stai guardando/)).not.toBeInTheDocument();
    act(() =>
      state.actor?.send({ type: 'selectComponent', unitId: 'file:main.ts', componentId: node.id, source: 'viewer' }),
    );
    expect(screen.getByText('Stai guardando: Rametto sinistro')).toBeVisible();
    expect(screen.getByText('Rametto sinistro')).toBeVisible();
    await userEvent.click(screen.getAllByRole('button', { name: 'Deseleziona il pezzo' })[0]!);
    expect(screen.queryByText(/Stai guardando/)).not.toBeInTheDocument();
    expect(state.actor?.getSnapshot().context.unitsById['file:main.ts']?.selectedComponentIds).toEqual([]);
  });
  it('should open the agent and retain the structured reference until its composer mounts', async () => {
    state.actor?.send({ type: 'selectComponent', unitId: 'file:main.ts', componentId: node.id, source: 'viewer' });
    const view = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Chiedi all’agente' }));
    expect(state.open).toHaveBeenCalledWith(true);
    expect(state.insert).not.toHaveBeenCalled();
    view.rerender(<Harness isComposerMounted />);
    expect(state.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        chipType: 'geometry',
        label: 'Rametto sinistro',
        referenceToken: '@cad[main.ts#component:rametto_sx]',
        geometryReference: {
          scheme: 'tau-cad',
          componentId: node.id,
          filePath: 'main.ts',
          label: 'Rametto sinistro',
          selector: node.selector,
          kind: 'part',
          geometryHash: undefined,
        },
      }),
    ]);
  });
});
