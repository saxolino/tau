import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import type { Group } from 'three';
import { toRenderPoint } from '@taucad/spatial';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { useGraphics, useRenderFrame, useRenderFrameRetarget } from '#hooks/use-graphics.jsx';
import { useViewportGizmoInteractionLock } from '#graphics/three/controls/viewport-gizmo-interaction-lock.jsx';
import { sectionAxisColors } from '#graphics/three/controls/section-handles.js';
import { SceneOverlay } from '#graphics/three/scene-overlay.jsx';
import { sceneTag, sceneTagData } from '#graphics/three/utils/scene-tags.js';
import { beginPlanarFaceGesture, planarFacePixelScale } from '#graphics/three/react/planar-face-gesture.js';
import type { PlanarFaceTool } from '#graphics/three/react/planar-face-tool.js';

const escapeKey = { key: 'Escape' };
const handleTag = sceneTagData(sceneTag.sectionViewHelper);
const yAxis = new Vector3(0, 1, 0);

/**
 * The normal-arrow preview is transient; the host alone authorizes a native operation.
 * @internal
 * @returns The selected face normal handle, or no handle without a selection.
 */
export function PlanarFaceControls({
  tool,
  artifactKey,
}: Readonly<{ tool: PlanarFaceTool; artifactKey: string }>): React.JSX.Element | undefined {
  const { selection } = tool;
  const graphics = useGraphics();
  const renderFrame = useRenderFrame();
  const lock = useViewportGizmoInteractionLock();
  const get = useThree((state) => state.get);
  const arrow = useRef<Group>(null);
  const previewDistance = useRef(0);
  const frameVectors = useMemo(() => ({ point: new Vector3(), rendered: new Vector3() }), []);
  const active = useRef<ReturnType<typeof beginPlanarFaceGesture> | undefined>(undefined);
  const normal = useMemo(() => new Vector3(...(selection?.normal ?? [0, 0, 1])).normalize(), [selection?.normal]);
  const rotation = useMemo(() => new Quaternion().setFromUnitVectors(yAxis, normal), [normal]);
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
  useFrame(({ camera, size }) => {
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
      const anchor = new Vector3(...toRenderPoint({ renderFrame, point: selection.anchor }));
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
          previewDistance.current = distance;
          captured.onPreview(distance);
          invalidate();
        },
        onCommit: captured.onCommit,
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
    <SceneOverlay overlayActive shouldClearDepth>
      <group ref={arrow} quaternion={rotation} userData={handleTag} onPointerDown={press}>
        <mesh position={[0, 0.35, 0]} renderOrder={1000}>
          <cylinderGeometry args={[0.025, 0.025, 0.7, 12]} />
          <meshBasicMaterial color={sectionAxisColors.z} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.85, 0]} renderOrder={1000}>
          <coneGeometry args={[0.1, 0.3, 16]} />
          <meshBasicMaterial color={sectionAxisColors.z} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 1.2, 12]} />
          <meshBasicMaterial transparent opacity={0} colorWrite={false} depthTest={false} depthWrite={false} />
        </mesh>
      </group>
    </SceneOverlay>
  );
}
