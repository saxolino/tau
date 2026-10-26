import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mock } from 'vitest-mock-extended';
import type { RJSFSchema } from '@rjsf/utils';
import { createActor } from 'xstate';
import type { Actor } from 'xstate';
import { modelInteractionMachine } from '@taucad/viewer/machines/model-interaction.machine';
import type { GeometryComponentManifest, GeometryComponentNode, FileParameterEntry } from '@taucad/types';
import type { ParameterManifest } from '@taucad/parameters';
import type { ParametersSource } from '@taucad/workbench-panes/parameters/parameters-source';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { PieceMeasuresPane } from '#routes/w.$workspace.$project/piece-measures-pane.js';
import { setLanguage } from '#i18n/language.js';

const project = vi.hoisted(
  (): {
    modelInteractionRef?: Actor<typeof modelInteractionMachine>;
    geometryUnits: Map<string, undefined>;
  } => ({ geometryUnits: new Map([['main.ts', undefined]]) }),
);
vi.mock('#hooks/use-project.js', () => ({ useProject: () => project }));
const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const part = (name: string): GeometryComponentNode => ({
  id: `component:${name}`,
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
const stelo = part('stelo');
const stone = part('marquise');
const componentManifest: GeometryComponentManifest = {
  schemaVersion: 1,
  sourceFile: 'main.ts',
  rootId: 'root',
  nodeOrder: [stelo.id, stone.id],
  nodesById: { [stelo.id]: stelo, [stone.id]: stone },
  capabilities,
};
const schema: RJSFSchema = {
  type: 'object',
  properties: {
    stelo: {
      type: 'object',
      properties: { spessore: { type: 'number', description: '[sinopia:assumed] Hidden thickness' } },
    },
    marquise: { type: 'object', properties: { lunghezza: { type: 'number' } } },
    distanza: { type: 'number' },
  },
};
const manifest: ParameterManifest = {
  ...mock<ParameterManifest>(),
  defaults: { stelo: { spessore: 1.4 }, marquise: { lunghezza: 10 }, distanza: 3 },
  legacyProjection: { status: 'usable', dialect: 'draft-07', schema, diagnostics: [] },
  bindings: {},
  bindingDeclarations: {},
  provenance: {},
};
let entry: FileParameterEntry;
const drafts = { draft: () => undefined, setDraft: vi.fn(), subscribe: () => () => undefined };
const source: ParametersSource = {
  useEntry: () => ({ manifest, entry, failure: undefined }),
  commitValue: vi.fn(),
  replaceValues: vi.fn(),
  drafts,
};
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const scrollIntoView = vi.fn();
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true });
afterAll(() => {
  if (originalScroll) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});
const setup = () =>
  render(
    <TooltipProvider>
      <PieceMeasuresPane source={source} />
    </TooltipProvider>,
  );
beforeEach(() => {
  setLanguage('it');
  entry = { activeGroup: 'default', groups: { default: { values: {} } } };
  project.modelInteractionRef = createActor(modelInteractionMachine, { input: {} }).start();
  project.modelInteractionRef.send({ type: 'loadManifest', unitId: 'file:main.ts', manifest: componentManifest });
});
afterEach(() => project.modelInteractionRef?.stop());
describe('piece measures interactions', () => {
  it('should select from a group, follow viewer selection, open its measures and clear with Escape', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Stelo/ }));
    expect(project.modelInteractionRef?.getSnapshot().context.unitsById['file:main.ts']?.selectedComponentIds).toEqual([
      stelo.id,
    ]);
    expect(screen.getByText('Ipotesi: controlla')).toBeVisible();
    expect(screen.queryByText('[sinopia:assumed] Hidden thickness')).not.toBeInTheDocument();
    act(() =>
      project.modelInteractionRef?.send({
        type: 'selectComponent',
        unitId: 'file:main.ts',
        componentId: stone.id,
        source: 'viewer',
      }),
    );
    expect(screen.getByRole('button', { name: /^Marquise/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Stelo/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(screen.getByRole('button', { name: /^Marquise/ }), { key: 'Escape' });
    expect(project.modelInteractionRef?.getSnapshot().context.unitsById['file:main.ts']?.selectedComponentIds).toEqual(
      [],
    );
  });
  it('should hide and show through shared visibility, retain General, and search for a piece', async () => {
    setup();
    const user = userEvent.setup();
    expect(screen.getByText('2 pezzi · 1 pietra')).toBeVisible();
    const general = screen.getByRole('button', { name: 'Misure comuni' });
    expect(general).toBeVisible();
    expect(general).toHaveAttribute('aria-expanded', 'false');
    const pieces = [...document.querySelectorAll('[data-slot=piece-measures-group]')];
    expect(pieces.at(-1)).toContainElement(general);
    await user.click(screen.getByRole('button', { name: 'Nascondi Stelo' }));
    expect(project.modelInteractionRef?.getSnapshot().context.unitsById['file:main.ts']?.hiddenComponentIds).toContain(
      stelo.id,
    );
    await user.click(screen.getByRole('button', { name: 'Mostra Stelo' }));
    expect(project.modelInteractionRef?.getSnapshot().context.unitsById['file:main.ts']?.hiddenComponentIds).toEqual(
      [],
    );
    await user.type(screen.getByRole('searchbox', { name: 'Cerca una misura o un pezzo' }), 'marquise');
    expect(screen.queryByRole('button', { name: /^Stelo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Marquise/ })).toBeVisible();
  });
  it('should reset one piece without discarding another piece’s overrides', async () => {
    entry = {
      activeGroup: 'default',
      groups: { default: { values: { stelo: { spessore: 2 }, marquise: { lunghezza: 12 } } } },
    };
    setup();
    await userEvent.click(screen.getByRole('button', { name: /^Stelo/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Ripristina Spessore' }));
    expect(source.replaceValues).toHaveBeenCalledWith('main.ts', manifest, { marquise: { lunghezza: 12 } });
  });
  it('should mark a stored value with a lock even if equal to the model default', async () => {
    entry = { activeGroup: 'default', groups: { default: { values: { stelo: { spessore: 1.4 } } } } };
    setup();
    await userEvent.click(screen.getByRole('button', { name: /^Stelo/ }));
    expect(screen.getByText('Tuo valore: l’agente lo rispetta')).toBeVisible();
    expect(screen.queryByText('Ipotesi: controlla')).not.toBeInTheDocument();
  });
});
