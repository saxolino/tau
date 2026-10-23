// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import {
  modelInteractionMachine,
  createSourceModelInteractionUnitId,
} from '@taucad/viewer/machines/model-interaction.machine';
import { TurnModelSummary } from '#components/chat/turn-summary-card.js';
import { setLanguage } from '#i18n/language.js';
const compare = vi.hoisted(() => vi.fn());
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'project', modelInteractionRef: actor }) }));
vi.mock('#hooks/use-revision-status.js', () => ({ useRevisionClient: () => ({ compare }) }));
vi.mock('#hooks/use-revisions.js', () => ({
  useTurnRevision: () => ({ revisionId: 'revision', n: 3 }),
  useRevisionChanges: () => [
    { path: '.tau/parameters/a.ts.json', kind: 'modified' },
    { path: '.tau/parameters/b.ts.json', kind: 'modified' },
  ],
  useRevisionCards: () => new Map(),
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
  id: 'bezel',
  name: 'castone',
  kind: 'part',
  selector: '/nodes/0',
  childIds: [],
  depth: 1,
  path: ['castone'],
  meshNodeIndices: [],
  primitiveIndices: [],
  materialIndices: [],
  capabilities,
};
const manifest = (sourceFile: string): GeometryComponentManifest => ({
  schemaVersion: 1,
  sourceFile,
  rootId: node.id,
  nodeOrder: [node.id],
  nodesById: { [node.id]: node },
  capabilities,
});
const actor = createActor(modelInteractionMachine, { input: {} }).start();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => {
  client.clear();
});
const record = (value: number): string =>
  JSON.stringify({
    activeGroup: 'default',
    groups: { default: { values: { castone: { parete: value } }, units: { '/castone/parete': 'mm' } } },
  });
describe('turn summary model integration', () => {
  it('should derive a saved turn difference and select its exact source model when piece IDs repeat', async () => {
    setLanguage('it');
    for (const path of ['a.ts', 'b.ts']) {
      actor.send({ type: 'loadManifest', unitId: createSourceModelInteractionUnitId(path), manifest: manifest(path) });
    }
    compare.mockResolvedValue({
      original: record(0.3),
      modified: record(0.4),
      kind: 'text',
      change: 'modified',
      notices: [],
    });
    const view = render(
      <QueryClientProvider client={client}>
        <TurnModelSummary turnId='turn' />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Cosa ho cambiato · Rev 3'));
    const pieces = await screen.findAllByRole('button', { name: 'Castone' });
    expect(screen.getAllByText(/0,3 mm → 0,4 mm/u)).toHaveLength(2);
    act(() => {
      fireEvent.click(pieces[1]!);
    });
    expect(
      actor.getSnapshot().context.unitsById[createSourceModelInteractionUnitId('a.ts')]?.selectedComponentIds,
    ).toEqual([]);
    expect(
      actor.getSnapshot().context.unitsById[createSourceModelInteractionUnitId('b.ts')]?.selectedComponentIds,
    ).toEqual(['bezel']);
    expect(compare).toHaveBeenCalledWith('revision', '.tau/parameters/b.ts.json');
    view.unmount();
    actor.stop();
  });
});
