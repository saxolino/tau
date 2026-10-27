/** Native body/edge target in unposed Tau Z-up model metres. @public */
export type DirectEditSelection = Readonly<{
  componentId: string;
  pivot: readonly [number, number, number];
  /** Geometry/document witness; a change cancels the current gesture. */
  revision: string;
  /** Occurrence edge IDs from this artifact, never native edge-array indices. */
  edgeIds?: readonly number[];
}>;

/** An atomic native operation; all distances and origins use model metres. @public */
export type DirectEditChange =
  | Readonly<{ type: 'translate'; delta: readonly [number, number, number] }>
  | Readonly<{
      type: 'rotate';
      axis: readonly [number, number, number];
      origin: readonly [number, number, number];
      angleRadians: number;
    }>
  | Readonly<{ type: 'scale'; factor: number; origin: readonly [number, number, number] }>;

/** One visible body or native occurrence edge picked on the current artifact. @public */
export type DirectEditPick = Readonly<{
  componentId: string;
  point: readonly [number, number, number];
  artifactKey: string;
  edgeId?: number;
}>;

/** Host-owned native authoring authority; previews never persist geometry. @public */
export type DirectEditTool = Readonly<{
  mode: 'translate' | 'rotate' | 'scale' | 'fillet' | 'chamfer';
  selection?: DirectEditSelection;
  /**
   * The fillet radius or chamfer size the host previews on the selected edges, in model metres. The ghost is a tube of
   * that radius around each edge: it shows how much material the operation reaches, not the exact rounded surface.
   */
  edgeSize?: number;
  onPick: (pick: DirectEditPick) => void;
  onPreview: (change: DirectEditChange) => void;
  /** Exactly one operation on a changed pointer release. */
  onCommit: (change: DirectEditChange) => void;
  onCancel: () => void;
}>;
