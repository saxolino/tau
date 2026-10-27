import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { parseGltfBytes } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import type { GltfJson } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';

/**
 * The model as the sample photo's maps need it (SinopiaCAD D6): every triangle of the presented GLB with its vertex
 * normals, and every B-rep edge the kernel wrote as a line primitive, in the Tau root frame — millimetres, Z up — the
 * frame the D3 cameras (`@taucad/smlib/verifica`) speak. Pure parsing: no Three.js scene, no GPU, so it runs in a
 * worker, in jsdom and in the page alike.
 */
export type MeshFoto = Readonly<{
  /** Nine numbers per triangle: three vertices, mm, Z up. */
  triangoli: Float32Array;
  /** Nine numbers per triangle: the unit normal at each vertex (the face's own when the GLB has none). */
  normali: Float32Array;
  /** Six numbers per segment: the two ends of a B-rep edge, mm, Z up. */
  segmenti: Float32Array;
}>;

type Accessor = NonNullable<GltfJson['accessors']>[number] & {
  normalized?: boolean;
  sparse?: unknown;
  byteOffset?: number;
};
type BufferView = NonNullable<GltfJson['bufferViews']>[number] & { byteStride?: number; byteOffset?: number };
type Primitive = { attributes: Record<string, number | undefined>; indices?: number; mode?: number };
type Node = {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};

const float = 5126;
const componentBytes: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const millimetresPerMetre = 1000;
const modeLines = 1;
const modeTriangles = 4;

/** glTF is Y up in metres; the Tau root frame is Z up in millimetres: (x, y, z) → (x, −z, y) × 1000. */
const toRoot = new Matrix4()
  .makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, -1, 0))
  .multiply(new Matrix4().makeScale(millimetresPerMetre, millimetresPerMetre, millimetresPerMetre));

function readFloats(json: GltfJson, bin: Uint8Array<ArrayBuffer>, index: number, components: number): Float32Array {
  const accessor = json.accessors?.[index] as Accessor | undefined;
  const view = accessor?.bufferView === undefined ? undefined : (json.bufferViews?.[accessor.bufferView] as BufferView);
  if (!accessor || !view || accessor.componentType !== float || accessor.normalized || accessor.sparse) {
    throw new Error('Sample photo: only plain float accessors are read.');
  }
  const stride = view.byteStride ?? components * 4;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float32Array(accessor.count * components);
  for (let item = 0; item < accessor.count; item++) {
    for (let component = 0; component < components; component++) {
      out[item * components + component] = data.getFloat32(start + item * stride + component * 4, true);
    }
  }
  return out;
}

function readIndices(
  json: GltfJson,
  bin: Uint8Array<ArrayBuffer>,
  index: number | undefined,
  count: number,
): Uint32Array {
  if (index === undefined) {
    return Uint32Array.from({ length: count }, (_, item) => item);
  }
  const accessor = json.accessors?.[index] as Accessor | undefined;
  const view = accessor?.bufferView === undefined ? undefined : (json.bufferViews?.[accessor.bufferView] as BufferView);
  const size = accessor ? componentBytes[accessor.componentType] : undefined;
  if (!accessor || !view || size === undefined || accessor.componentType === float || accessor.sparse) {
    throw new Error('Sample photo: unreadable index accessor.');
  }
  const stride = view.byteStride ?? size;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Uint32Array(accessor.count);
  for (let item = 0; item < accessor.count; item++) {
    const at = start + item * stride;
    out[item] = size === 1 ? data.getUint8(at) : size === 2 ? data.getUint16(at, true) : data.getUint32(at, true);
  }
  return out;
}

function localMatrix(node: Node): Matrix4 {
  if (node.matrix?.length === 16) {
    return new Matrix4().fromArray(node.matrix);
  }
  const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
  const [qx = 0, qy = 0, qz = 0, qw = 1] = node.rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];
  return new Matrix4().compose(new Vector3(tx, ty, tz), new Quaternion(qx, qy, qz, qw), new Vector3(sx, sy, sz));
}

/**
 * Read the GLB the viewer presents into triangles and edges in the Tau root frame.
 *
 * @param content - The GLB bytes (`rendering.artifact.content`).
 * @returns Triangles with normals, and edge segments.
 */
export function meshDaGlb(content: Uint8Array<ArrayBuffer>): MeshFoto {
  const { json, bin } = parseGltfBytes(content);
  const triangoli: number[] = [];
  const normali: number[] = [];
  const segmenti: number[] = [];
  const nodes = (json.nodes ?? []) as Node[];
  const meshes = (json.meshes ?? []) as Array<{ primitives: Primitive[] }>;
  const position = new Vector3();
  const normal = new Vector3();

  const visit = (index: number, parent: Matrix4, depth: number): void => {
    const node = nodes[index];
    if (!node || depth > 64) {
      return;
    }
    const world = parent.clone().multiply(localMatrix(node));
    const normalMatrix = new Matrix3().getNormalMatrix(world);
    for (const primitive of node.mesh === undefined ? [] : (meshes[node.mesh]?.primitives ?? [])) {
      const mode = primitive.mode ?? modeTriangles;
      const positionIndex = primitive.attributes['POSITION'];
      if (positionIndex === undefined || (mode !== modeTriangles && mode !== modeLines)) {
        continue;
      }
      const positions = readFloats(json, bin, positionIndex, 3);
      const vertexCount = positions.length / 3;
      const indices = readIndices(json, bin, primitive.indices, vertexCount);
      const at = (vertex: number): Vector3 =>
        position
          .set(positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!)
          .applyMatrix4(world);
      if (mode === modeLines) {
        for (let item = 0; item + 1 < indices.length; item += 2) {
          for (const vertex of [indices[item]!, indices[item + 1]!]) {
            const p = at(vertex);
            segmenti.push(p.x, p.y, p.z);
          }
        }
        continue;
      }
      const normalIndex = primitive.attributes['NORMAL'];
      const normalsIn = normalIndex === undefined ? undefined : readFloats(json, bin, normalIndex, 3);
      for (let item = 0; item + 2 < indices.length; item += 3) {
        const corners = [indices[item]!, indices[item + 1]!, indices[item + 2]!];
        const points = corners.map((vertex) => at(vertex).clone());
        const face = new Vector3()
          .subVectors(points[1]!, points[0]!)
          .cross(new Vector3().subVectors(points[2]!, points[0]!))
          .normalize();
        for (const [corner, vertex] of corners.entries()) {
          const p = points[corner]!;
          triangoli.push(p.x, p.y, p.z);
          if (normalsIn) {
            normal
              .set(normalsIn[vertex * 3]!, normalsIn[vertex * 3 + 1]!, normalsIn[vertex * 3 + 2]!)
              .applyMatrix3(normalMatrix)
              .normalize();
            normali.push(normal.x, normal.y, normal.z);
          } else {
            normali.push(face.x, face.y, face.z);
          }
        }
      }
    }
    for (const child of node.children ?? []) {
      visit(child, world, depth + 1);
    }
  };

  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, index) => index);
  for (const root of roots) {
    visit(root, toRoot, 0);
  }
  return {
    triangoli: Float32Array.from(triangoli),
    normali: Float32Array.from(normali),
    segmenti: Float32Array.from(segmenti),
  };
}
