import { useThreeGraphicsBackend } from '#graphics/three/three-graphics-backend-context.jsx';
import {
  createGltfFatLineMaterial,
  createGltfFatLineSegmentsFromPositions,
} from '#graphics/three/materials/gltf-edges.js';
import { manualHandleColor, manualSelectionColor } from '#graphics/three/overlay-colors.constants.js';
import { edgeTubeGeometry } from '#graphics/three/react/manual-preview-geometry.js';
import { useSectionClip } from '#graphics/three/react/section-clipping-group.jsx';
import { installSectionClip } from '#graphics/three/materials/section-clip.js';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Mesh, MeshBasicMaterial, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import type { Group, Object3D } from 'three';
import { toRenderPoint } from '@taucad/spatial';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { useGraphics, useRenderFrame, useRenderFrameRetarget } from '#hooks/use-graphics.jsx';
import { useViewportGizmoInteractionLock } from '#graphics/three/controls/viewport-gizmo-interaction-lock.jsx';
import { sectionAxisColors } from '#graphics/three/controls/section-handles.js';
import { SceneOverlay } from '#graphics/three/scene-overlay.jsx';
import { sceneTag, sceneTagData } from '#graphics/three/utils/scene-tags.js';
import { beginPlanarFaceGesture, planarFacePixelScale } from '#graphics/three/react/planar-face-gesture.js';
import {
  createDirectEditGhost,
  directEditEdgeGeometry,
  directEditEdges,
  directEditPreviewMatrix,
} from '#graphics/three/react/direct-edit-geometry.js';
import { setRaycasterFromCamera } from '#graphics/three/utils/raycaster-from-camera.js';
import type { DirectEditChange, DirectEditTool } from '#graphics/three/react/direct-edit-tool.js';

const escapeKey = { key: 'Escape' };
const handleTag = sceneTagData(sceneTag.sectionViewHelper);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const axes = [
  { id: 'x', vector: new Vector3(1, 0, 0), color: sectionAxisColors.x },
  { id: 'y', vector: new Vector3(0, 1, 0), color: sectionAxisColors.y },
  { id: 'z', vector: new Vector3(0, 0, 1), color: sectionAxisColors.z },
] as const;

type DirectEditControlsState = {
  selection: DirectEditTool['selection'];
  mode: DirectEditTool['mode'];
  ghost: ReturnType<typeof createDirectEditGhost> | undefined;
  edgeOverlay:
    | {
        line: ReturnType<typeof createGltfFatLineSegmentsFromPositions>;
        material: ReturnType<typeof createGltfFatLineMaterial>;
      }
    | undefined;
  /** The fillet or chamfer reach around the selected edges, while the host previews a size. */
  edgeGhost: Mesh | undefined;
  // oxlint-disable-next-line @typescript-eslint/no-restricted-types -- React's scene ref is null before mount.
  handles: React.RefObject<Group | null>;
  press: (event: ThreeEvent<PointerEvent>, axis: Vector3) => void;
};

/** Own one native handle gesture and its transient render resources. @internal */
export function useDirectEditControls({
  tool,
  artifactKey,
  scene,
}: Readonly<{ tool: DirectEditTool; artifactKey: string; scene: Object3D }>): DirectEditControlsState {
  const { selection, mode } = tool;
  const graphics = useGraphics();
  const backend = useThreeGraphicsBackend();
  const clipping = useSectionClip();
  const renderFrame = useRenderFrame();
  const lock = useViewportGizmoInteractionLock();
  const get = useThree((state) => state.get);
  const handles = useRef<Group>(null);
  const active = useRef<ReturnType<typeof beginPlanarFaceGesture> | undefined>(undefined);
  const preview = useRef<DirectEditChange | undefined>(undefined);
  const ghost = useMemo(
    () => (selection ? createDirectEditGhost(scene, selection.componentId) : undefined),
    [scene, selection?.componentId, artifactKey, renderFrame],
  );
  const edgeGeometry = useMemo(
    () =>
      selection?.edgeIds?.length
        ? directEditEdgeGeometry(directEditEdges(scene), selection.componentId, selection.edgeIds)
        : undefined,
    [scene, selection?.componentId, selection?.edgeIds, artifactKey, renderFrame],
  );
  const edgeOverlay = useMemo(() => {
    if (!edgeGeometry) {
      return undefined;
    }
    const material = createGltfFatLineMaterial({
      backend,
      resolution: new Vector2(1, 1),
      edgeColor: manualHandleColor,
    });
    material.linewidth = 4;
    material.depthTest = true;
    material.depthWrite = false;
    material.toneMapped = false;
    if ('edgePresentationLineWidth' in material) {
      material.edgePresentationLineWidth = 3;
    }
    const line = createGltfFatLineSegmentsFromPositions({
      backend,
      positions: new Float32Array(edgeGeometry.getAttribute('position').array),
      material,
    });
    return { line, material };
  }, [edgeGeometry, backend]);
  useEffect(
    () => () => {
      edgeOverlay?.line?.geometry.dispose();
      edgeOverlay?.material.dispose();
    },
    [edgeOverlay],
  );
  const { edgeSize } = tool;
  const edgeGhost = useMemo(() => {
    if (!edgeGeometry || edgeSize === undefined || !(edgeSize > 0)) {
      return undefined;
    }
    const geometry = edgeTubeGeometry(
      edgeGeometry.getAttribute('position').array,
      edgeSize / renderFrame.metersPerRenderUnit,
    );
    if (!geometry) {
      return undefined;
    }
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: manualSelectionColor,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.raycast = () => undefined;
    mesh.renderOrder = 901;
    return mesh;
  }, [edgeGeometry, edgeSize, renderFrame]);
  useEffect(
    () => () => {
      edgeGhost?.geometry.dispose();
      edgeGhost?.material.dispose();
    },
    [edgeGhost],
  );
  useEffect(() => {
    if (ghost) {
      installSectionClip(ghost.material, clipping);
    }
    if (edgeOverlay) {
      installSectionClip(edgeOverlay.material, clipping);
    }
    if (edgeGhost) {
      installSectionClip(edgeGhost.material, clipping);
    }
  }, [ghost, edgeOverlay, edgeGhost, clipping]);
  const cancel = useCallback(() => active.current?.cancel(), []);
  useRenderFrameRetarget(cancel);
  useKeybinding(escapeKey, cancel, { enabled: () => active.current !== undefined, priority: 2, scope: 'global' });
  useEffect(() => {
    preview.current = undefined;
    get().invalidate();
    return cancel;
  }, [
    artifactKey,
    cancel,
    get,
    renderFrame,
    selection?.revision,
    selection?.componentId,
    selection?.pivot[0],
    selection?.pivot[1],
    selection?.pivot[2],
    mode,
  ]);
  useEffect(() => () => ghost?.dispose(), [ghost]);
  useEffect(() => () => edgeGeometry?.dispose(), [edgeGeometry]);
  useFrame(({ camera, size }) => {
    if (
      edgeOverlay &&
      'resolution' in edgeOverlay.material &&
      (edgeOverlay.material.resolution.x !== size.width || edgeOverlay.material.resolution.y !== size.height)
    ) {
      edgeOverlay.material.resolution.set(size.width, size.height);
    }
    if (!selection || !handles.current) {
      return;
    }
    const point = new Vector3(...toRenderPoint({ renderFrame, point: selection.pivot }));
    const { current } = preview;
    if (current?.type === 'translate') {
      point.add(new Vector3(...current.delta).divideScalar(renderFrame.metersPerRenderUnit));
    }
    const scale = planarFacePixelScale(camera, point, size.height) * 80;
    if (!handles.current.position.equals(point) || handles.current.scale.x !== scale) {
      handles.current.position.copy(point);
      handles.current.scale.setScalar(scale);
      handles.current.updateMatrixWorld(true);
    }
  });
  const press = useCallback(
    (event: ThreeEvent<PointerEvent>, axis: Vector3): void => {
      if (
        !selection ||
        lock.isActive() ||
        graphics.getSnapshot().context.modelPointerClickSuppressionReasons.length > 0 ||
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
      const anchor = new Vector3(...toRenderPoint({ renderFrame, point: selection.pivot }));
      const start = { clientX: event.nativeEvent.clientX, clientY: event.nativeEvent.clientY };
      const captured = tool;
      const plane = new Plane().setFromNormalAndCoplanarPoint(axis, anchor);
      const radial = (point: Readonly<{ clientX: number; clientY: number }>): Vector3 | undefined => {
        const rect = gl.domElement.getBoundingClientRect();
        const raycaster = new Raycaster();
        setRaycasterFromCamera(
          raycaster,
          new Vector2(
            ((point.clientX - rect.left) / rect.width) * 2 - 1,
            (-(point.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        return raycaster.ray.intersectPlane(plane, new Vector3())?.sub(anchor).normalize();
      };
      const initial = radial(start);
      const change = (value: number): DirectEditChange => {
        if (mode === 'rotate') {
          return { type: 'rotate', axis: [axis.x, axis.y, axis.z], origin: selection.pivot, angleRadians: value };
        }
        if (mode === 'scale') {
          return { type: 'scale', origin: selection.pivot, factor: Math.exp(Math.max(-6, Math.min(6, value))) };
        }
        return { type: 'translate', delta: [axis.x * value, axis.y * value, axis.z * value] };
      };
      active.current = beginPlanarFaceGesture({
        element: owner,
        canvas: gl.domElement,
        camera,
        anchor,
        normal: axis,
        pointerId: event.nativeEvent.pointerId,
        start,
        metersPerRenderUnit: renderFrame.metersPerRenderUnit,
        controls: cameraControls,
        sampleDistance:
          mode === 'translate'
            ? undefined
            : (point) => {
                if (mode === 'scale') {
                  return (start.clientY - point.clientY) / 100;
                }
                const current = radial(point);
                if (!initial || !current || Math.abs(camera.getWorldDirection(new Vector3()).dot(axis)) < 0.05) {
                  return (point.clientX - start.clientX + start.clientY - point.clientY) / 80;
                }
                return Math.atan2(axis.dot(new Vector3().crossVectors(initial, current)), initial.dot(current));
              },
        acquire: () => {
          const releaseLock = lock.begin('direct-edit');
          graphics.send({ type: 'beginViewerModelHoverSuppression', reason: 'toolOverlay', source: 'viewer' });
          return () => {
            graphics.send({ type: 'endViewerModelHoverSuppression', reason: 'toolOverlay', source: 'viewer' });
            graphics.send({ type: 'markModelPointerGestureMoved' });
            releaseLock();
          };
        },
        onPreview: (value) => {
          const next = change(value);
          preview.current = next;
          if (ghost) {
            ghost.group.visible = true;
            ghost.group.matrix.copy(directEditPreviewMatrix(next, renderFrame));
            ghost.group.updateMatrixWorld(true);
          }
          captured.onPreview(next);
          invalidate();
        },
        onCommit: (value) => {
          captured.onCommit(change(value));
        },
        onCancel: () => {
          preview.current = undefined;
          if (ghost) {
            ghost.group.visible = false;
          }
          captured.onCancel();
          invalidate();
        },
        onFinish: () => {
          active.current = undefined;
          preview.current = undefined;
          if (ghost) {
            ghost.group.visible = false;
          }
          invalidate();
        },
      });
    },
    [selection, lock, graphics, get, renderFrame, tool, mode, ghost],
  );
  return { selection, mode, ghost, edgeOverlay, edgeGhost, handles, press };
}

/** Native handle gestures and borrowed-geometry previews with independent ownership. @internal */
export const DirectEditControls = memo(function DirectEditControls(
  props: Readonly<{ tool: DirectEditTool; artifactKey: string; scene: Object3D }>,
): React.JSX.Element | undefined {
  const { selection, mode, ghost, edgeOverlay, edgeGhost, handles, press } = useDirectEditControls(props);
  if (!selection) {
    return undefined;
  }
  const isTransform = mode === 'translate' || mode === 'rotate' || mode === 'scale';
  return (
    <>
      {ghost ? <primitive object={ghost.group} /> : null}
      {edgeOverlay?.line !== undefined || edgeGhost !== undefined ? (
        <SceneOverlay overlayActive>
          {edgeGhost ? <primitive object={edgeGhost} /> : null}
          {edgeOverlay?.line ? <primitive object={edgeOverlay.line} /> : null}
        </SceneOverlay>
      ) : null}
      {isTransform ? (
        <SceneOverlay overlayActive shouldClearDepth>
          <group ref={handles} userData={handleTag}>
            {mode === 'scale' ? (
              <mesh
                onPointerDown={(event) => {
                  press(event, yAxis);
                }}
              >
                <boxGeometry args={[0.25, 0.25, 0.25]} />
                <meshBasicMaterial
                  color={sectionAxisColors.z}
                  depthTest={false}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            ) : (
              axes.map(({ id, vector, color }) => (
                <group
                  key={id}
                  quaternion={new Quaternion().setFromUnitVectors(mode === 'rotate' ? zAxis : yAxis, vector)}
                  onPointerDown={(event) => {
                    press(event, vector);
                  }}
                >
                  {mode === 'rotate' ? (
                    <mesh>
                      <torusGeometry args={[0.85, 0.035, 8, 80]} />
                      <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
                    </mesh>
                  ) : (
                    <>
                      <mesh position={[0, 0.4, 0]}>
                        <cylinderGeometry args={[0.025, 0.025, 0.8, 12]} />
                        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
                      </mesh>
                      <mesh position={[0, 0.95, 0]}>
                        <coneGeometry args={[0.09, 0.3, 16]} />
                        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
                      </mesh>
                      <mesh position={[0, 0.6, 0]}>
                        <cylinderGeometry args={[0.12, 0.12, 1, 12]} />
                        <meshBasicMaterial
                          transparent
                          opacity={0}
                          colorWrite={false}
                          depthTest={false}
                          depthWrite={false}
                        />
                      </mesh>
                    </>
                  )}
                </group>
              ))
            )}
          </group>
        </SceneOverlay>
      ) : null}
    </>
  );
});
