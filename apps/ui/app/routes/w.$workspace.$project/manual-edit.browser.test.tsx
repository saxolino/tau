import '#styles/global.css';
import { cleanup, render } from '@testing-library/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DirectEditTool } from '@taucad/viewer/cad/direct-edit-tool';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import type { ManualDocument, ManualPointProfile } from '@taucad/smlib/manual-operations';
import { serializeManualDocument } from '@taucad/smlib/manual-operations';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { setLanguage } from '#i18n/language.js';
import { createManualEditService } from '#services/manual-edit-service.js';
import type { ManualEditAuthority } from '#services/manual-edit-service.js';
import { ManualEditPanel } from '#routes/w.$workspace.$project/manual-edit-panel.js';

declare module 'vitest/internal/browser' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Augment Vitest's browser command surface.
  interface BrowserCommands {
    dragManualPoint(label: string, movement: { x: number; y: number; cancel?: boolean }): Promise<void>;
  }
}

const targets = ['Fibbia'];
const decoder = new TextDecoder();

function createFixture(initial?: ManualDocument) {
  let bytes: Uint8Array<ArrayBuffer> | undefined = initial
    ? new TextEncoder().encode(serializeManualDocument(initial))
    : undefined;
  const listeners = new Set<() => void>();
  const authority: ManualEditAuthority = {
    read: async () => bytes,
    replace: async ({ expected, next }) => {
      if ((expected === undefined) !== (bytes === undefined) || decoder.decode(expected) !== decoder.decode(bytes)) {
        return 'conflict';
      }
      bytes = next;
      for (const listener of listeners) {
        listener();
      }
      return 'applied';
    },
    watch: (listener) => {
      listeners.add(listener);
      return {
        ready: Promise.resolve(),
        closed: Promise.withResolvers<void>().promise,
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
  };
  return { authority, service: createManualEditService(authority) };
}

type ManualService = ReturnType<typeof createManualEditService>;

function PanelFixture({ service }: Readonly<{ service: ManualService }>): React.JSX.Element {
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => service.connect(), [service]);
  return (
    <TooltipProvider>
      <div className='h-dvh w-full max-w-96'>
        <ManualEditPanel
          document={snapshot.document}
          targets={targets}
          canUndo={snapshot.canUndo}
          canRedo={snapshot.canRedo}
          isLoading={snapshot.loading}
          isSaving={snapshot.saving}
          error={snapshot.error}
          onCommit={async (next) => service.commit(next, snapshot.document)}
          onUndo={async () => service.undo()}
          onRedo={async () => service.redo()}
        />
      </div>
    </TooltipProvider>
  );
}

function DirectPanelFixture({
  commit,
  applyEdges,
}: Readonly<{
  commit: (next: ManualDocument) => Promise<boolean>;
  applyEdges: (size: number) => void;
}>): React.JSX.Element {
  const [mode, setMode] = useState<DirectEditTool['mode'] | undefined>('translate');
  const [document] = useState<ManualDocument>({ version: 1, operations: [] });
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [size, setSize] = useState(1);
  return (
    <TooltipProvider>
      <div className='h-dvh w-full max-w-96'>
        <ManualEditPanel
          document={document}
          targets={['Altro pezzo', ...targets]}
          onCommit={commit}
          onUndo={async () => false}
          onRedo={async () => false}
          canUndo={false}
          canRedo={false}
          faceControls={{
            enabled: faceEnabled,
            available: true,
            distance: 1,
            onEnableChange: setFaceEnabled,
            onDistanceChange: () => undefined,
            onApply: () => undefined,
            onCancel: () => {
              setFaceEnabled(false);
            },
          }}
          directControls={{
            mode,
            available: true,
            size,
            selected: mode ? { name: 'Fibbia', edgeCount: 2 } : undefined,
            onModeChange: setMode,
            onSizeChange: setSize,
            onApply: () => {
              applyEdges(size);
            },
            onCancel: () => {
              setMode(undefined);
            },
          }}
        />
      </div>
    </TooltipProvider>
  );
}

beforeEach(() => {
  setLanguage('it');
});
afterEach(() => {
  cleanup();
});

describe('manual geometry editing in a real browser', () => {
  it('should arm one direct tool, preserve the numeric alternative and apply selected-edge radius explicitly', async () => {
    await page.viewport(390, 900);
    const commit = vi.fn<(next: ManualDocument) => Promise<boolean>>(async () => true);
    const applyEdges = vi.fn<(size: number) => void>();
    render(<DirectPanelFixture commit={commit} applyEdges={applyEdges} />);
    await expect
      .element(page.getByRole('button', { name: 'Pezzi', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(page.getByRole('button', { name: 'Sposta', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByRole('region', { name: 'Bozza', exact: true })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Facce', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Sposta', exact: true })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Spigoli', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Estrudi faccia', exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByText('Fibbia · 2 spigoli selezionati', { exact: true })).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Raggio del raccordo', exact: true }).fill('0.6');
    await userEvent.keyboard('{Enter}');
    expect(applyEdges).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    expect(applyEdges).toHaveBeenCalledExactlyOnceWith(0.6);
    await page.getByRole('button', { name: 'Quote numeriche', exact: true }).click();
    await expect.element(page.getByRole('region', { name: 'Bozza', exact: true })).toBeVisible();
    await expect.element(page.getByRole('combobox', { name: 'Pezzo', exact: true })).toHaveTextContent('Fibbia');
    await expect.element(page.getByRole('button', { name: 'Facce', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Scala', exact: true })).toBeDisabled();
    expect(commit).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Scarta bozza', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Sposta', exact: true })).toBeEnabled();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
  it('should edit a face extrusion distance without retargeting its original guarded face', async () => {
    await page.viewport(420, 900);
    const original: ManualDocument = {
      version: 1,
      operations: [
        {
          id: 'selected-face',
          type: 'faceExtrude',
          target: { name: 'Fibbia' },
          face: { index: 2, bodySignature: 'a'.repeat(64), point: [3, 4, 5] },
          distance: 2,
        },
      ],
    };
    const fixture = createFixture(original);
    render(<PanelFixture service={fixture.service} />);
    await page.getByRole('button', { name: 'Modifica operazione 1', exact: true }).click();
    await expect.element(page.getByText('Fibbia · Faccia 3', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('combobox', { name: 'Pezzo', exact: true })).not.toBeInTheDocument();
    const distance = page.getByRole('spinbutton', { name: 'Distanza dalla faccia', exact: true });
    await distance.fill('-2');
    await userEvent.keyboard('{Enter}');
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    await vi.waitFor(() => {
      expect(fixture.service.getSnapshot().document).toEqual({
        version: 1,
        operations: [{ ...original.operations[0], distance: -2 }],
      });
    });
    await page.getByRole('button', { name: 'Annulla modifica', exact: true }).click();
    await vi.waitFor(() => {
      expect(fixture.service.getSnapshot().document).toEqual(original);
    });
  });

  it.each(['fillet', 'chamfer'] as const)(
    'should edit a saved picked-edge %s size without changing its target or selection',
    async (type) => {
      await page.viewport(420, 900);
      const original: ManualDocument = {
        version: 1,
        operations: [
          {
            id: 'selected-edge',
            type,
            target: { name: 'Fibbia' },
            size: 1,
            edges: {
              kind: 'indices',
              indices: [2],
              bodySignature: 'a'.repeat(64),
              replayWitness: 'b'.repeat(64),
              geometries: [
                {
                  kind: 'line',
                  start: [0, 0, 0],
                  end: [10, 0, 0],
                  length: 10,
                  bounds: { min: [0, 0, 0], max: [10, 0, 0] },
                  adjacentFaceCount: 2,
                  seam: false,
                  closed: false,
                },
              ],
            },
          },
        ],
      };
      const fixture = createFixture(original);
      render(<PanelFixture service={fixture.service} />);
      await page.getByRole('button', { name: 'Modifica operazione 1', exact: true }).click();
      await expect.element(page.getByText('Fibbia · Spigoli selezionati sul modello', { exact: true })).toBeVisible();
      await expect.element(page.getByRole('combobox', { name: 'Pezzo', exact: true })).not.toBeInTheDocument();
      await expect.element(page.getByRole('combobox', { name: 'Spigoli', exact: true })).not.toBeInTheDocument();
      await page.getByRole('spinbutton', { name: 'Misura', exact: true }).fill('0.6');
      await userEvent.keyboard('{Enter}');
      await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
      await vi.waitFor(() => {
        expect(fixture.service.getSnapshot().document).toEqual({
          version: 1,
          operations: [{ ...original.operations[0], size: 0.6 }],
        });
      });
      await page.getByRole('button', { name: 'Annulla modifica', exact: true }).click();
      await vi.waitFor(() => {
        expect(fixture.service.getSnapshot().document).toEqual(original);
      });
    },
  );

  it('should persist dragged profile points, reopen them and undo or redo an edited extrusion', async () => {
    await page.viewport(420, 1000);
    const fixture = createFixture();
    const mounted = render(<PanelFixture service={fixture.service} />);
    const start = page.getByRole('button', { name: 'Profilo ed estrusione', exact: true });
    await expect.element(start).toBeEnabled();
    await start.click();
    await page.getByRole('textbox', { name: 'Nome del nuovo pezzo' }).fill('Fascetta');
    const point = page.getByRole('button', { name: 'Punto 1', exact: true });
    await point.click();
    await commands.dragManualPoint('Punto 1', { x: 24, y: -18 });
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    await vi.waitFor(() => {
      expect(fixture.service.getSnapshot().document?.operations).toHaveLength(1);
    });
    const committed = fixture.service.getSnapshot().document!;
    const extrusion = committed.operations[0];
    expect(extrusion?.type).toBe('extrude');
    if (
      extrusion?.type !== 'extrude' ||
      (extrusion.profile.kind !== 'polygon' && extrusion.profile.kind !== 'spline')
    ) {
      throw new Error('Expected an extrusion');
    }
    expect(extrusion.name).toBe('Fascetta');
    expect(extrusion.profile.points[0]!.x).toBeGreaterThan(-10);
    expect(extrusion.profile.points[0]!.y).toBeGreaterThan(-10);
    mounted.unmount();
    const reopened = createManualEditService(fixture.authority);
    render(<PanelFixture service={reopened} />);
    await page.getByRole('button', { name: 'Modifica operazione 1', exact: true }).click();
    const reopenedPoint = page.getByRole('button', { name: 'Punto 1', exact: true });
    await reopenedPoint.click();
    await userEvent.keyboard('{ArrowRight}');
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    await vi.waitFor(() => {
      expect(reopened.getSnapshot().canUndo).toBe(true);
    });
    const revised = reopened.getSnapshot().document;
    expect(revised).not.toEqual(committed);
    await page.getByRole('button', { name: 'Annulla modifica', exact: true }).click();
    await vi.waitFor(() => {
      expect(reopened.getSnapshot().document).toEqual(committed);
    });
    await page.getByRole('button', { name: 'Ripristina modifica', exact: true }).click();
    await vi.waitFor(() => {
      expect(reopened.getSnapshot().document).toEqual(revised);
    });
  });

  it('should keep point insertion, deletion and validation usable at 320 pixels', async () => {
    await page.viewport(320, 740);
    const fixture = createFixture();
    render(<PanelFixture service={fixture.service} />);
    await page.getByRole('button', { name: 'Profilo ed estrusione', exact: true }).click();
    await page.getByRole('button', { name: 'Inserisci punto dopo il selezionato', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Punto 5', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Elimina punto selezionato', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Punto 5', exact: true })).not.toBeInTheDocument();
    await page.getByRole('textbox', { name: 'Nome del nuovo pezzo' }).fill('');
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('Controlla le quote e il profilo');
    expect(fixture.service.getSnapshot().document?.operations).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    await page.getByRole('textbox', { name: 'Nome del nuovo pezzo' }).fill('Fascetta stretta');
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    await vi.waitFor(() => {
      expect(fixture.service.getSnapshot().document?.operations).toHaveLength(1);
    });
    await page.screenshot({ path: '../../../../../out/test-results/vitest-browser/manual-edit/narrow.png' });
  });

  it('should preserve a stale draft and refuse to overwrite another saved edit', async () => {
    await page.viewport(420, 900);
    const fixture = createFixture();
    render(<PanelFixture service={fixture.service} />);
    await page.getByRole('button', { name: 'Profilo ed estrusione', exact: true }).click();
    const external: ManualDocument = {
      version: 1,
      operations: [{ id: 'other', type: 'translate', target: { name: 'Fibbia' }, delta: [5, 0, 0] }],
    };
    await fixture.service.commit(external, fixture.service.getSnapshot().document);
    await expect.element(page.getByRole('button', { name: 'Applica al modello', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('region', { name: 'Bozza', exact: true })).toBeVisible();
    expect(fixture.service.getSnapshot().document).toEqual(external);
    await page.getByRole('button', { name: 'Scarta bozza', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Modifica operazione 1', exact: true })).toBeEnabled();
  });
  it('should save an open profile, dimension its segment, reopen it and discard changes', async () => {
    await page.viewport(420, 1000);
    const fixture = createFixture();
    const mounted = render(<PanelFixture service={fixture.service} />);
    await page.getByRole('button', { name: 'Profilo ed estrusione', exact: true }).click();
    await commands.dragManualPoint('Punto 1', { x: 24, y: -18, cancel: true });
    await expect.element(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('-10');
    await page.getByRole('checkbox', { name: 'Profilo chiuso', exact: true }).click();
    await expect
      .element(page.getByRole('combobox', { name: 'Risultato', exact: true }))
      .toHaveTextContent('Salva come profilo 2D');
    await expect.element(page.getByText('Un profilo aperto si salva come profilo 2D.', { exact: false })).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Lunghezza segmento', exact: true }).fill('25');
    await userEvent.keyboard('{Enter}');
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    await vi.waitFor(() => {
      expect(fixture.service.getSnapshot().document?.operations[0]?.type).toBe('sketch');
    });
    const saved = fixture.service.getSnapshot().document!;
    const sketch = saved.operations[0];
    if (sketch?.type !== 'sketch' || sketch.profile.kind !== 'polygon') {
      throw new Error('Expected a polygon sketch');
    }
    expect(sketch.profile.closed).toBe(false);
    expect(sketch.profile.points[1]?.x).toBe(15);
    mounted.unmount();
    const reopened = createManualEditService(fixture.authority);
    render(<PanelFixture service={reopened} />);
    await page.getByRole('button', { name: 'Modifica operazione 1', exact: true }).click();
    await expect.element(page.getByRole('checkbox', { name: 'Profilo chiuso', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Punto 1', exact: true }).click();
    await userEvent.keyboard('{ArrowRight}');
    await page.getByRole('button', { name: 'Scarta bozza', exact: true }).click();
    expect(reopened.getSnapshot().document).toEqual(saved);
    await page.getByRole('button', { name: 'Profilo ed estrusione', exact: true }).click();
    await expect.element(page.getByRole('textbox', { name: 'Nome del nuovo pezzo' })).toHaveValue('Pezzo manuale 2');
    await page.getByRole('button', { name: 'Scarta bozza', exact: true }).click();
  });

  it('should preview an exact circle, reject a collapsing offset and persist its radius', async () => {
    await page.viewport(420, 1000);
    const fixture = createFixture();
    render(<PanelFixture service={fixture.service} />);
    await page.getByRole('button', { name: 'Profilo ed estrusione', exact: true }).click();
    await page.getByRole('combobox', { name: 'Tracciato', exact: true }).click();
    await page.getByRole('option', { name: 'Cerchio', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Raggio', exact: true }).fill('12.5');
    await userEvent.keyboard('{Enter}');
    await expect
      .element(page.getByTestId('manual-profile-path'))
      .toHaveAttribute('d', 'M 12.5,0 A 12.5,12.5 0 1 0 -12.5,0 A 12.5,12.5 0 1 0 12.5,0 Z');
    await page.getByRole('spinbutton', { name: 'Distanza offset', exact: true }).fill('-13');
    await userEvent.keyboard('{Enter}');
    await page.getByRole('button', { name: 'Applica offset alla bozza', exact: true }).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('Offset non applicato');
    await expect.element(page.getByRole('spinbutton', { name: 'Raggio', exact: true })).toHaveValue('12.5');
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    await vi.waitFor(() => {
      const operation = fixture.service.getSnapshot().document?.operations[0];
      expect(operation?.type).toBe('extrude');
      expect(operation && 'profile' in operation ? operation.profile : undefined).toMatchObject({
        kind: 'circle',
        radius: 12.5,
      });
    });
  });
  it('should expose explicit 2D and 3D view actions and protect an active draft', async () => {
    const showProfiles = vi.fn<() => void>();
    const showModel = vi.fn<() => void>();
    render(
      <TooltipProvider>
        <ManualEditPanel
          document={{ version: 1, operations: [] }}
          targets={targets}
          canUndo={false}
          canRedo={false}
          onCommit={async () => true}
          onUndo={async () => false}
          onRedo={async () => false}
          onShowProfiles={showProfiles}
          onShowModel={showModel}
        />
      </TooltipProvider>,
    );
    expect(showProfiles).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Mostra profili 2D', exact: true }).click();
    expect(showProfiles).toHaveBeenCalledExactlyOnceWith();
    await page.getByRole('button', { name: 'Torna al modello 3D', exact: true }).click();
    expect(showModel).toHaveBeenCalledExactlyOnceWith();
    await page.getByRole('button', { name: 'Profilo ed estrusione', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Mostra profili 2D', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Scarta bozza', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Mostra profili 2D', exact: true })).toBeEnabled();
  });
  it('should allocate a unique profile name when converting a saved cut to an open sketch', async () => {
    const profile: ManualPointProfile = {
      kind: 'polygon',
      plane: 'xy',
      origin: [0, 0, 0],
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 10, y: 10 },
      ],
    };
    const fixture = createFixture({
      version: 1,
      operations: [
        { id: 'wire', type: 'sketch', name: 'Pezzo manuale', profile },
        { id: 'cut', type: 'extrude', mode: 'cut', target: { name: 'Fibbia' }, distance: 2, profile },
      ],
    });
    render(<PanelFixture service={fixture.service} />);
    await page.getByRole('button', { name: 'Modifica operazione 2', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Profilo chiuso', exact: true }).click();
    await expect.element(page.getByRole('textbox', { name: 'Nome del nuovo pezzo' })).toHaveValue('Pezzo manuale 2');
    await page.getByRole('button', { name: 'Applica al modello', exact: true }).click();
    await vi.waitFor(() => {
      expect(fixture.service.getSnapshot().document?.operations[1]).toMatchObject({
        type: 'sketch',
        name: 'Pezzo manuale 2',
      });
    });
  });
});
