import { BufferGeometry, Color, Float32BufferAttribute, Matrix3, Mesh, Vector3 } from 'three';
import type { Object3D } from 'three';
import { gltfSurfacePresentationTag } from '#graphics/three/utils/gltf-surface-batches.js';
import type { ProducibilityPieceOverlay } from '#graphics/three/react/producibility-overlay.types.js';

type FaceSpan = Readonly<{ id: string; start: number; count: number }>;
type SurfaceAssociation = Readonly<{ componentId?: string; faces?: readonly FaceSpan[] }>;

/** A topology face's triangles in render space: positions and the source mesh's normals, nine numbers a triangle. */
export type FaceSurface = Readonly<{ positions: Float32Array; normals: Float32Array }>;

/** The tints the overlay mixes, as Three.js colours. @internal */
export type ProducibilityTints = Readonly<{ block: Color; warning: Color; ok: Color }>;

/**
 * Every topology face of one component, in render space, read once from the meshes that carry its occurrence spans.
 * Source geometry is only read.
 *
 * @internal
 * @param scene - The presented model.
 * @param componentId - The component.
 * @returns Face id → triangles; empty for an unknown component or a mesh without topology.
 */
export function componentFaceSurfaces(scene: Object3D, componentId: string): Map<number, FaceSurface> {
  const collected = new Map<number, { positions: number[]; normals: number[] }>();
  const point = new Vector3();
  const normal = new Vector3();
  const normalMatrix = new Matrix3();
  scene.updateWorldMatrix(true, true);
  scene.traverse((object) => {
    if (!(object instanceof Mesh) || object.userData[gltfSurfacePresentationTag] === true) {
      return;
    }
    const association = object.userData['measurementFeatures'] as SurfaceAssociation | undefined;
    const geometry = object.geometry as BufferGeometry | undefined;
    const position = geometry?.getAttribute('position');
    if (association?.componentId !== componentId || !association.faces || !geometry || !position) {
      return;
    }
    const normals = geometry.hasAttribute('normal') ? geometry.getAttribute('normal') : undefined;
    const index = geometry.getIndex();
    normalMatrix.getNormalMatrix(object.matrixWorld);
    for (const span of association.faces) {
      const faceId = Number(span.id.replace(/^face:/u, ''));
      if (!Number.isInteger(faceId)) {
        continue;
      }
      const face = collected.get(faceId) ?? { positions: [], normals: [] };
      collected.set(faceId, face);
      const first = Math.ceil(span.start / 3) * 3;
      const last = Math.min(span.start + span.count, index?.count ?? position.count);
      for (let offset = first; offset + 3 <= last; offset += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const vertex = index?.getX(offset + corner) ?? offset + corner;
          point.fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld);
          face.positions.push(point.x, point.y, point.z);
          if (normals) {
            normal.fromBufferAttribute(normals, vertex).applyMatrix3(normalMatrix).normalize();
            face.normals.push(normal.x, normal.y, normal.z);
          }
        }
      }
    }
  });
  const surfaces = new Map<number, FaceSurface>();
  for (const [faceId, face] of collected) {
    if (face.positions.length < 9) {
      continue;
    }
    const positions = new Float32Array(face.positions);
    surfaces.set(faceId, {
      positions,
      normals: face.normals.length === face.positions.length ? new Float32Array(face.normals) : flatNormals(positions),
    });
  }
  return surfaces;
}

/** One normal per triangle corner from the triangle's own plane, for meshes that carry none. */
function flatNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let offset = 0; offset + 8 < positions.length; offset += 9) {
    a.fromArray(positions, offset);
    b.fromArray(positions, offset + 3).sub(a);
    c.fromArray(positions, offset + 6).sub(a);
    const n = b.cross(c).normalize();
    for (let corner = 0; corner < 3; corner++) {
      n.toArray(normals, offset + corner * 3);
    }
  }
  return normals;
}

/**
 * The draft tint of one surface normal toward ±`direction`: the warning tint where the surface runs parallel to the
 * pull (0°), mixing into the ok tint as the draft reaches `minimum` degrees. A two-part mould releases a face to the
 * half it looks at, so the angle is taken on |n·d|.
 *
 * @internal
 * @param input - Unit surface normal (render axes are the model's), unit pull direction, the process's minimum draft
 *   in degrees (> 0) and the overlay colours.
 * @param target - Receives the colour.
 * @returns `target`.
 */
export function draftTint(
  {
    normal,
    direction,
    minimum,
    tints,
  }: Readonly<{ normal: Readonly<Vector3>; direction: Readonly<Vector3>; minimum: number; tints: ProducibilityTints }>,
  target: Color,
): Color {
  const degrees = (Math.asin(Math.min(1, Math.abs(normal.dot(direction)))) * 180) / Math.PI;
  const t = Math.min(1, Math.max(0, degrees / Math.max(minimum, 1e-3)));
  return target.copy(tints.warning).lerp(tints.ok, t);
}

/**
 * The veil of one piece: its listed faces in their level's tint, every face in the draft gradient when the overlay
 * asks for the draft map (listed faces keep their tint over it), or every face in the block tint for a whole piece.
 *
 * @internal
 * @param surfaces - The piece's faces from {@link componentFaceSurfaces}.
 * @param piece - What to tint.
 * @param tints - The overlay colours.
 * @returns A vertex-coloured geometry the caller owns and disposes, or undefined when nothing is tinted.
 */
export function producibilityPieceGeometry(
  surfaces: ReadonlyMap<number, FaceSurface>,
  piece: ProducibilityPieceOverlay,
  tints: ProducibilityTints,
): BufferGeometry | undefined {
  const levels = new Map(piece.faces.map(({ faceId, level }) => [faceId, level]));
  const positions: number[] = [];
  const colors: number[] = [];
  const normal = new Vector3();
  const direction = piece.draft ? new Vector3(...piece.draft.direction).normalize() : undefined;
  const color = new Color();
  for (const [faceId, surface] of surfaces) {
    const level = piece.whole ? 'block' : levels.get(faceId);
    if (level === undefined && !direction) {
      continue;
    }
    for (let offset = 0; offset < surface.positions.length; offset += 3) {
      positions.push(surface.positions[offset]!, surface.positions[offset + 1]!, surface.positions[offset + 2]!);
      if (level === undefined && direction && piece.draft) {
        normal.fromArray(surface.normals, offset);
        draftTint({ normal, direction, minimum: piece.draft.minimum, tints }, color);
      } else {
        color.copy(level === 'block' ? tints.block : tints.warning);
      }
      colors.push(color.r, color.g, color.b);
    }
  }
  if (positions.length < 9) {
    return undefined;
  }
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
