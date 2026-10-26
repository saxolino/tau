/** One selected planar face, expressed in Tau Z-up model metres. @public */
export type PlanarFaceSelection = Readonly<{
  componentId: string;
  faceId: number;
  anchor: readonly [number, number, number];
  /** Unit normal in Tau model axes. */
  normal: readonly [number, number, number];
  /** The host's captured geometry/document witness; changing it cancels a drag. */
  revision: string;
}>;

/** A visible topology face picked on one rendered artifact. @public */
export type PlanarFacePick = Readonly<{
  componentId: string;
  faceId: number;
  /** Tau Z-up model metres, before the floating render frame. */
  point: readonly [number, number, number];
  artifactKey: string;
}>;

/** Host-owned authoring authority; pointer previews never persist geometry. @public */
export type PlanarFaceTool = Readonly<{
  selection?: PlanarFaceSelection;
  onPick: (pick: PlanarFacePick) => void;
  /** Signed model metres along the selected normal. */
  onPreview: (distance: number) => void;
  /** One atomic gesture completion, in signed model metres. */
  onCommit: (distance: number) => void;
  onCancel: () => void;
}>;
