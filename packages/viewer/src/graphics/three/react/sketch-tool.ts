import type {
  SketchEntity,
  SketchFrame,
  SketchSnap,
  SketchVec2,
  SketchVec3,
} from '#graphics/three/react/sketch-geometry.js';

/**
 * The fantasma of what a closed profile becomes, in the sketch's own millimetres: an extrusion along the normal (a
 * signed distance, an optional draft), a revolution about a line of the plane, or a sweep along a model-space path.
 * `cut` draws it as an X-ray through the solid, as the face extrusion's ghost does. @public
 */
export type SketchGhost =
  | Readonly<{ kind: 'extrude'; polygon: readonly SketchVec2[]; distance: number; taper?: number; cut: boolean }>
  | Readonly<{
      kind: 'revolve';
      polygon: readonly SketchVec2[];
      axis: Readonly<{ start: SketchVec2; end: SketchVec2 }>;
      angle: number;
      cut: boolean;
    }>
  | Readonly<{ kind: 'sweep'; polygon: readonly SketchVec2[]; path: readonly SketchVec3[]; cut: boolean }>;

/** One pointer event on the sketch plane, already snapped. @public */
export type SketchPointerEvent = Readonly<{
  type: 'move' | 'click' | 'doubleClick';
  snap: SketchSnap;
  /** The grid step the viewer draws at this zoom, in millimetres. */
  gridStep: number;
}>;

/** A model edge picked while the host asks for one (a revolution axis, a sweep path). @public */
export type SketchEdgePick = Readonly<{
  componentId: string;
  edgeId: number;
  /** Tau Z-up model metres. */
  point: readonly [number, number, number];
}>;

/**
 * A sketch on the model, owned by the host: the viewer draws the plane (veil and millimetre grid), the entities, the
 * one being drawn, the closed regions and the ghost; it snaps the pointer and reports it; it aligns the camera to the
 * plane once per `frameKey`. The host alone turns entities into native operations. @public
 */
export type SketchTool = Readonly<{
  /** The sketch plane in model millimetres. */
  frame: SketchFrame;
  /** Changes when a new plane is chosen: the camera turns to look at it straight on. */
  frameKey: string;
  /** Half the side of the drawn plane square and of the camera's view of it, in millimetres. */
  extent: number;
  entities: readonly SketchEntity[];
  /** The entity being drawn, following the pointer. */
  pending?: readonly SketchEntity[];
  /** Closed loops, as polygons, veiled to show what is a profile. */
  regions?: ReadonlyArray<readonly SketchVec2[]>;
  /** A highlighted line of the plane (the revolution axis). */
  axis?: Readonly<{ start: SketchVec2; end: SketchVec2 }>;
  /** Curves outside the plane (a sweep path drawn in another sketch), in model millimetres. */
  curves?: ReadonlyArray<readonly SketchVec3[]>;
  ghost?: SketchGhost;
  /** `draw` snaps and reports the pointer; `pickEdge` picks a model edge; `view` only shows. */
  mode: 'draw' | 'pickEdge' | 'view';
  /** The previous point of the gesture, for the horizontal and vertical snaps. */
  reference?: SketchVec2;
  onPointer: (event: SketchPointerEvent) => void;
  onPickEdge?: (pick: SketchEdgePick) => void;
}>;
