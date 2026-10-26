import { useCallback, useMemo, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryComponentManifest } from '@taucad/types';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { useManualDirectTool } from '#hooks/use-manual-direct-tool.js';
import { useManualFaceTool } from '#hooks/use-manual-face-tool.js';
import type { ManualEdits } from '#hooks/use-manual-edits.js';
import { setLanguage, resetLanguageForTests } from '#i18n/language.js';
import { ManualEditPanel } from '#routes/w.$workspace.$project/manual-edit-panel.js';
import { useManualInspectorDraft } from '#routes/w.$workspace.$project/manual-inspector-draft.js';

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const manifest: GeometryComponentManifest = {
  schemaVersion: 1,
  rootId: 'body',
  nodeOrder: ['body'],
  capabilities,
  nodesById: {
    body: {
      id: 'body',
      name: 'Body',
      kind: 'body',
      selector: 'body',
      childIds: [],
      depth: 0,
      path: [],
      meshNodeIndices: [],
      primitiveIndices: [],
      materialIndices: [],
      capabilities,
      extras: {
        manualTargetName: 'Body',
        manualBodySignature: 'a'.repeat(64),
        manualBounds: { min: [0, 0, 0], max: [10, 10, 10] },
        manualFaces: [{ faceId: 23, index: 7, isPlanar: true, center: [10, 20, 30], normal: [0, 0, 1] }],
      },
    },
  },
};
const runtimeDocument = {};
const commits = vi.fn();
const noHistory = async (): Promise<boolean> => false;
const targets = ['Body'];

function InspectorFixture(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(true);
  const [document, setDocument] = useState<ManualDocument>({ version: 1, operations: [] });
  const commit = useCallback(async (next: ManualDocument): Promise<boolean> => {
    commits(next);
    setDocument(next);
    return true;
  }, []);
  const edits = useMemo<ManualEdits>(
    () => ({
      document,
      contentDigest: 'missing',
      commit,
      loading: false,
      saving: false,
      error: undefined,
      canUndo: false,
      canRedo: false,
      undo: noHistory,
      redo: noHistory,
    }),
    [document, commit],
  );
  const { isToolOpen, onDraftLayoutChange } = useManualInspectorDraft({ isOpen, isActive: true });
  const options = {
    edits,
    manifest,
    runtimeDocument,
    renderStamp: 'render-a',
    artifactKey: 'mesh-a',
    ready: true,
    open: isToolOpen,
  };
  const direct = useManualDirectTool(options);
  const face = useManualFaceTool(options);
  return (
    <KeyboardProvider>
      <TooltipProvider>
        <button
          type='button'
          onClick={() => {
            setIsOpen(false);
          }}
        >
          Nascondi l’ispettore
        </button>
        <button
          type='button'
          onClick={() => {
            setIsOpen(true);
          }}
        >
          Mostra l’ispettore
        </button>
        {/* The viewer's side of the face tool: a pick on the model and a drag of its arrow. */}
        <button
          type='button'
          onClick={() => {
            face.tool?.onPick({ componentId: 'body', faceId: 23, point: [0.01, 0.02, 0.03], artifactKey: 'mesh-a' });
          }}
        >
          Clic sulla faccia
        </button>
        <button
          type='button'
          onClick={() => {
            face.tool?.onPreview(0.0015);
            face.tool?.onCommit(0.0015);
          }}
        >
          Trascina la freccia
        </button>
        <output aria-label='Direct handles'>{String(direct.tool !== undefined)}</output>
        <output aria-label='Face interaction'>{String(face.tool !== undefined)}</output>
        <output aria-label='Face ghost'>{String(face.tool?.distance ?? 'none')}</output>
        <div hidden={!isOpen}>
          <ManualEditPanel
            document={document}
            targets={targets}
            canUndo={false}
            canRedo={false}
            onCommit={commit}
            onUndo={noHistory}
            onRedo={noHistory}
            directControls={direct.controls}
            faceControls={face.controls}
            onDraftLayoutChange={onDraftLayoutChange}
          />
        </div>
      </TooltipProvider>
    </KeyboardProvider>
  );
}

beforeEach(() => {
  setLanguage('it');
  commits.mockClear();
});
afterEach(() => {
  resetLanguageForTests();
});

describe('manual inspector draft interaction boundary', () => {
  it.each(['Scarta bozza', 'Applica al modello'])(
    'should keep direct and face tools disabled after returning to a draft until %s',
    async (finish) => {
      const user = userEvent.setup();
      render(<InspectorFixture />);
      expect(screen.getByLabelText('Direct handles')).toHaveTextContent('true');
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('false');
      await user.click(screen.getByRole('radio', { name: 'Faccia' }));
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('true');
      await user.click(screen.getByRole('radio', { name: 'Pezzo' }));
      await user.click(screen.getByRole('button', { name: 'Altri strumenti' }));
      await user.click(screen.getByRole('menuitem', { name: 'Quote numeriche' }));
      expect(screen.getByLabelText('Direct handles')).toHaveTextContent('false');
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('false');
      await user.click(screen.getByRole('button', { name: 'Nascondi l’ispettore' }));
      await user.click(screen.getByRole('button', { name: 'Mostra l’ispettore' }));
      expect(screen.getByRole('region', { name: 'Bozza' })).toBeVisible();
      expect(screen.getByLabelText('Direct handles')).toHaveTextContent('false');
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('false');
      expect(commits).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: new RegExp(finish, 'u') }));
      expect(screen.getByLabelText('Direct handles')).toHaveTextContent('true');
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('false');
      await user.click(screen.getByRole('radio', { name: 'Faccia' }));
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('true');
      expect(commits).toHaveBeenCalledTimes(finish === 'Applica al modello' ? 1 : 0);
    },
  );

  it('should offer the tools of what is selected: the piece, a face or its edges', async () => {
    const user = userEvent.setup();
    render(<InspectorFixture />);
    const toolbar = screen.getByRole('toolbar', { name: 'Strumenti' });
    expect(within(toolbar).getByRole('button', { name: 'Sposta' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(toolbar).getByRole('button', { name: 'Ruota' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Scala' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Faccia' }));
    expect(within(toolbar).getByRole('button', { name: 'Estrudi faccia' })).toBeInTheDocument();
    // A hole is placed from the picked face, so it waits for one.
    expect(within(toolbar).getByRole('button', { name: 'Foro qui' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Spigolo' }));
    expect(within(toolbar).getByRole('button', { name: 'Raccordo' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(toolbar).getByRole('button', { name: 'Smusso' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Pezzo' })).toBeEnabled();
  });

  it('should hold a dragged face as a preview, discard it with Esc and apply it with Invio', async () => {
    const user = userEvent.setup();
    render(<InspectorFixture />);
    await user.click(screen.getByRole('radio', { name: 'Faccia' }));
    await user.click(screen.getByRole('button', { name: 'Clic sulla faccia' }));
    expect(screen.queryByRole('button', { name: /Applica/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Trascina la freccia' }));
    expect(screen.getByLabelText('Face ghost')).toHaveTextContent('0.0015');
    expect(screen.getByText('+1,50 mm')).toBeInTheDocument();
    expect(commits).not.toHaveBeenCalled();
    // Esc on the page (not in a field) discards the preview and keeps the face.
    await user.click(document.body);
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Face ghost')).toHaveTextContent(/^0$/u);
    expect(commits).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Trascina la freccia' }));
    await user.click(document.body);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(commits).toHaveBeenCalledOnce();
    });
    expect(commits.mock.calls[0]?.[0]).toMatchObject({
      operations: [{ type: 'faceExtrude', distance: 1.5, target: { name: 'Body' } }],
    });
  });
});
