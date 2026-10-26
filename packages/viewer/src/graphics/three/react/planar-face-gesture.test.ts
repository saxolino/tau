import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { beginPlanarFaceGesture, planarFaceDragDistance } from '#graphics/three/react/planar-face-gesture.js';

const rect = { left: 0, top: 0, width: 200, height: 200 };
const createCamera = () => {
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
};
const pointer = (
  type: string,
  x: number,
  { y = 100, pointerId = 7 }: Readonly<{ y?: number; pointerId?: number }> = {},
) => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
};
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
    frames = [];
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const harness = (wasEnabled = true) => {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => DOMRect.fromRect(rect);
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = vi.fn(() => true);
  element.releasePointerCapture = vi.fn();
  document.body.append(element);
  const release = vi.fn();
  const controls = { enabled: wasEnabled };
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onFinish = vi.fn();
  const gesture = beginPlanarFaceGesture({
    element,
    canvas: element,
    camera: createCamera(),
    anchor: new Vector3(),
    normal: new Vector3(1, 0, 0),
    pointerId: 7,
    start: { clientX: 100, clientY: 100 },
    metersPerRenderUnit: 0.001,
    controls,
    acquire: () => release,
    onPreview,
    onCommit,
    onCancel,
    onFinish,
  });
  return { gesture, element, release, controls, onPreview, onCommit, onCancel, onFinish };
};

describe('normal arrow distance', () => {
  it('maps orthographic displacement into signed model metres and ignores transverse motion', () => {
    const input = {
      camera: createCamera(),
      anchor: new Vector3(),
      normal: new Vector3(1, 0, 0),
      rect,
      start: { clientX: 100, clientY: 100 },
      metersPerRenderUnit: 0.001,
    };
    expect(planarFaceDragDistance({ ...input, current: { clientX: 150, clientY: 30 } })).toBeCloseTo(0.005);
    expect(planarFaceDragDistance({ ...input, current: { clientX: 50, clientY: 170 } })).toBeCloseTo(-0.005);
  });
  it('handles perspective camera and a nonzero rendered anchor', () => {
    const camera = new PerspectiveCamera(90, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(
      planarFaceDragDistance({
        camera,
        anchor: new Vector3(1, 0, 0),
        normal: new Vector3(1, 0, 0),
        rect,
        start: { clientX: 110, clientY: 100 },
        current: { clientX: 160, clientY: 100 },
        metersPerRenderUnit: 1,
      }),
    ).toBeCloseTo(5);
  });
  it('keeps the end-on normal usable with signed vertical motion', () => {
    expect(
      planarFaceDragDistance({
        camera: createCamera(),
        anchor: new Vector3(),
        normal: new Vector3(0, 0, 1),
        rect,
        start: { clientX: 100, clientY: 100 },
        current: { clientX: 100, clientY: 50 },
        metersPerRenderUnit: 0.001,
      }),
    ).toBeCloseTo(0.005);
  });
});

describe('normal arrow gesture ownership', () => {
  it('previews without committing, then flushes the last move and commits exactly once', () => {
    const state = harness();
    expect(state.controls.enabled).toBe(false);
    document.dispatchEvent(pointer('pointermove', 130));
    expect(state.onCommit).not.toHaveBeenCalled();
    document.dispatchEvent(pointer('pointerup', 130));
    expect(state.onPreview).toHaveBeenLastCalledWith(expect.closeTo(0.003));
    expect(state.onCommit).toHaveBeenCalledExactlyOnceWith(expect.closeTo(0.003));
    expect(state.controls.enabled).toBe(true);
    expect(state.release).toHaveBeenCalledOnce();
    document.dispatchEvent(pointer('pointerup', 130));
    expect(state.onCommit).toHaveBeenCalledOnce();
  });
  it('samples the release endpoint after a different pending move', () => {
    const state = harness();
    document.dispatchEvent(pointer('pointermove', 130));
    document.dispatchEvent(pointer('pointerup', 150));
    expect(state.onCommit).toHaveBeenCalledExactlyOnceWith(expect.closeTo(0.005));
    expect(state.onPreview).toHaveBeenLastCalledWith(expect.closeTo(0.005));
  });
  it('samples a moved release when the browser delivered no intermediate move', () => {
    const state = harness();
    document.dispatchEvent(pointer('pointerup', 150));
    expect(state.onCommit).toHaveBeenCalledExactlyOnceWith(expect.closeTo(0.005));
  });
  it('keeps a subthreshold release as a click without a write', () => {
    const state = harness();
    document.dispatchEvent(pointer('pointerup', 102));
    expect(state.onCommit).not.toHaveBeenCalled();
    expect(state.onPreview).not.toHaveBeenCalled();
    expect(state.release).toHaveBeenCalledOnce();
  });
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'explicit'] as const)(
    'cancels %s with no commit and restores a disabled camera exactly',
    (reason) => {
      const state = harness(false);
      document.dispatchEvent(pointer('pointermove', 150));
      for (const frame of frames.splice(0)) {
        frame(0);
      }
      if (reason === 'explicit') {
        state.gesture.cancel();
      } else if (reason === 'blur') {
        globalThis.dispatchEvent(new Event('blur'));
      } else {
        (reason === 'lostpointercapture' ? state.element : document).dispatchEvent(pointer(reason, 150));
      }
      expect(state.onCommit).not.toHaveBeenCalled();
      expect(state.onCancel).toHaveBeenCalledOnce();
      expect(state.onPreview).toHaveBeenLastCalledWith(0);
      expect(state.controls.enabled).toBe(false);
      expect(state.release).toHaveBeenCalledOnce();
      state.gesture.cancel();
      expect(state.release).toHaveBeenCalledOnce();
    },
  );
  it('does not commit a click or another pointer release', () => {
    const state = harness();
    document.dispatchEvent(pointer('pointerup', 150, { pointerId: 9 }));
    expect(state.release).not.toHaveBeenCalled();
    document.dispatchEvent(pointer('pointerup', 100));
    expect(state.onCommit).not.toHaveBeenCalled();
    expect(state.release).toHaveBeenCalledOnce();
  });
});
