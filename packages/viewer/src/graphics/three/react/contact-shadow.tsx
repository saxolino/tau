import { useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
} from 'three';
import type { Group, Mesh, Object3D } from 'three';
import { computeContactShadow } from '#graphics/three/utils/contact-shadow.js';
import type { AxisIndex, ContactShadow as ContactShadowData } from '#graphics/three/utils/contact-shadow.js';
import { sceneTag } from '#graphics/three/utils/scene-tags.js';
import { useGraphicsSelector, useModelInteractionSelector } from '#hooks/use-graphics.jsx';
import { useViewerEnvironment } from '#environment/viewer-environment.jsx';

/** Strength of the darkest texel: a floor shadow, never a black cut-out. */
const shadowStrength = { light: 0.6, dark: 0.8 } as const;
/** A warm umber reads as shadow on the cream floor; on charcoal only black darkens. sRGB. */
const shadowTint = { light: [52, 40, 30], dark: [0, 0, 0] } as const;
/** Triangles beyond this are sampled: the shadow is a blur, it does not need every facet of a pavé. */
const maximumTriangles = 400_000;

const axisIndexOf = { x: 0, y: 1, z: 2 } as const satisfies Record<'x' | 'y' | 'z', AxisIndex>;

function isShadowCaster(object: Object3D): object is Mesh {
  const mesh = object as Partial<Mesh> & Object3D;
  if (!mesh.isMesh || !mesh.geometry) {
    return false;
  }
  // Fat edge lines are meshes of instanced segments: they are a drawing aid, not matter.
  const { attributes } = mesh.geometry;
  return !('instanceStart' in attributes) && 'position' in attributes;
}

function isVisibleUnder(object: Object3D, root: Object3D): boolean {
  for (let current: Object3D | undefined = object; current && current !== root; current = current.parent ?? undefined) {
    if (!current.visible) {
      return false;
    }
  }
  return true;
}

/** Collect the visible surfaces' triangles in the frame of `frame`, with their bounds. */
function collectTriangles(
  model: Object3D,
  frame: Object3D,
): { triangles: Float32Array; min: [number, number, number]; max: [number, number, number] } | undefined {
  const meshes: Mesh[] = [];
  let triangleCount = 0;
  model.traverse((object) => {
    if (
      Boolean(object.userData[sceneTag.gltfSurfacePresentation]) ||
      !isShadowCaster(object) ||
      !isVisibleUnder(object, model)
    ) {
      return;
    }
    meshes.push(object);
    const index = object.geometry.getIndex();
    triangleCount += Math.floor((index?.count ?? object.geometry.getAttribute('position').count) / 3);
  });
  if (triangleCount === 0) {
    return undefined;
  }
  const stride = Math.max(1, Math.ceil(triangleCount / maximumTriangles));
  const triangles = new Float32Array(Math.ceil(triangleCount / stride) * 9);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const toFrame = new Matrix4();
  const inverseFrame = new Matrix4().copy(frame.matrixWorld).invert();
  const corner = new Vector3();
  let written = 0;
  let seen = 0;
  for (const mesh of meshes) {
    toFrame.multiplyMatrices(inverseFrame, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = Math.floor((index?.count ?? position.count) / 3);
    for (let triangle = 0; triangle < count; triangle++, seen++) {
      if (seen % stride !== 0 || written + 9 > triangles.length) {
        continue;
      }
      for (let vertex = 0; vertex < 3; vertex++) {
        const at = index ? index.getX(triangle * 3 + vertex) : triangle * 3 + vertex;
        corner.fromBufferAttribute(position, at).applyMatrix4(toFrame);
        triangles[written++] = corner.x;
        triangles[written++] = corner.y;
        triangles[written++] = corner.z;
        min[0] = Math.min(min[0], corner.x);
        min[1] = Math.min(min[1], corner.y);
        min[2] = Math.min(min[2], corner.z);
        max[0] = Math.max(max[0], corner.x);
        max[1] = Math.max(max[1], corner.y);
        max[2] = Math.max(max[2], corner.z);
      }
    }
  }
  return { triangles: triangles.subarray(0, written), min, max };
}

/** A quad on the ground covering the shadow's square, a hair below the model's lowest point. */
function createShadowGeometry(shadow: ContactShadowData, up: AxisIndex): BufferGeometry {
  const [a, b] = shadow.axes;
  const lift = -shadow.size * 1e-4;
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const;
  const positions = new Float32Array(12);
  const uvs = new Float32Array(8);
  for (const [index, [u, v]] of corners.entries()) {
    const point = [0, 0, 0];
    point[a] = shadow.origin[0] + u * shadow.size;
    point[b] = shadow.origin[1] + v * shadow.size;
    point[up] = shadow.groundHeight + lift;
    positions.set(point, index * 3);
    uvs.set([u, v], index * 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeBoundingSphere();
  return geometry;
}

function createShadowTexture(
  shadow: ContactShadowData,
  strength: number,
  tint: readonly [number, number, number],
): DataTexture {
  const pixels = new Uint8Array(shadow.alpha.length * 4);
  for (let texel = 0; texel < shadow.alpha.length; texel++) {
    pixels.set([...tint, Math.round(Math.min(1, shadow.alpha[texel]! * strength) * 255)], texel * 4);
  }
  const texture = new DataTexture(pixels, shadow.resolution, shadow.resolution, RGBAFormat, UnsignedByteType);
  // The tint is a display colour; without this it would be read as linear and lighten the floor.
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

type ShadowMesh = Readonly<{ geometry: BufferGeometry; material: MeshBasicMaterial }>;

/**
 * A soft shadow on the ground under the model, recomputed when the presented geometry, its pose or the visible pieces
 * change. It lives beside the model, outside its group, so bounds, picking, measuring and sections never see it.
 *
 * @param props - The model's group and the frame the shadow is placed in (the model group's parent).
 * @returns The shadow quad, or nothing while there is no model or the section view is open.
 * @public
 */
export function ContactShadow({
  modelRef,
  frameRef,
  boundsKey,
}: Readonly<{
  // oxlint-disable-next-line typescript/no-restricted-types -- React refs use null
  modelRef: RefObject<Group | null>;
  // oxlint-disable-next-line typescript/no-restricted-types -- React refs use null
  frameRef: RefObject<Group | null>;
  /** Changes whenever the model's bounds are measured again. */
  boundsKey: unknown;
}>): React.JSX.Element | undefined {
  const invalidate = useThree((state) => state.invalidate);
  const upDirection = useGraphicsSelector((state) => state.context.upDirection);
  const enableSurfaces = useGraphicsSelector((state) => state.context.enableSurfaces);
  const isSectionViewActive = useGraphicsSelector((state) => state.context.isSectionViewActive);
  const displayRevision = useModelInteractionSelector((state) => state.context.displayRevision);
  const { colorScheme } = useViewerEnvironment();
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const strength = shadowStrength[scheme];
  const tint = shadowTint[scheme];
  const [shadow, setShadow] = useState<ContactShadowData | undefined>();
  const up = axisIndexOf[upDirection];

  useEffect(() => {
    // Measured after the frame that presented the geometry, so the first picture is never held back.
    const handle = setTimeout(() => {
      const model = modelRef.current;
      const frame = frameRef.current;
      if (!model || !frame) {
        setShadow(undefined);
        return;
      }
      model.updateWorldMatrix(true, true);
      const collected = collectTriangles(model, frame);
      setShadow(collected ? computeContactShadow({ ...collected, up }) : undefined);
    }, 0);
    return () => {
      clearTimeout(handle);
    };
  }, [boundsKey, displayRevision, frameRef, modelRef, up]);

  const mesh = useMemo((): ShadowMesh | undefined => {
    if (!shadow) {
      return undefined;
    }
    const texture = createShadowTexture(shadow, strength, tint);
    return {
      geometry: createShadowGeometry(shadow, up),
      material: new MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    };
  }, [shadow, strength, tint, up]);

  useEffect(() => {
    invalidate();
    return () => {
      mesh?.geometry.dispose();
      mesh?.material.map?.dispose();
      mesh?.material.dispose();
    };
  }, [invalidate, mesh]);

  if (!mesh || !enableSurfaces || isSectionViewActive) {
    return undefined;
  }
  return (
    <mesh
      geometry={mesh.geometry}
      material={mesh.material}
      renderOrder={-1}
      raycast={() => undefined}
      userData={{ [sceneTag.measurementUi]: true }}
    />
  );
}
