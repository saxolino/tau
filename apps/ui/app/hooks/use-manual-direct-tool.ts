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
}: Readonly<{
  edits: ManualEdits;
  manifest: GeometryComponentManifest | undefined;
  runtimeDocument: unknown;
  renderStamp: string | undefined;
  artifactKey: string | undefined;
  ready: boolean;
  open: boolean;
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
  }, [witness, selected]);
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
    setDraft(undefined);
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
              setDraft(next);
              setPreview(undefined);
              setFailure(undefined);
            },
            onPreview: (change) => {
              if (selected && selectedRef.current === selected && selected.isCurrent(current.current)) {
                setPreview(change);
              }
            },
            onCommit: (change) => {
              void apply(selected, change);
            },
            onCancel: () => {
              if (selected && selectedRef.current === selected) {
                selectedRef.current = undefined;
                setDraft(undefined);
                setPreview(undefined);
              }
            },
          }
        : undefined,
    [mode, available, selected, apply],
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
      selected: selected ? { name: selected.name, edgeCount: selected.edges.length } : undefined,
      size,
      preview: previewLabel,
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
      failure,
      t,
      changeMode,
      applyEdges,
      cancel,
    ],
  );
  return { tool, controls };
}
