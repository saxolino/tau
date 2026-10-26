import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GeometryComponentManifest } from '@taucad/types';
import type { PlanarFaceTool } from '@taucad/viewer/cad/planar-face-tool';
import type { ManualEdits } from '#hooks/use-manual-edits.js';
import type { ManualFaceControls } from '#routes/w.$workspace.$project/manual-edit-panel.js';
import { createManualFaceDraft, hasManualPlanarFaces } from '#services/manual-face-draft.js';
import type { ManualFaceDraft, ManualFaceFailure, ManualFaceWitness } from '#services/manual-face-draft.js';
import { useTranslation } from '#i18n/translate.js';

type ManualFaceToolResult = Readonly<{ tool: PlanarFaceTool | undefined; controls: ManualFaceControls }>;

/** One shared draft for both the pointer and numeric face tools; previews never write files. */
export function useManualFaceTool({
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
}>): ManualFaceToolResult {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<ManualFaceDraft>();
  const [distance, setDistance] = useState(10);
  const [failure, setFailure] = useState<ManualFaceFailure>();
  const capable = hasManualPlanarFaces(manifest);
  const available = ready && open && capable && !edits.loading && !edits.saving && !edits.error;
  const witness = useMemo<ManualFaceWitness>(
    () => ({
      available: available && enabled,
      document: edits.document,
      commit: edits.commit,
      manifest,
      runtimeDocument,
      renderStamp,
      artifactKey,
    }),
    [available, enabled, edits.document, edits.commit, manifest, runtimeDocument, renderStamp, artifactKey],
  );
  const current = useRef(witness);
  const selected = draft?.isCurrent(witness) ? draft : undefined;
  const selectedRef = useRef(draft);

  const [previousWitness, setPreviousWitness] = useState(witness);
  if (previousWitness !== witness) {
    setPreviousWitness(witness);
    if (!open && enabled) {
      setEnabled(false);
    }
    if (draft && !draft.isCurrent(witness)) {
      setDraft(undefined);
      if (open && enabled) {
        setFailure('faceStale');
      }
    }
  }
  useLayoutEffect(() => {
    current.current = witness;
    selectedRef.current = selected;
  }, [witness, selected]);

  const cancel = useCallback(() => {
    setDraft(undefined);
    setFailure(undefined);
  }, []);
  const enable = useCallback((next: boolean) => {
    setEnabled(next);
    setDraft(undefined);
    setFailure(undefined);
  }, []);
  const apply = useCallback(async (captured: ManualFaceDraft | undefined, nextDistance: number): Promise<void> => {
    if (!captured || selectedRef.current !== captured) {
      setFailure('faceStale');
      return;
    }
    // Consume the gesture before awaiting the authority; repeated pointer-up cannot append twice.
    selectedRef.current = undefined;
    setDraft(undefined);
    const error = await captured.apply(nextDistance, current.current);
    setFailure(error);
  }, []);
  const tool = useMemo<PlanarFaceTool | undefined>(
    () =>
      enabled && available
        ? {
            selection: selected?.selection,
            onPick: (pick) => {
              const next = createManualFaceDraft(current.current, pick);
              setDraft(next);
              setDistance(10);
              setFailure(next ? undefined : 'faceInvalid');
            },
            onPreview: (metres) => {
              if (selected && selectedRef.current === selected && selected.isCurrent(current.current)) {
                setDistance(metres * 1000);
              }
            },
            onCommit: (metres) => {
              void apply(selected, metres * 1000);
            },
            onCancel: () => {
              // A disposed old gizmo must not cancel a newer face selection.
              if (selected && selectedRef.current === selected) {
                selectedRef.current = undefined;
                setDraft(undefined);
              }
            },
          }
        : undefined,
    [enabled, available, selected, apply],
  );
  const onApply = useCallback(() => {
    void apply(selected, distance);
  }, [apply, selected, distance]);
  const controls = useMemo<ManualFaceControls>(
    () => ({
      enabled,
      available: ready && capable && !edits.loading && !edits.saving && !edits.error,
      selected: selected ? { name: selected.name, faceIndex: selected.faceIndex } : undefined,
      distance,
      error: failure ? t(`manualEdit.${failure}`) : undefined,
      onEnableChange: enable,
      onDistanceChange: setDistance,
      onApply,
      onCancel: cancel,
    }),
    [
      enabled,
      ready,
      capable,
      edits.loading,
      edits.saving,
      edits.error,
      selected,
      distance,
      failure,
      t,
      enable,
      onApply,
      cancel,
    ],
  );
  return { tool, controls };
}
