import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { gltfSurfacePresentationTag } from '#graphics/three/utils/gltf-surface-batches.js';

type FaceSpan = Readonly<{ id: string; start: number; count: number }>;
type SurfaceAssociation = Readonly<{ componentId?: string; faces?: readonly FaceSpan[] }>;

const yAxis = new Vector3(0, 1, 0);

/**
 * The triangles of one topology face, in render space, read from the meshes that carry its occurrence spans.
 * Source geometry is only read; a missing face (another artifact, a mesh without topology) yields nothing.
 *
 * @internal
 * @param scene - The presented model.
 * @param componentId - The face's component.
 * @param faceId - The occurrence face id, as the face pick reported it.
 * @returns Flat triangle positions (nine numbers per triangle), or undefined.
 */
export function planarFaceTriangles(scene: Object3D, componentId: string, faceId: number): Float32Array | undefined {
  const positions: number[] = [];
  const point = new Vector3();
  const id = `face:${faceId}`;
  scene.updateWorldMatrix(true, true);
  scene.traverse((object) => {
    if (!(object instanceof Mesh) || object.userData[gltfSurfacePresentationTag] === true) {
      return;
    }
    const association = object.userData['measurementFeatures'] as SurfaceAssociation | undefined;
    const span =
      association?.componentId === componentId ? association.faces?.find((face) => face.id === id) : undefined;
    const geometry = object.geometry as BufferGeometry | undefined;
    const attribute = geometry?.getAttribute('position');
    if (!span || !geometry || !attribute) {
      return;
    }
    const index = geometry.getIndex();
    const first = Math.ceil(span.start / 3) * 3;
    const last = Math.min(span.start + span.count, index?.count ?? attribute.count);
    for (let offset = first; offset + 3 <= last; offset += 3) {
      for (let corner = 0; corner < 3; corner++) {
        point
          .fromBufferAttribute(attribute, index?.getX(offset + corner) ?? offset + corner)
          .applyMatrix4(object.matrixWorld);
        positions.push(point.x, point.y, point.z);
      }
    }
  });
  return positions.length >= 9 ? new Float32Array(positions) : undefined;
}

/**
 * The selected face as its own surface, for the titanio veil.
 *
 * @internal
 * @param triangles - Render-space triangles from {@link planarFaceTriangles}.
 * @returns A geometry the caller owns and disposes.
 */
export function faceVeilGeometry(triangles: Float32Array): BufferGeometry {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(triangles, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const pointKey = (values: ArrayLike<number>, offset: number): string =>
  `${Math.round(values[offset]! * 1e5)},${Math.round(values[offset + 1]! * 1e5)},${Math.round(values[offset + 2]! * 1e5)}`;

/**
 * The face's outline: the triangle edges used by one triangle only.
 *
 * @internal
 * @param triangles - Render-space triangles.
 * @returns Index pairs into `triangles` (offsets of each edge's two corners).
 */
function outlineEdges(triangles: Float32Array): Array<readonly [number, number]> {
  const edges = new Map<string, { a: number; b: number; uses: number }>();
  for (let offset = 0; offset + 8 < triangles.length; offset += 9) {
    for (const [a, b] of [
      [offset, offset + 3],
      [offset + 3, offset + 6],
      [offset + 6, offset],
    ] as const) {
      const keyA = pointKey(triangles, a);
      const keyB = pointKey(triangles, b);
      const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
      const edge = edges.get(key);
      if (edge) {
        edge.uses += 1;
      } else {
        edges.set(key, { a, b, uses: 1 });
      }
    }
  }
  return [...edges.values()].filter((edge) => edge.uses === 1).map((edge) => [edge.a, edge.b] as const);
}

/**
 * The face's outline as segment endpoints, for the titanio contour around the veil.
 *
 * @internal
 * @param triangles - Render-space triangles of the face.
 * @returns Six numbers per segment.
 */
export function faceOutlinePositions(triangles: Float32Array): Float32Array {
  const positions: number[] = [];
  for (const [a, b] of outlineEdges(triangles)) {
    positions.push(
      triangles[a]!,
      triangles[a + 1]!,
      triangles[a + 2]!,
      triangles[b]!,
      triangles[b + 1]!,
      triangles[b + 2]!,
    );
  }
  return new Float32Array(positions);
}

/**
 * A prism of unit height over the face: its base on the face, its top one render unit along `normal`, and walls on the
 * face's outline (edges used by one triangle only). Scaling it along the normal ({@link prismScaleMatrix}) shows exactly
 * the material a planar face extrusion of that distance adds or removes.
 *
 * @internal
 * @param triangles - Render-space triangles of a planar face.
 * @param normal - The face's unit normal in render axes.
 * @returns A geometry the caller owns and disposes.
 */
export function facePrismGeometry(triangles: Float32Array, normal: Readonly<Vector3>): BufferGeometry {
  const unit = new Vector3().copy(normal).normalize();
  const positions: number[] = [];
  const top = (offset: number): number[] => [
    triangles[offset]! + unit.x,
    triangles[offset + 1]! + unit.y,
    triangles[offset + 2]! + unit.z,
  ];
  const bottom = (offset: number): number[] => [triangles[offset]!, triangles[offset + 1]!, triangles[offset + 2]!];
  for (let offset = 0; offset + 8 < triangles.length; offset += 9) {
    positions.push(...bottom(offset), ...bottom(offset + 6), ...bottom(offset + 3));
    positions.push(...top(offset), ...top(offset + 3), ...top(offset + 6));
  }
  for (const [a, b] of outlineEdges(triangles)) {
    positions.push(...bottom(a), ...bottom(b), ...top(b), ...bottom(a), ...top(b), ...top(a));
  }
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Stretch a unit-height prism to `height` render units along `normal`, keeping the face plane through `origin` fixed.
 *
 * @internal
 * @param origin - A point of the face plane, in render space.
 * @param normal - The face's unit normal in render axes.
 * @param height - Signed render units; negative heights extend into the solid.
 * @returns The affine matrix `x ↦ x + (height − 1)(n·(x − origin))n`.
 */
export function prismScaleMatrix(origin: Readonly<Vector3>, normal: Readonly<Vector3>, height: number): Matrix4 {
  const n = new Vector3().copy(normal).normalize();
  const k = height - 1;
  const matrix = new Matrix4().set(
    1 + k * n.x * n.x,
    k * n.x * n.y,
    k * n.x * n.z,
    0,
    k * n.y * n.x,
    1 + k * n.y * n.y,
    k * n.y * n.z,
    0,
    k * n.z * n.x,
    k * n.z * n.y,
    1 + k * n.z * n.z,
    0,
    0,
    0,
    0,
    1,
  );
  const shift = new Vector3().copy(origin).sub(new Vector3().copy(origin).applyMatrix4(matrix));
  return matrix.setPosition(shift);
}

/**
 * A drill's volume: a cylinder from `start` along `axis`, for the hole preview.
 *
 * @internal
 * @param hole - Where it starts on the face and its drilling direction (into the solid), in render space, and its
 * radius and depth in render units.
 * @returns A geometry the caller owns and disposes.
 */
export function holeGeometry({
  start,
  axis,
  radius,
  depth,
}: Readonly<{ start: Readonly<Vector3>; axis: Readonly<Vector3>; radius: number; depth: number }>): BufferGeometry {
  const direction = new Vector3().copy(axis).normalize();
  const geometry = new CylinderGeometry(radius, radius, depth, 40, 1, false);
  const centre = new Vector3().copy(start).addScaledVector(direction, depth / 2);
  geometry.applyMatrix4(
    new Matrix4().compose(centre, new Quaternion().setFromUnitVectors(yAxis, direction), new Vector3(1, 1, 1)),
  );
  return geometry;
}

/**
 * Tubes of `radius` around edge segments: how far a fillet or chamfer of that size reaches from each selected edge.
 *
 * @internal
 * @param positions - Segment endpoints in render space, six numbers per segment.
 * @param radius - Render units.
 * @returns A geometry the caller owns and disposes, or undefined without segments.
 */
export function edgeTubeGeometry(positions: ArrayLike<number>, radius: number): BufferGeometry | undefined {
  const merged: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  for (let offset = 0; offset + 5 < positions.length; offset += 6) {
    a.set(positions[offset]!, positions[offset + 1]!, positions[offset + 2]!);
    b.set(positions[offset + 3]!, positions[offset + 4]!, positions[offset + 5]!);
    const length = a.distanceTo(b);
    if (!(length > 0)) {
      continue;
    }
    const segment = new CylinderGeometry(radius, radius, length, 16, 1, true);
    segment.applyMatrix4(
      new Matrix4().compose(
        a.clone().add(b).multiplyScalar(0.5),
        new Quaternion().setFromUnitVectors(yAxis, b.clone().sub(a).normalize()),
        new Vector3(1, 1, 1),
      ),
    );
    const flat = segment.toNonIndexed().getAttribute('position');
    for (let index = 0; index < flat.count; index++) {
      merged.push(flat.getX(index), flat.getY(index), flat.getZ(index));
    }
    segment.dispose();
  }
  if (merged.length === 0) {
    return undefined;
  }
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(merged, 3));
  geometry.computeVertexNormals();
  return geometry;
}
