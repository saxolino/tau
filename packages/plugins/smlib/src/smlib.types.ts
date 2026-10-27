import type { ManualFaceInfo, ManualEdgeInfo, ManualBounds } from '#manual-operations.js';
import type { GlbMaterial } from '@taucad/geometry-core';
import type { ManualShapeInfo } from '#manual-evaluator.js';

/**
 * Tessellated 3D geometry produced by the SMLib kernel: an indexed triangle mesh grouped by B-rep
 * face and optional B-rep edge polylines grouped by edge.
 */
export type GeometrySmlib = {
  format: 'smlib';
  /** Manual history and an exact-state guard for picked edges. */
  manual?: ManualShapeInfo;
  /** Native planar face descriptors, only when tessellation retained a trusted face mapping. */
  manualFaces?: Array<Omit<ManualFaceInfo, 'faceId'>>;
  /** Native curves corresponding exactly to sampled edge ranges. */
  manualEdges?: Array<Omit<ManualEdgeInfo, 'edgeId'>>;
  /** Exact solid bounds in native Z-up millimetres. */
  manualBounds?: ManualBounds;
  /** Exact solid volume (mm³) and authored density (g/cm³), never mesh-derived estimates. */
  /** Exact volume of the solid; density and mass only when the model gives a density. */
  physical?: { volumeMm3: number; density?: number; massGrams?: number };
  faces: {
    triangles: number[];
    vertices: number[];
    normals: number[];
    texCoords?: number[];
    tangents?: number[];
    /** Index ranges (`start`, `count` in indices) of each B-rep face, in `shape.faces()` order. */
    faceGroups: Array<{
      start: number;
      count: number;
      faceId: number;
    }>;
  };
  edges: {
    /** De-indexed line segments, six scalars per segment. */
    lines: number[];
    /** Scalar ranges (`start`, `count`) of each B-rep edge, in `shape.edges()` order. */
    edgeGroups: Array<{
      start: number;
      count: number;
      edgeId: number;
    }>;
  };
  color?: string;
  opacity?: number;
  metalness?: number;
  roughness?: number;
  material?: GlbMaterial;
  name: string;
};
