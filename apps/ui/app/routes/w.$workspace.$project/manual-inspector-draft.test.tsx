import { useCallback, useMemo, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryComponentManifest } from '@taucad/types';
import type { ManualDocument } from '@taucad/smlib/manual-operations';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
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
    <TooltipProvider>
      <button
        type='button'
        onClick={() => {
          setIsOpen(false);
        }}
      >
        Assistente
      </button>
      <button
        type='button'
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Torna a Modifica
      </button>
      <output aria-label='Direct handles'>{String(direct.tool !== undefined)}</output>
      <output aria-label='Face interaction'>{String(face.tool !== undefined)}</output>
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
      await user.click(screen.getByRole('radio', { name: 'Facce' }));
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('true');
      await user.click(screen.getByRole('radio', { name: 'Pezzi' }));
      await user.click(screen.getByRole('button', { name: 'Quote numeriche' }));
      expect(screen.getByLabelText('Direct handles')).toHaveTextContent('false');
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('false');
      await user.click(screen.getByRole('button', { name: 'Assistente' }));
      await user.click(screen.getByRole('button', { name: 'Torna a Modifica' }));
      expect(screen.getByRole('region', { name: 'Bozza' })).toBeVisible();
      expect(screen.getByLabelText('Direct handles')).toHaveTextContent('false');
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('false');
      expect(commits).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: finish }));
      expect(screen.getByLabelText('Direct handles')).toHaveTextContent('true');
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('false');
      await user.click(screen.getByRole('radio', { name: 'Facce' }));
      expect(screen.getByLabelText('Face interaction')).toHaveTextContent('true');
      expect(commits).toHaveBeenCalledTimes(finish === 'Applica al modello' ? 1 : 0);
    },
  );
});
