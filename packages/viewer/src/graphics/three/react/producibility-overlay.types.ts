/**
 * One face a producibility check points at, with its level. @public
 */
export type ProducibilityFace = Readonly<{ faceId: number; level: 'warning' | 'block' }>;

/**
 * What the viewer tints for one piece: some faces, the draft map of all its faces toward the pull direction, or the
 * whole piece. Face ids are the B-rep face indices the topology face spans carry (`face:N`). @public
 */
export type ProducibilityPieceOverlay = Readonly<{
  componentId: string;
  faces: readonly ProducibilityFace[];
  /** Tint every face by its draft toward ±`direction` (model axes): warning at 0°, ok from `minimum` degrees up. */
  draft?: Readonly<{ direction: readonly [number, number, number]; minimum: number }>;
  /** The whole piece is the problem (an open solid): every face in the block tint. */
  whole?: boolean;
}>;

/**
 * The producibility highlight the host asks for. Transient render resources only; the geometry stays the kernel's.
 * `artifactKey` names the presented artifact the face ids were measured on: any other artifact shows nothing. @public
 */
export type ProducibilityOverlay = Readonly<{
  artifactKey?: string;
  pieces: readonly ProducibilityPieceOverlay[];
}>;
