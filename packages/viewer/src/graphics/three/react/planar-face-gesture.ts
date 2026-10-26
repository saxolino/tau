import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Camera } from 'three';
import { setRaycasterFromCamera } from '#graphics/three/utils/raycaster-from-camera.js';
import { createRafCoalescer } from '#graphics/three/utils/raf-coalescer.js';

type PointerPoint = Readonly<{ clientX: number; clientY: number }>;

// Each viewport frame runs synchronously; these temporaries never escape a scale calculation.
const pixelProjected = new Vector3();
const pixelFirst = new Vector3();
const pixelNext = new Vector3();

/**
 * Screen-derived world units per CSS pixel at the supplied render-space anchor.
 * @internal
 * @param camera - Active viewport camera.
 * @param anchor - Render-space anchor.
 * @param height - Viewport CSS pixel height.
 * @returns Render units per CSS pixel at the anchor.
 */
export function planarFacePixelScale(camera: Camera, anchor: Vector3, height: number): number {
  const projected = pixelProjected.copy(anchor).project(camera);
  const first = pixelFirst.set(0, 0, projected.z).unproject(camera);
  const next = pixelNext.set(0, 2 / Math.max(height, 1), projected.z).unproject(camera);
  return first.distanceTo(next);
}

/**
 * Exact ray/axis-plane displacement; a view-parallel axis uses vertical screen motion.
 * @internal
 * @returns Signed model metres, or no result when the pointer ray misses the plane.
 */
export function planarFaceDragDistance({
  camera,
  anchor,
  normal,
  rect,
  start,
  current,
  metersPerRenderUnit,
}: Readonly<{
  camera: Camera;
  anchor: Vector3;
  normal: Vector3;
  rect: Readonly<{ left: number; top: number; width: number; height: number }>;
  start: PointerPoint;
  current: PointerPoint;
  metersPerRenderUnit: number;
}>): number | undefined {
  const direction = normal.clone().normalize();
  const view = camera.getWorldDirection(new Vector3());
  const planeNormal = view.addScaledVector(direction, -view.dot(direction));
  if (planeNormal.lengthSq() < 1e-6) {
    return (start.clientY - current.clientY) * planarFacePixelScale(camera, anchor, rect.height) * metersPerRenderUnit;
  }
  const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal.normalize(), anchor);
  const raycaster = new Raycaster();
  const hit = (point: PointerPoint): Vector3 | undefined => {
    setRaycasterFromCamera(
      raycaster,
      new Vector2(
        ((point.clientX - rect.left) / rect.width) * 2 - 1,
        -((point.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    return raycaster.ray.intersectPlane(plane, new Vector3()) ?? undefined;
  };
  const before = hit(start);
  const after = hit(current);
  return before && after ? after.sub(before).dot(direction) * metersPerRenderUnit : undefined;
}

/**
 * One captured normal-arrow gesture; all exit paths release the same resources.
 * @internal
 * @param options - Captured geometry, callbacks, controls and pointer ownership.
 * @returns Idempotent cancellation for Escape, stale geometry and unmount.
 */
export function beginPlanarFaceGesture(
  options: Readonly<{
    element: HTMLElement;
    canvas: HTMLElement;
    camera: Camera;
    anchor: Vector3;
    normal: Vector3;
    pointerId: number;
    start: PointerPoint;
    metersPerRenderUnit: number;
    controls: { enabled: boolean } | undefined;
    acquire: () => () => void;
    onPreview: (distance: number) => void;
    onCommit: (distance: number) => void;
    onCancel: () => void;
    onFinish: () => void;
  }>,
): { cancel: () => void } {
  const { element, pointerId, controls } = options;
  const owner = element.ownerDocument;
  const previousControls = controls?.enabled;
  const previousCursor = element.style.cursor;
  const release = options.acquire();
  let finished = false;
  let moved = false;
  let distance = 0;
  let latest: PointerPoint | undefined;
  if (controls) {
    controls.enabled = false;
  }
  element.style.cursor = 'ns-resize';
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* Document listeners still complete the gesture. */
  }
  const preview = (point: PointerPoint): void => {
    latest = undefined;
    const result = planarFaceDragDistance({ ...options, rect: options.canvas.getBoundingClientRect(), current: point });
    if (result === undefined || !Number.isFinite(result)) {
      return;
    }
    distance = result;
    options.onPreview(distance);
  };
  const frames = createRafCoalescer(preview);
  const finish = (shouldCommit: boolean): void => {
    if (finished) {
      return;
    }
    finished = true;
    frames.cancel();
    if (shouldCommit && latest) {
      preview(latest);
    }
    owner.removeEventListener('pointermove', move);
    owner.removeEventListener('pointerup', up);
    owner.removeEventListener('pointercancel', cancelPointer);
    owner.removeEventListener('visibilitychange', visibility);
    element.removeEventListener('lostpointercapture', cancelPointer);
    owner.defaultView?.removeEventListener('blur', cancel);
    try {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      /* Capture may already have ended. */
    }
    if (controls && previousControls !== undefined) {
      controls.enabled = previousControls;
    }
    element.style.cursor = previousCursor;
    release();
    options.onFinish();
    if (shouldCommit) {
      if (moved && Math.abs(distance) > 1e-9) {
        options.onCommit(distance);
      }
    } else {
      options.onPreview(0);
      options.onCancel();
    }
  };
  function cancel(): void {
    finish(false);
  }
  function move(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    if (event.buttons % 2 === 0) {
      cancel();
      return;
    }
    if (Math.hypot(event.clientX - options.start.clientX, event.clientY - options.start.clientY) < 3 && !moved) {
      return;
    }
    moved = true;
    latest = { clientX: event.clientX, clientY: event.clientY };
    frames.schedule(latest);
  }
  function up(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    if (moved || Math.hypot(event.clientX - options.start.clientX, event.clientY - options.start.clientY) >= 3) {
      moved = true;
      latest = { clientX: event.clientX, clientY: event.clientY };
    }
    finish(true);
  }
  function cancelPointer(event: PointerEvent): void {
    if (event.pointerId === pointerId) {
      cancel();
    }
  }
  function visibility(): void {
    if (owner.visibilityState === 'hidden') {
      cancel();
    }
  }
  owner.addEventListener('pointermove', move);
  owner.addEventListener('pointerup', up);
  owner.addEventListener('pointercancel', cancelPointer);
  owner.addEventListener('visibilitychange', visibility);
  element.addEventListener('lostpointercapture', cancelPointer);
  owner.defaultView?.addEventListener('blur', cancel);
  return { cancel };
}
