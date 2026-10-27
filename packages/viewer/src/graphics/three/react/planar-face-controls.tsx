import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { DoubleSide, Mesh, MeshBasicMaterial, Quaternion, Vector2, Vector3 } from 'three';
import type { Group, Object3D } from 'three';
import { toRenderPoint } from '@taucad/spatial';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { useGraphics, useRenderFrame, useRenderFrameRetarget } from '#hooks/use-graphics.jsx';
import { useViewportGizmoInteractionLock } from '#graphics/three/controls/viewport-gizmo-interaction-lock.jsx';
import { manualHandleColor, manualSelectionColor } from '#graphics/three/overlay-colors.constants.js';
import { useSectionClip } from '#graphics/three/react/section-clipping-group.jsx';
import { installSectionClip } from '#graphics/three/materials/section-clip.js';
import { useThreeGraphicsBackend } from '#graphics/three/three-graphics-backend-context.jsx';
import {
  createGltfFatLineMaterial,
  createGltfFatLineSegmentsFromPositions,
} from '#graphics/three/materials/gltf-edges.js';
import {
  faceOutlinePositions,
  facePrismGeometry,
  faceVeilGeometry,
  holeGeometry,
  planarFaceTriangles,
  prismScaleMatrix,
} from '#graphics/three/react/manual-preview-geometry.js';
import { SceneOverlay } from '#graphics/three/scene-overlay.jsx';
import { sceneTag, sceneTagData } from '#graphics/three/utils/scene-tags.js';
import { beginPlanarFaceGesture, planarFacePixelScale } from '#graphics/three/react/planar-face-gesture.js';
import type { PlanarFaceTool } from '#graphics/three/react/planar-face-tool.js';

const escapeKey = { key: 'Escape' };
const handleTag = sceneTagData(sceneTag.sectionViewHelper);
const yAxis = new Vector3(0, 1, 0);

/**
 * The titanio veil on the selected face, the ghost of the extrusion it would make (a prism of the held or dragged
 * distance) and the ghost of a hole drilled from it. Transient render resources only; the host alone commits.
 * @internal
 */
function useFacePreview({
  tool,
  scene,
  artifactKey,
  normal,
}: Readonly<{ tool: PlanarFaceTool; scene: Object3D | undefined; artifactKey: string; normal: Vector3 }>): Readonly<{
  veil: Mesh | undefined;
  outline: Object3D | undefined;
  prism: Mesh | undefined;
  hole: Mesh | undefined;
  setPrismDistance: (metres: number) => void;
  setOutlineResolution: (width: number, height: number) => void;
}> {
  const { selection, hole: holePreview } = tool;
  const renderFrame = useRenderFrame();
  const clipping = useSectionClip();
  const backend = useThreeGraphicsBackend();
  const triangles = useMemo(
    () => (selection && scene ? planarFaceTriangles(scene, selection.componentId, selection.faceId) : undefined),
    // The artifact key and render frame change the scene's placement; the selection names the face.
    [scene, selection?.componentId, selection?.faceId, artifactKey, renderFrame],
  );
  const veil = useMemo(() => {
    if (!triangles) {
      return undefined;
    }
    const material = new MeshBasicMaterial({
      color: manualSelectionColor,
      transparent: true,
      opacity: 0.45,
      side: DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    const mesh = new Mesh(faceVeilGeometry(triangles), material);
    mesh.raycast = () => undefined;
    mesh.renderOrder = 900;
    return mesh;
  }, [triangles]);
  const outline = useMemo(() => {
    if (!triangles) {
      return undefined;
    }
    const material = createGltfFatLineMaterial({
      backend,
      resolution: new Vector2(1, 1),
      edgeColor: manualHandleColor,
    });
    material.linewidth = 3;
    material.depthTest = true;
    material.depthWrite = false;
    material.toneMapped = false;
    if ('edgePresentationLineWidth' in material) {
      material.edgePresentationLineWidth = 2.5;
    }
    const line = createGltfFatLineSegmentsFromPositions({
      backend,
      positions: faceOutlinePositions(triangles),
      material,
    });
    if (!line) {
      material.dispose();
      return undefined;
    }
    return { line, material };
  }, [triangles, backend]);
  useEffect(
    () => () => {
      outline?.line.geometry.dispose();
      outline?.material.dispose();
    },
    [outline],
  );
  const setOutlineResolution = useCallback(
    (width: number, height: number) => {
      const material = outline?.material;
      if (
        material &&
        'resolution' in material &&
        (material.resolution.x !== width || material.resolution.y !== height)
      ) {
        material.resolution.set(width, height);
      }
    },
    [outline],
  );
  const prism = useMemo(() => {
    if (!triangles) {
      return undefined;
    }
    const material = new MeshBasicMaterial({
      color: manualSelectionColor,
      transparent: true,
      opacity: 0.32,
      side: DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(facePrismGeometry(triangles, normal), material);
    mesh.raycast = () => undefined;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.renderOrder = 901;
    return mesh;
  }, [triangles, normal]);
  const hole = useMemo(() => {
    if (!selection || !holePreview || !(holePreview.radius > 0) || !(holePreview.depth > 0)) {
      return undefined;
    }
    const start = new Vector3(...toRenderPoint({ renderFrame, point: selection.anchor }));
    const geometry = holeGeometry({
      start,
      axis: normal.clone().negate(),
      radius: holePreview.radius / renderFrame.metersPerRenderUnit,
      depth: holePreview.depth / renderFrame.metersPerRenderUnit,
    });
    // The drill runs inside the solid, so it shows through the surfaces that hide it.
    const material = new MeshBasicMaterial({
      color: manualHandleColor,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.raycast = () => undefined;
    mesh.renderOrder = 902;
    return mesh;
  }, [selection, holePreview, normal, renderFrame]);
  useEffect(() => {
    for (const mesh of [veil, prism, hole]) {
      if (mesh) {
        installSectionClip(mesh.material, clipping);
      }
    }
    if (outline) {
      installSectionClip(outline.material, clipping);
    }
  }, [veil, prism, hole, outline, clipping]);
  useEffect(
    () => () => {
      for (const mesh of [veil, prism, hole]) {
        mesh?.geometry.dispose();
        mesh?.material.dispose();
      }
    },
    [veil, prism, hole],
  );
  const origin = useMemo(
    () => new Vector3(...(triangles ? [triangles[0]!, triangles[1]!, triangles[2]!] : [0, 0, 0])),
    [triangles],
  );
  const setPrismDistance = useCallback(
    (metres: number) => {
      if (!prism) {
        return;
      }
      const height = metres / renderFrame.metersPerRenderUnit;
      const visible = Math.abs(metres) > 1e-9;
      prism.visible = visible;
      if (!visible) {
        return;
      }
      const { material } = prism;
      // Added material sits outside the solid; removed material is inside it and shows through as an X-ray.
      const isCut = height < 0;
      if (material.depthTest === isCut) {
        material.depthTest = !isCut;
        material.opacity = isCut ? 0.4 : 0.32;
        material.needsUpdate = true;
      }
      prism.matrix.copy(prismScaleMatrix(origin, normal, height));
      prism.matrixWorldNeedsUpdate = true;
    },
    [prism, renderFrame, origin, normal],
  );
  return { veil, outline: outline?.line, prism, hole, setPrismDistance, setOutlineResolution };
}

/**
 * The normal-arrow preview is transient; the host alone authorizes a native operation.
 * @internal
 * @returns The selected face normal handle, or no handle without a selection.
 */
export function PlanarFaceControls({
  tool,
  artifactKey,
  scene,
}: Readonly<{ tool: PlanarFaceTool; artifactKey: string; scene?: Object3D }>): React.JSX.Element | undefined {
  const { selection } = tool;
  const held = tool.distance ?? 0;
  const graphics = useGraphics();
  const renderFrame = useRenderFrame();
  const lock = useViewportGizmoInteractionLock();
  const get = useThree((state) => state.get);
  const arrow = useRef<Group>(null);
  const previewDistance = useRef(held);
  const frameVectors = useMemo(() => ({ point: new Vector3(), rendered: new Vector3() }), []);
  const active = useRef<ReturnType<typeof beginPlanarFaceGesture> | undefined>(undefined);
  const normal = useMemo(() => new Vector3(...(selection?.normal ?? [0, 0, 1])).normalize(), [selection?.normal]);
  const rotation = useMemo(() => new Quaternion().setFromUnitVectors(yAxis, normal), [normal]);
  const { veil, outline, prism, hole, setPrismDistance, setOutlineResolution } = useFacePreview({
    tool,
    scene,
    artifactKey,
    normal,
  });
  const cancel = useCallback(() => {
    active.current?.cancel();
  }, []);
  useRenderFrameRetarget(cancel);
  useKeybinding(escapeKey, cancel, { enabled: () => active.current !== undefined, priority: 2, scope: 'global' });
  useEffect(() => {
    previewDistance.current = 0;
    get().invalidate();
    return cancel;
  }, [artifactKey, cancel, get, renderFrame, selection?.revision, selection?.componentId, selection?.faceId]);
  // A held distance (typed in the inspector, or left by a released drag) places the arrow and the ghost there.
  useEffect(() => {
    if (active.current === undefined) {
      previewDistance.current = held;
      get().invalidate();
    }
  }, [held, get, selection?.faceId, selection?.revision]);
  useFrame(({ camera, size }) => {
    setPrismDistance(previewDistance.current);
    setOutlineResolution(size.width, size.height);
    if (!selection || !arrow.current) {
      return;
    }
    const point = frameVectors.point.set(...selection.anchor).addScaledVector(normal, previewDistance.current);
    const rendered = frameVectors.rendered.set(...toRenderPoint({ renderFrame, point: [point.x, point.y, point.z] }));
    const scale = planarFacePixelScale(camera, rendered, size.height) * 72;
    if (arrow.current.position.equals(rendered) && arrow.current.scale.x === scale) {
      return;
    }
    arrow.current.position.copy(rendered);
    arrow.current.scale.setScalar(scale);
    arrow.current.updateMatrixWorld(true);
  });
  const press = useCallback(
    (event: ThreeEvent<PointerEvent>): void => {
      if (
        lock.isActive() ||
        graphics.getSnapshot().context.modelPointerClickSuppressionReasons.length > 0 ||
        !selection ||
        active.current !== undefined ||
        event.nativeEvent.button !== 0 ||
        !['mouse', 'pen'].includes(event.nativeEvent.pointerType)
      ) {
        return;
      }
      event.stopPropagation();
      const { controls, camera, gl, events, invalidate } = get();
      const owner = events.connected instanceof HTMLElement ? events.connected : gl.domElement;
      const cameraControls =
        controls && 'enabled' in controls && typeof controls.enabled === 'boolean'
          ? (controls as { enabled: boolean })
          : undefined;
      // A held distance is where the arrow stands; the drag continues from there.
      const base = tool.distance ?? 0;
      const anchor = new Vector3(...toRenderPoint({ renderFrame, point: selection.anchor })).addScaledVector(
        normal,
        base / renderFrame.metersPerRenderUnit,
      );
      const captured = tool;
      active.current = beginPlanarFaceGesture({
        element: owner,
        canvas: gl.domElement,
        camera,
        anchor,
        normal: normal.clone(),
        pointerId: event.nativeEvent.pointerId,
        start: { clientX: event.nativeEvent.clientX, clientY: event.nativeEvent.clientY },
        metersPerRenderUnit: renderFrame.metersPerRenderUnit,
        controls: cameraControls,
        acquire: () => {
          const releaseLock = lock.begin('planar-face');
          graphics.send({ type: 'beginViewerModelHoverSuppression', reason: 'toolOverlay', source: 'viewer' });
          return () => {
            graphics.send({ type: 'endViewerModelHoverSuppression', reason: 'toolOverlay', source: 'viewer' });
            graphics.send({ type: 'markModelPointerGestureMoved' });
            releaseLock();
          };
        },
        onPreview: (distance) => {
          previewDistance.current = base + distance;
          captured.onPreview(base + distance);
          invalidate();
        },
        onCommit: (distance) => {
          captured.onCommit(base + distance);
        },
        onCancel: captured.onCancel,
        onFinish: () => {
          active.current = undefined;
          invalidate();
        },
      });
    },
    [get, graphics, lock, normal, renderFrame, selection, tool],
  );
  if (!selection || normal.lengthSq() < 0.5) {
    return undefined;
  }
  return (
    <>
      <SceneOverlay overlayActive>
        {veil ? <primitive object={veil} /> : null}
        {outline ? <primitive object={outline} /> : null}
        {prism ? <primitive object={prism} /> : null}
        {hole ? <primitive object={hole} /> : null}
      </SceneOverlay>
      {tool.hole ? null : (
        <SceneOverlay overlayActive shouldClearDepth>
          <group ref={arrow} quaternion={rotation} userData={handleTag} onPointerDown={press}>
            <mesh position={[0, 0.35, 0]} renderOrder={1000}>
              <cylinderGeometry args={[0.03, 0.03, 0.7, 12]} />
              <meshBasicMaterial color={manualHandleColor} depthTest={false} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.85, 0]} renderOrder={1000}>
              <coneGeometry args={[0.12, 0.3, 20]} />
              <meshBasicMaterial color={manualHandleColor} depthTest={false} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 1.2, 12]} />
              <meshBasicMaterial transparent opacity={0} colorWrite={false} depthTest={false} depthWrite={false} />
            </mesh>
          </group>
        </SceneOverlay>
      )}
    </>
  );
}
