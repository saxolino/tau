import { useDeferredValue, useLayoutEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import {
  BackSide,
  BufferAttribute,
  CubeTexture,
  DoubleSide,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  SphereGeometry,
} from 'three';
import { PMREMGenerator as WebGpuPmremGenerator } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { useThree, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  applyLightingForCamera,
  ambientBaseIntensity,
  headlampBaseIntensity,
  defaultHeadlampConfig,
  darkModeIntensityScale,
  darkModeAmbientBoost,
  defaultStudioLighting,
} from '#graphics/three/utils/lights.utils.js';
import type { StudioLightingSettings } from '#graphics/three/utils/lights.utils.js';
import { isViewportWebGpu } from '#graphics/three/viewport-cad-renderer.js';
import { isCoarsePointerDevice } from '#graphics/three/utils/device-tier.js';
import { useViewerEnvironment } from '#environment/viewer-environment.jsx';

type UpDirection = 'x' | 'y' | 'z';

/**
 * Environment cubemap resolution (px). Higher = sharper specular reflections.
 *
 * The filtered output is `3·r × 4·r` RGBA16F (24 MiB at 512, 6 MiB at 256) and the source cube
 * adds 18 MiB at 512, so a coarse-pointer device captures at 256: studio reflections are soft.
 */
const envResolution = 512;
const coarsePointerEnvResolution = 256;

/** Broad, low-energy panels keep metallic and back-facing surfaces readable. */
const studioLeftFillIntensity = 1.2;
const studioTopIntensity = 0.25;
const studioGroundIntensity = 1.5;
const studioBackFillIntensity = 8;

type LightsProperties = {
  readonly settings?: Partial<StudioLightingSettings>;
  readonly enableMatcap?: boolean;
  readonly sceneRadius?: number;
  readonly upDirection?: UpDirection;
};

/** Camera-relative PBR lighting with owned environment reflections. */
export function Lights({
  settings,
  enableMatcap = false,
  sceneRadius = 0,
  upDirection = 'z',
}: LightsProperties): React.JSX.Element {
  const { camera, scene, gl, invalidate } = useThree();
  const lighting = { ...defaultStudioLighting, ...settings };
  const cameraLightReference = useRef<THREE.DirectionalLight>(null);
  const ambientReference = useRef<THREE.AmbientLight>(null);
  const { colorScheme } = useViewerEnvironment();
  const isDark = colorScheme === 'dark';

  // Lighting operates in normalized render units; use a neutral radius only before geometry loads.
  const clampedSceneRadius = sceneRadius > 0 ? sceneRadius : 1;

  useLayoutEffect(() => {
    // oxlint-disable-next-line react/immutability -- This effect owns the external Three renderer's exposure setting.
    gl.toneMappingExposure = lighting.exposure;
    invalidate();
  }, [gl, invalidate, lighting.exposure]);

  // Dark mode raises the ambient floor while preserving the key and reflections.
  const themeIntensityScale = isDark ? darkModeIntensityScale : 1;
  const themeAmbientBoost = isDark ? darkModeAmbientBoost : 1;

  // One configuration per input change, so a lighting frame allocates nothing.
  const { headlampIntensity, ambientIntensity, environmentIntensity } = lighting;
  const config = useMemo(
    () => ({
      sceneRadius: clampedSceneRadius,
      upDirection,
      headlampIntensity,
      ambientIntensity,
      environmentIntensity,
      headlampConfig: defaultHeadlampConfig,
      themeIntensityScale,
      themeAmbientBoost,
      webGpuPmrem: isViewportWebGpu(gl),
    }),
    [
      clampedSceneRadius,
      upDirection,
      headlampIntensity,
      ambientIntensity,
      environmentIntensity,
      themeIntensityScale,
      themeAmbientBoost,
      gl,
    ],
  );

  // Per-frame updates delegated to the shared camera-relative lighting utility.
  useFrame(() => {
    applyLightingForCamera({
      scene,
      camera,
      headlamp: cameraLightReference.current ?? undefined,
      ambient: ambientReference.current ?? undefined,
      config,
    });
  });

  const showEnvironment = useDeferredValue(!enableMatcap);
  const resolution = useMemo(() => (isCoarsePointerDevice() ? coarsePointerEnvResolution : envResolution), []);

  // Drei recaptures whenever its children change, so each environment is memoised on exactly
  // what it draws. The studio is also keyed on those values: new radiance remounts the capture
  // and its filter together. Only the environment's own geometry and radiance controls recapture.
  const roomEnvironment = useMemo(() => <RoomLightingEnvironment resolution={resolution} />, [resolution]);
  const jewelryEnvironment = useMemo(
    () => (
      <OwnedLightingEnvironment
        key={clampedSceneRadius}
        resolution={resolution}
        near={clampedSceneRadius * 0.01}
        far={clampedSceneRadius * 40}
      >
        <JewelryLightTent radius={clampedSceneRadius} />
      </OwnedLightingEnvironment>
    ),
    [clampedSceneRadius, resolution],
  );
  const whiteEnvironment = useMemo(
    () => (
      <OwnedLightingEnvironment resolution={resolution} near={0.01} far={20}>
        <mesh>
          <sphereGeometry args={[10, 32, 16]} />
          <meshBasicMaterial color='white' side={BackSide} toneMapped={false} />
        </mesh>
      </OwnedLightingEnvironment>
    ),
    [resolution],
  );
  const studioEnvironment = useMemo(
    () => (
      <OwnedLightingEnvironment
        key={[
          clampedSceneRadius,
          lighting.backgroundIntensity,
          lighting.fillIntensity,
          lighting.keyIntensity,
          lighting.keySize,
        ].join(':')}
        resolution={resolution}
        near={clampedSceneRadius * 0.01}
        far={clampedSceneRadius * 20}
      >
        <>
          <color attach='background' args={[0, 0, 0]} />
          {lighting.backgroundIntensity > 0 ? (
            <mesh>
              <boxGeometry args={[clampedSceneRadius * 20, clampedSceneRadius * 20, clampedSceneRadius * 20]} />
              {/* A shader writes HDR radiance; WebGL clearColor clamps a Color background to [0, 1]. */}
              <meshBasicMaterial
                color={[lighting.backgroundIntensity, lighting.backgroundIntensity, lighting.backgroundIntensity]}
                side={BackSide}
                toneMapped={false}
              />
            </mesh>
          ) : null}
          {/* Cards occlude the enclosure, so each carries the same base radiance plus its local contrast. */}
          <Lightformer
            form='rect'
            intensity={lighting.backgroundIntensity + lighting.keyIntensity}
            position={[clampedSceneRadius, clampedSceneRadius, clampedSceneRadius]}
            scale={[clampedSceneRadius * lighting.keySize, clampedSceneRadius * lighting.keySize, 1]}
          />
          <Lightformer
            form='rect'
            intensity={lighting.backgroundIntensity + studioLeftFillIntensity * lighting.fillIntensity}
            position={[-clampedSceneRadius * 3, clampedSceneRadius, clampedSceneRadius * 0.5]}
            rotation={[Math.PI / 8, Math.PI / 3, 0]}
            scale={[clampedSceneRadius * 4, clampedSceneRadius * 4, 1]}
          />
          <Lightformer
            form='rect'
            intensity={lighting.backgroundIntensity + studioTopIntensity * lighting.fillIntensity}
            position={[0, clampedSceneRadius * 3, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[clampedSceneRadius * 3, clampedSceneRadius * 3, 1]}
          />
          <Lightformer
            form='rect'
            intensity={lighting.backgroundIntensity + studioGroundIntensity * lighting.fillIntensity}
            position={[clampedSceneRadius * 2, -clampedSceneRadius * 3, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={[clampedSceneRadius * 6, clampedSceneRadius * 6, 1]}
          />
          <Lightformer
            form='rect'
            intensity={lighting.backgroundIntensity + studioBackFillIntensity * lighting.fillIntensity}
            position={[clampedSceneRadius * 2, -clampedSceneRadius * 3, clampedSceneRadius * 4]}
            scale={[clampedSceneRadius * 2, clampedSceneRadius * 2, 1]}
          />
        </>
      </OwnedLightingEnvironment>
    ),
    [
      clampedSceneRadius,
      lighting.backgroundIntensity,
      lighting.fillIntensity,
      lighting.keyIntensity,
      lighting.keySize,
      resolution,
    ],
  );

  return (
    <>
      {/* Low diffuse fill; conductors receive illumination from the environment. */}
      <ambientLight ref={ambientReference} intensity={ambientBaseIntensity} />

      {/* Key direction stays upper-right in view space. */}
      <directionalLight ref={cameraLightReference} intensity={headlampBaseIntensity} color='white' />

      {showEnvironment && lighting.environment === 'jewelry' ? jewelryEnvironment : null}
      {showEnvironment && lighting.environment === 'room' ? roomEnvironment : null}
      {showEnvironment && lighting.environment === 'white' ? whiteEnvironment : null}
      {showEnvironment && lighting.environment === 'studio' ? studioEnvironment : null}
    </>
  );
}

/**
 * Radiance of the tent's dome by height in view space: a soft crown, a darker horizon and a dark floor, so polished
 * walls read darker than the faces that take the light, as in a jeweller's photograph. The soft boxes give the
 * bright reflections; the dome only keeps the shadows from going black.
 */
const jewelryDomeCrown = 0.45;
const jewelryDomeHorizon = 0.24;
const jewelryDomeFloor = 0.09;

/** A dome whose vertex colours carry the crown-to-floor gradient; built once per mount. */
function useJewelryDome(): SphereGeometry {
  const geometry = useMemo(() => {
    const sphere = new SphereGeometry(1, 48, 24);
    const positions = sphere.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index++) {
      const height = positions.getY(index);
      const radiance =
        height >= 0
          ? jewelryDomeHorizon + (jewelryDomeCrown - jewelryDomeHorizon) * Math.sqrt(height)
          : jewelryDomeHorizon + (jewelryDomeFloor - jewelryDomeHorizon) * Math.min(1, -height * 1.6);
      colors.set([radiance, radiance, radiance * 0.98], index * 3);
    }
    sphere.setAttribute('color', new BufferAttribute(colors, 3));
    return sphere;
  }, []);
  useLayoutEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  return geometry;
}

/**
 * A soft box: a diffuser brightest at its centre and falling off towards its edges, so a curved polished surface
 * shows a graded highlight instead of a flat rectangle. Faces the origin, where the model is.
 */
function SoftBox({
  position,
  size,
  intensity,
}: {
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly intensity: number;
}): React.JSX.Element {
  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(1, 1, 12, 12);
    const positions = plane.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index++) {
      const distance = Math.min(1, Math.hypot(positions.getX(index) * 2, positions.getY(index) * 2));
      const radiance = intensity * (0.2 + 0.8 * (1 - distance * distance) ** 1.5);
      colors.set([radiance, radiance, radiance], index * 3);
    }
    plane.setAttribute('color', new BufferAttribute(colors, 3));
    return plane;
  }, [intensity]);
  useLayoutEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  // Facing the origin, computed once rather than through an imperative `lookAt` after mount.
  const quaternion = useMemo(() => {
    const facing = new Object3D();
    facing.position.set(...position);
    facing.lookAt(0, 0, 0);
    return facing.quaternion.clone();
  }, [position]);
  return (
    <mesh
      geometry={geometry}
      position={position as [number, number, number]}
      quaternion={quaternion}
      scale={[size[0], size[1], 1]}
    >
      <meshBasicMaterial vertexColors side={DoubleSide} toneMapped={false} />
    </mesh>
  );
}

/**
 * The jeweller's light tent, authored in view space (+Y up on screen, +Z towards the viewer) because the environment
 * turns with the camera: a broad soft box overhead that top faces mirror, a key soft box front right, a softer fill
 * on the left, two tall strips behind on either side for the long highlights along rims and bars, and a low bounce
 * card that front walls mirror, so they read as metal instead of black.
 */
function JewelryLightTent({ radius }: { readonly radius: number }): React.JSX.Element {
  const dome = useJewelryDome();
  return (
    <>
      <color attach='background' args={[0, 0, 0]} />
      <mesh geometry={dome} scale={radius * 20}>
        <meshBasicMaterial vertexColors side={BackSide} toneMapped={false} />
      </mesh>
      <SoftBox position={[0, radius * 4, -radius * 2.5]} size={[radius * 7, radius * 4]} intensity={1} />
      <SoftBox position={[radius * 3, radius * 1.5, radius * 3]} size={[radius * 3.5, radius * 3.5]} intensity={1.8} />
      <SoftBox position={[-radius * 4, radius * 0.8, radius * 1.5]} size={[radius * 3, radius * 4]} intensity={1} />
      <SoftBox position={[0, -radius * 3.5, radius * 2]} size={[radius * 9, radius * 3]} intensity={1} />
      <Lightformer
        form='rect'
        intensity={3.5}
        position={[-radius * 5, radius * 0.5, -radius * 2]}
        scale={[radius * 0.6, radius * 7, 1]}
      />
      <Lightformer
        form='rect'
        intensity={3.5}
        position={[radius * 5, radius * 0.5, -radius * 2]}
        scale={[radius * 0.6, radius * 7, 1]}
      />
    </>
  );
}

/** Three.js's neutral room is a reproducible reference environment, owned by this mount. */
function RoomLightingEnvironment({ resolution }: { readonly resolution: number }): React.JSX.Element {
  const room = useMemo(() => new RoomEnvironment(), []);
  useLayoutEffect(
    () => () => {
      room.dispose();
    },
    [room],
  );
  return (
    <OwnedLightingEnvironment resolution={resolution} near={0.01} far={100}>
      <primitive object={room} />
    </OwnedLightingEnvironment>
  );
}

/** Own the filtered target while Drei owns the unchanged source cubemap capture. */
function OwnedLightingEnvironment({
  children,
  resolution,
  near,
  far,
}: {
  readonly children: React.ReactNode;
  readonly resolution: number;
  readonly near: number;
  readonly far: number;
}): React.JSX.Element {
  const { scene, gl, invalidate } = useThree();
  useLayoutEffect(() => {
    // The child Environment's layout effect has captured and installed its cubemap.
    // Supplying the finished PMREM bypasses Three's implicit, unowned texture cache.
    const source = scene.environment;
    if (!(source instanceof CubeTexture)) {
      return undefined;
    }
    // A generator keeps a ping-pong target as large as its output until disposed, and is only
    // needed while filtering: each capture gets its own and releases it immediately.
    const generator = isViewportWebGpu(gl) ? new WebGpuPmremGenerator(gl) : new PMREMGenerator(gl);
    let filtered: ReturnType<typeof generator.fromCubemap>;
    try {
      filtered = generator.fromCubemap(source);
    } finally {
      generator.dispose();
    }
    // oxlint-disable-next-line react/immutability -- This effect owns the external Three scene's filtered environment and restores it on cleanup.
    scene.environment = filtered.texture;
    invalidate();
    return () => {
      if (scene.environment === filtered.texture) {
        scene.environment = source;
      }
      filtered.dispose();
    };
  }, [gl, invalidate, scene]);

  return (
    <Environment resolution={resolution} near={near} far={far}>
      {children}
    </Environment>
  );
}
