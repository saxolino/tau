import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GeometryComponentManifest } from '@taucad/types';
import type { PlanarFaceTool } from '@taucad/viewer/cad/planar-face-tool';
import type { ManualEdits } from '#hooks/use-manual-edits.js';
import type { ManualFaceControls } from '#routes/w.$workspace.$project/manual-edit-panel.js';
import { createManualFaceDraft, hasManualPlanarFaces } from '#services/manual-face-draft.js';
import type { ManualFaceDraft, ManualFaceFailure, ManualFaceWitness } from '#services/manual-face-draft.js';
import { pieceExtentAlong } from '#lib/inspector-selection.js';
import { useTranslation } from '#i18n/translate.js';

type ManualFaceToolResult = Readonly<{ tool: PlanarFaceTool | undefined; controls: ManualFaceControls }>;

/** What a selected face is about to become: a pushed or pulled face, or a hole drilled from it. */
export type ManualFaceAction = 'extrude' | 'hole';

const defaultHole = { diameter: 2, depth: 2, through: true } as const;

/** A dragged distance lands on the hundredth of a millimetre the inspector shows and the history keeps. */
const toHundredths = (metres: number): number => Math.round(metres * 100_000) / 100;

/**
 * One shared draft for both the pointer and numeric face tools; previews never write files. A released drag holds its
 * distance as a preview (the ghost stays on the model) until Applica or Invio commits it, and Esc discards it.
 */
export function useManualFaceTool({
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
  /** The piece a face belongs to becomes the shared selection, so the measures and the assistant follow it. */
  onSelectPiece?: (componentId: string) => void;
}>): ManualFaceToolResult {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<ManualFaceDraft>();
  const [distance, setDistance] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [action, setAction] = useState<ManualFaceAction>('extrude');
  const [hole, setHole] = useState<{ diameter: number; depth: number; through: boolean }>(defaultHole);
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
  const selectPieceRef = useRef(onSelectPiece);

  const [previousWitness, setPreviousWitness] = useState(witness);
  if (previousWitness !== witness) {
    setPreviousWitness(witness);
    if (!open && enabled) {
      setEnabled(false);
    }
    if (draft && !draft.isCurrent(witness)) {
      setDraft(undefined);
      setDistance(0);
      setIsDragging(false);
      if (open && enabled) {
        setFailure('faceStale');
      }
    }
  }
  useLayoutEffect(() => {
    current.current = witness;
    selectedRef.current = selected;
    selectPieceRef.current = onSelectPiece;
  }, [witness, selected, onSelectPiece]);

  /** Drop the face: Esc with nothing held, Deseleziona, or a click elsewhere. */
  const clear = useCallback(() => {
    selectedRef.current = undefined;
    setDraft(undefined);
    setDistance(0);
    setIsDragging(false);
    setFailure(undefined);
  }, []);
  /** Esc discards the held preview (a distance, a hole) first and keeps the face; a second Esc drops the face. */
  const cancel = useCallback(() => {
    setFailure(undefined);
    setIsDragging(false);
    if (action === 'hole') {
      setAction('extrude');
      return;
    }
    if (distance !== 0) {
      setDistance(0);
      return;
    }
    selectedRef.current = undefined;
    setDraft(undefined);
  }, [action, distance]);
  const enable = useCallback((next: boolean) => {
    setEnabled(next);
    setDraft(undefined);
    setDistance(0);
    setIsDragging(false);
    setFailure(undefined);
  }, []);
  const apply = useCallback(async (captured: ManualFaceDraft | undefined, nextDistance: number): Promise<void> => {
    if (!captured || selectedRef.current !== captured) {
      setFailure('faceStale');
      return;
    }
    // Consume the gesture before awaiting the authority; repeated Enter cannot append twice.
    selectedRef.current = undefined;
    setDraft(undefined);
    setDistance(0);
    const error = await captured.apply(nextDistance, current.current);
    setFailure(error);
  }, []);
  const extent = useMemo(
    () =>
      selected
        ? pieceExtentAlong(manifest?.nodesById[selected.selection.componentId], selected.selection.normal)
        : undefined,
    [manifest, selected],
  );
  const holeDepth = hole.through && extent !== undefined ? extent : hole.depth;
  const applyHole = useCallback(async (): Promise<void> => {
    const captured = selectedRef.current;
    if (!captured || captured !== selected) {
      setFailure('faceStale');
      return;
    }
    selectedRef.current = undefined;
    setDraft(undefined);
    setDistance(0);
    setFailure(await captured.applyHole({ diameter: hole.diameter, depth: holeDepth }, current.current));
  }, [selected, hole.diameter, holeDepth]);
  const tool = useMemo<PlanarFaceTool | undefined>(
    () =>
      enabled && available
        ? {
            selection: selected?.selection,
            ...(selected && action === 'extrude' ? { distance: distance / 1000 } : {}),
            ...(selected && action === 'hole'
              ? { hole: { radius: hole.diameter / 2000, depth: holeDepth / 1000 } }
              : {}),
            onPick: (pick) => {
              const next = createManualFaceDraft(current.current, pick);
              setDraft(next);
              setDistance(0);
              setIsDragging(false);
              setFailure(next ? undefined : 'faceInvalid');
              if (next) {
                selectPieceRef.current?.(pick.componentId);
              }
            },
            onPreview: (metres) => {
              if (selected && selectedRef.current === selected && selected.isCurrent(current.current)) {
                setDistance(toHundredths(metres));
                setIsDragging(true);
              }
            },
            onCommit: (metres) => {
              // The release holds the distance as a preview; Applica or Invio commits it.
              if (selected && selectedRef.current === selected) {
                setDistance(toHundredths(metres));
                setIsDragging(false);
              }
            },
            onCancel: () => {
              // A cancelled drag returns to the held distance, which the gesture has already previewed.
              setIsDragging(false);
            },
          }
        : undefined,
    [enabled, available, selected, action, distance, hole.diameter, holeDepth],
  );
  const onApply = useCallback(() => {
    if (action === 'hole') {
      void applyHole();
    } else {
      void apply(selected, distance);
    }
  }, [action, apply, applyHole, selected, distance]);
  const controls = useMemo<ManualFaceControls>(
    () => ({
      enabled,
      available: ready && capable && !edits.loading && !edits.saving && !edits.error,
      selected: selected
        ? {
            name: selected.name,
            faceIndex: selected.faceIndex,
            componentId: selected.selection.componentId,
            faceId: selected.selection.faceId,
            normal: selected.selection.normal,
          }
        : undefined,
      distance,
      isDragging,
      action,
      hole: { diameter: hole.diameter, depth: holeDepth, through: hole.through, extent },
      error: failure ? t(`manualEdit.${failure}`) : undefined,
      onEnableChange: enable,
      onDistanceChange: setDistance,
      onActionChange: (next) => {
        setAction(next);
        setDistance(0);
        setFailure(undefined);
      },
      onHoleChange: (next) => {
        setHole((held) => ({ ...held, ...next }));
      },
      onApply,
      onCancel: cancel,
      onClear: clear,
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
      isDragging,
      action,
      hole.diameter,
      hole.through,
      holeDepth,
      extent,
      failure,
      t,
      enable,
      onApply,
      cancel,
      clear,
    ],
  );
  return { tool, controls };
}
