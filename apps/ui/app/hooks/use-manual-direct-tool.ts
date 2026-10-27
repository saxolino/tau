import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GeometryComponentManifest } from '@taucad/types';
import type { DirectEditChange, DirectEditTool } from '@taucad/viewer/cad/direct-edit-tool';
import type { ManualEdits } from '#hooks/use-manual-edits.js';
import type { ManualDirectControls } from '#routes/w.$workspace.$project/manual-edit-panel.js';
import {
  createManualDirectDraft,
  hasManualDirectTargets,
  retargetManualDirectDraft,
} from '#services/manual-direct-draft.js';
import type {
  ManualDirectDraft,
  ManualDirectFailure,
  ManualDirectWitness,
  ManualEdgeChange,
} from '#services/manual-direct-draft.js';
import { useTranslation } from '#i18n/translate.js';

type DirectEditMode = DirectEditTool['mode'];
type ManualDirectToolResult = Readonly<{ tool: DirectEditTool | undefined; controls: ManualDirectControls }>;

/** Captured pointer transforms and selected native edges share the panel's checked manual history. */
export function useManualDirectTool({
  edits,
  manifest,
  runtimeDocument,
  renderStamp,
  artifactKey,
  ready,
  open,
  onSelectPiece,
}: Readonly<{
  edits: ManualEdits;
  manifest: GeometryComponentManifest | undefined;
  runtimeDocument: unknown;
  renderStamp: string | undefined;
  artifactKey: string | undefined;
  ready: boolean;
  open: boolean;
  /** A picked piece (or the piece of a picked edge) becomes the shared selection the measures and the assistant read. */
  onSelectPiece?: (componentId: string) => void;
}>): ManualDirectToolResult {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DirectEditMode | undefined>(open ? 'translate' : undefined);
  const [draft, setDraft] = useState<ManualDirectDraft>();
  const [size, setSize] = useState(1);
  const [preview, setPreview] = useState<DirectEditChange>();
  const [failure, setFailure] = useState<ManualDirectFailure>();
  const capable = hasManualDirectTargets(manifest, mode);
  const available = ready && open && capable && !edits.loading && !edits.saving && !edits.error;
  const witness = useMemo<ManualDirectWitness>(
    () => ({
      mode,
      available: available && mode !== undefined,
      document: edits.document,
      commit: edits.commit,
      manifest,
      runtimeDocument,
      renderStamp,
      artifactKey,
    }),
    [mode, available, edits.document, edits.commit, manifest, runtimeDocument, renderStamp, artifactKey],
  );
  const current = useRef(witness);
  const selected = draft?.isCurrent(witness) ? draft : undefined;
  const selectedRef = useRef(draft);
  const selectPieceRef = useRef(onSelectPiece);
  const [isDragging, setIsDragging] = useState(false);
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setMode(open ? 'translate' : undefined);
  }
  const [previousWitness, setPreviousWitness] = useState(witness);
  if (previousWitness !== witness) {
    setPreviousWitness(witness);
    if (!open && mode) {
      setMode(undefined);
    }
    if (draft && !draft.isCurrent(witness)) {
      setDraft(undefined);
      setPreview(undefined);
      if (open && mode) {
        setFailure('directStale');
      }
    }
  }
  useLayoutEffect(() => {
    current.current = witness;
    selectedRef.current = selected;
    selectPieceRef.current = onSelectPiece;
  }, [witness, selected, onSelectPiece]);
  const changeMode = useCallback((next: DirectEditMode | undefined) => {
    const witness = { ...current.current, mode: next };
    const retained = retargetManualDirectDraft(selectedRef.current, witness);
    selectedRef.current = retained;
    setMode(next);
    setDraft(retained);
    setPreview(undefined);
    setFailure(undefined);
  }, []);
  const cancel = useCallback(() => {
    selectedRef.current = undefined;
    setDraft(undefined);
    setPreview(undefined);
    setFailure(undefined);
  }, []);
  /**
   * Follow a piece chosen elsewhere (the measures list, a chip, the agent's summary): a body tool puts its handles on
   * it, so there is one selection on the page. Edge tools keep their own picked edges.
   */
  const selectPiece = useCallback((componentId: string | undefined) => {
    const witness = current.current;
    if (!witness.mode || witness.mode === 'fillet' || witness.mode === 'chamfer') {
      return;
    }
    if (componentId === undefined) {
      if (selectedRef.current) {
        selectedRef.current = undefined;
        setDraft(undefined);
        setPreview(undefined);
      }
      return;
    }
    if (selectedRef.current?.selection.componentId === componentId && selectedRef.current.isCurrent(witness)) {
      return;
    }
    const next = createManualDirectDraft(witness, {
      componentId,
      point: [0, 0, 0],
      artifactKey: witness.artifactKey ?? '',
    });
    selectedRef.current = next;
    setDraft(next);
    setPreview(undefined);
    setFailure(undefined);
  }, []);
  const apply = useCallback(
    async (captured: ManualDirectDraft | undefined, change: DirectEditChange | ManualEdgeChange): Promise<void> => {
      if (!captured || selectedRef.current !== captured) {
        setFailure('directStale');
        return;
      }
      selectedRef.current = undefined;
      setDraft(undefined);
      setPreview(undefined);
      setFailure(await captured.apply(change, current.current));
    },
    [],
  );
  const tool = useMemo<DirectEditTool | undefined>(
    () =>
      mode && available
        ? {
            mode,
            selection: selected?.selection,
            onPick: (pick) => {
              if (current.current.mode !== mode) {
                return;
              }
              const earlier = selectedRef.current;
              const edgeMode = current.current.mode === 'fillet' || current.current.mode === 'chamfer';
              if (edgeMode && earlier && earlier.selection.componentId !== pick.componentId) {
                setFailure('edgeSameBody');
                return;
              }
              const next = createManualDirectDraft(current.current, pick, edgeMode ? earlier : undefined);
              if (!next) {
                setFailure('directInvalid');
                return;
              }
              selectedRef.current = next;
              setDraft(next);
              setPreview(undefined);
              setFailure(undefined);
              selectPieceRef.current?.(pick.componentId);
            },
            onPreview: (change) => {
              if (selected && selectedRef.current === selected && selected.isCurrent(current.current)) {
                setPreview(change);
                setIsDragging(true);
              }
            },
            onCommit: (change) => {
              setIsDragging(false);
              void apply(selected, change);
            },
            onCancel: () => {
              setIsDragging(false);
              // An Esc during a move drag discards the gesture and keeps the piece selected.
              setPreview(undefined);
            },
            ...((mode === 'fillet' || mode === 'chamfer') && selected?.edges.length && size > 0
              ? { edgeSize: size / 1000 }
              : {}),
          }
        : undefined,
    [mode, available, selected, apply, size],
  );
  const applyEdges = useCallback(() => {
    if (mode === 'fillet' || mode === 'chamfer') {
      void apply(selected, { type: mode, size });
    }
  }, [mode, size, selected, apply]);
  const previewLabel = useMemo(() => {
    if (!preview) {
      return undefined;
    }
    switch (preview.type) {
      case 'translate': {
        return t('manualEdit.directMovePreview', {
          x: (preview.delta[0] * 1000).toFixed(2),
          y: (preview.delta[1] * 1000).toFixed(2),
          z: (preview.delta[2] * 1000).toFixed(2),
        });
      }
      case 'rotate': {
        return t('manualEdit.directRotatePreview', { angle: ((preview.angleRadians * 180) / Math.PI).toFixed(1) });
      }
      case 'scale': {
        return t('manualEdit.directScalePreview', { factor: preview.factor.toFixed(3) });
      }
    }
  }, [preview, t]);
  const controls = useMemo<ManualDirectControls>(
    () => ({
      mode,
      available: ready && capable && !edits.loading && !edits.saving && !edits.error,
      selected: selected
        ? { name: selected.name, edgeCount: selected.edges.length, componentId: selected.selection.componentId }
        : undefined,
      size,
      preview: previewLabel,
      isDragging,
      onSelectPiece: selectPiece,
      error: failure ? t(`manualEdit.${failure}`) : undefined,
      onModeChange: changeMode,
      onSizeChange: setSize,
      onApply: applyEdges,
      onCancel: cancel,
    }),
    [
      mode,
      ready,
      capable,
      edits.loading,
      edits.saving,
      edits.error,
      selected,
      size,
      previewLabel,
      isDragging,
      selectPiece,
      failure,
      t,
      changeMode,
      applyEdges,
      cancel,
    ],
  );
  return { tool, controls };
}
