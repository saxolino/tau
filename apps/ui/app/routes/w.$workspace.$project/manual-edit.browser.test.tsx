import '#styles/global.css';
import { cleanup, render } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import { serializeManualDocument } from '@taucad/smlib/manual-operations';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { setLanguage } from '#i18n/language.js';
import { createManualEditService } from '#services/manual-edit-service.js';
import type { ManualEditAuthority } from '#services/manual-edit-service.js';
import { ManualEditPanel } from '#routes/w.$workspace.$project/manual-edit-panel.js';

declare module 'vitest/internal/browser' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Augment Vitest's browser command surface.
  interface BrowserCommands {
    dragManualPoint(label: string, movement: { x: number; y: number }): Promise<void>;
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

beforeEach(() => {
  setLanguage('it');
});
afterEach(() => {
  cleanup();
});

describe('manual geometry editing in a real browser', () => {
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
    if (extrusion?.type !== 'extrude') {
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
});
