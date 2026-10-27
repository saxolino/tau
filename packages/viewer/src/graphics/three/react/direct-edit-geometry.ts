import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import type { Camera, Object3D } from 'three';
import type { RenderFrame } from '@taucad/spatial';
import { toRenderPoint } from '@taucad/spatial';
import { getLineMeasurementFeatures } from '#graphics/three/utils/measurement-features.js';
import { getModelComponentIdInHierarchy } from '#graphics/three/utils/model-component-owner.js';
import { createRaycastClipTest, raycastFirstVisibleMeshHit } from '#graphics/three/utils/bvh-raycast.js';
import type { RaycastClipState } from '#graphics/three/utils/bvh-raycast.js';
import { planarFacePixelScale } from '#graphics/three/react/planar-face-gesture.js';
import { setRaycasterFromCamera } from '#graphics/three/utils/raycaster-from-camera.js';
import { manualSelectionColor } from '#graphics/three/overlay-colors.constants.js';
import { gltfSurfacePresentationTag } from '#graphics/three/utils/gltf-surface-batches.js';
import type { DirectEditChange } from '#graphics/three/react/direct-edit-tool.js';

type NativeEdge = Readonly<{ componentId: string; edgeId: number; a: Vector3; b: Vector3 }>;

/** Read immutable source edge polylines, including viewer fat-line replacements. @internal */
export function directEditEdges(scene: Object3D): NativeEdge[] {
  const result: NativeEdge[] = [];
  scene.updateWorldMatrix(true, true);
  scene.traverseVisible((object) => {
    if (object.type !== 'LineSegments' && object.type !== 'LineSegments2') {
      return;
    }
    const line = object as Object3D & { geometry: BufferGeometry };
    const componentId = getModelComponentIdInHierarchy(line);
    if (!componentId) {
      return;
    }
    for (const feature of getLineMeasurementFeatures(line).features) {
      if (feature.kind !== 'edge') {
        continue;
      }
      const match = /:edge:(\d+):\d+$/.exec(feature.id);
      if (!match) {
        continue;
      }
      const edgeId = Number(match[1]);
      for (let index = 0; index < feature.points.length - (feature.closed ? 0 : 1); index++) {
        result.push({
          componentId,
          edgeId,
          a: feature.points[index]!.clone().applyMatrix4(line.matrixWorld),
          b: feature.points[(index + 1) % feature.points.length]!.clone().applyMatrix4(line.matrixWorld),
        });
      }
    }
  });
  return result;
}

/** Pick only explicit topology edges, visible at their own projected surface depth. @internal */
export function pickDirectEditEdge({
  edges,
  raycaster,
  camera,
  height,
  meshes,
  clipping,
}: Readonly<{
  edges: readonly NativeEdge[];
  raycaster: Raycaster;
  camera: Camera;
  height: number;
  meshes: readonly Mesh[];
  clipping: RaycastClipState | undefined;
}>): Readonly<{ componentId: string; edgeId: number; point: Vector3 }> | undefined {
  const kept = createRaycastClipTest(clipping);
  let nearest: { componentId: string; edgeId: number; point: Vector3; pixels: number } | undefined;
  const edgePoint = new Vector3();
  const rayPoint = new Vector3();
  for (const edge of edges) {
    raycaster.ray.distanceSqToSegment(edge.a, edge.b, rayPoint, edgePoint);
    if (kept && !kept(edgePoint)) {
      continue;
    }
    const projected = edgePoint.clone().project(camera);
    if (Math.abs(projected.z) > 1) {
      continue;
    }
    const pixels = rayPoint.distanceTo(edgePoint) / planarFacePixelScale(camera, edgePoint, height);
    if (pixels > 9 || (nearest && pixels >= nearest.pixels)) {
      continue;
    }
    // Test the edge pixel, not the nearby body click: a back edge must never win.
    const edgeRaycaster = new Raycaster();
    edgeRaycaster.layers.mask = raycaster.layers.mask;
    setRaycasterFromCamera(edgeRaycaster, new Vector2(projected.x, projected.y), camera);
    const visible = raycastFirstVisibleMeshHit({ raycaster: edgeRaycaster, meshes, clipping });
    if (
      visible.pending ||
      (visible.hit &&
        visible.hit.distance + planarFacePixelScale(camera, edgePoint, height) * 0.25 <
          edgeRaycaster.ray.origin.distanceTo(edgePoint))
    ) {
      continue;
    }
    nearest = { componentId: edge.componentId, edgeId: edge.edgeId, point: edgePoint.clone(), pixels };
  }
  return nearest;
}

/** Own the ghost's material and nodes; source geometry is borrowed and never disposed. @internal */
export function createDirectEditGhost(
  scene: Object3D,
  componentId: string,
): { group: Group; material: MeshBasicMaterial; dispose: () => void } {
  const group = new Group();
  const material = new MeshBasicMaterial({
    color: manualSelectionColor,
    transparent: true,
    opacity: 0.4,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  scene.updateWorldMatrix(true, true);
  scene.traverseVisible((object) => {
    if (
      !(object instanceof Mesh) ||
      object.type === 'LineSegments2' ||
      object.userData[gltfSurfacePresentationTag] === true ||
      getModelComponentIdInHierarchy(object) !== componentId ||
      !(object.geometry instanceof BufferGeometry) ||
      object.geometry.getAttribute('position') === undefined
    ) {
      return;
    }
    const mesh = new Mesh(object.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(object.matrixWorld);
    mesh.raycast = () => undefined;
    group.add(mesh);
  });
  group.visible = false;
  group.matrixAutoUpdate = false;
  return {
    group,
    material,
    dispose: () => {
      group.clear();
      material.dispose();
    },
  };
}

/** Apply one native-space preview as an independent render-space matrix. @internal */
export function directEditPreviewMatrix(change: DirectEditChange, renderFrame: RenderFrame): Matrix4 {
  if (change.type === 'translate') {
    return new Matrix4().makeTranslation(
      change.delta[0] / renderFrame.metersPerRenderUnit,
      change.delta[1] / renderFrame.metersPerRenderUnit,
      change.delta[2] / renderFrame.metersPerRenderUnit,
    );
  }
  const origin = toRenderPoint({ renderFrame, point: change.origin });
  const matrix =
    change.type === 'rotate'
      ? new Matrix4().makeRotationAxis(new Vector3(...change.axis).normalize(), change.angleRadians)
      : new Matrix4().makeScale(change.factor, change.factor, change.factor);
  return new Matrix4()
    .makeTranslation(...origin)
    .multiply(matrix)
    .multiply(new Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]));
}

/** Allocate only the selected edge segments for a native edge highlight. @internal */
export function directEditEdgeGeometry(
  edges: readonly NativeEdge[],
  componentId: string,
  ids: readonly number[],
): BufferGeometry {
  const selected = new Set(ids);
  const points: number[] = [];
  for (const edge of edges) {
    if (edge.componentId === componentId && selected.has(edge.edgeId)) {
      points.push(...edge.a.toArray(), ...edge.b.toArray());
    }
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3));
}
