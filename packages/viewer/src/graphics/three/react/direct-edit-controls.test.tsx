import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, OrthographicCamera, Vector3 } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { DirectEditTool } from '@taucad/viewer/cad/direct-edit-tool';
import { mock } from 'vitest-mock-extended';
import { useDirectEditControls } from '#graphics/three/react/direct-edit-controls.jsx';

const hooks = vi.hoisted(() => ({
  get: vi.fn(),
  send: vi.fn(),
  begin: vi.fn(),
  release: vi.fn(),
  invalidate: vi.fn(),
  frame: { anchorFrameId: 'tau:root', originMeters: [1000, 2000, 3000], metersPerRenderUnit: 0.001 },
  escape: undefined as (() => void) | undefined,
  retarget: undefined as (() => void) | undefined,
}));
vi.mock('@react-three/fiber', () => ({
  useFrame: () => undefined,
  useThree: (selector: (state: { get: typeof hooks.get }) => unknown) => selector({ get: hooks.get }),
}));
vi.mock('@taucad/ui/components/keyboard', () => ({
  useKeybinding: (_binding: unknown, callback: () => void) => {
    hooks.escape = callback;
  },
}));
vi.mock('#hooks/use-graphics.jsx', () => ({
  useGraphics: () => ({
    getSnapshot: () => ({ context: { modelPointerClickSuppressionReasons: [] } }),
    send: hooks.send,
  }),
  useRenderFrame: () => hooks.frame,
  useRenderFrameRetarget: (callback: () => void) => {
    hooks.retarget = callback;
  },
}));
vi.mock('#graphics/three/controls/viewport-gizmo-interaction-lock.jsx', () => ({
  useViewportGizmoInteractionLock: () => ({ isActive: () => false, begin: hooks.begin }),
}));
vi.mock('#graphics/three/react/section-clipping-group.jsx', async () => {
  const { createSectionClip } = await import('#graphics/three/materials/section-clip.js');
  const clip = createSectionClip('webgl');
  return { useSectionClip: () => clip };
});
vi.mock('#graphics/three/scene-overlay.jsx', () => ({ SceneOverlay: () => undefined }));

let frames: FrameRequestCallback[];
let element: HTMLDivElement;
let controls: { enabled: boolean };
const pointer = (type: string, x: number, y = 100): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  return event;
};
beforeEach(() => {
  frames = [];
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
    frames = [];
  });
  element = document.createElement('div');
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 200 });
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = () => true;
  element.releasePointerCapture = vi.fn();
  document.body.append(element);
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  controls = { enabled: true };
  hooks.get.mockReturnValue({
    controls,
    camera,
    gl: { domElement: element },
    events: { connected: element },
    invalidate: hooks.invalidate,
  });
  hooks.begin.mockReturnValue(hooks.release);
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function harness(mode: DirectEditTool['mode'] = 'translate') {
  const tool: DirectEditTool = {
    mode,
    selection: { componentId: 'body', pivot: [1000, 2000, 3000], revision: 'r1' },
    onPick: vi.fn(),
    onPreview: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
  };
  const props = { tool, artifactKey: 'artifact1', scene: new Group() };
  const view = renderHook((input) => useDirectEditControls(input), { initialProps: props });
  const press = (axis = new Vector3(1, 0, 0), clientX = 100): void => {
    const event = mock<ThreeEvent<PointerEvent>>({
      nativeEvent: { button: 0, pointerType: 'mouse', pointerId: 7, clientX, clientY: 100 },
    });
    act(() => {
      view.result.current.press(event, axis);
    });
  };
  return { ...view, props, tool, press };
}
describe('native direct edit handle ownership', () => {
  it('should preview native translation without writes then commit once at the release coordinate', () => {
    const view = harness();
    view.press();
    expect(controls.enabled).toBe(false);
    act(() => {
      document.dispatchEvent(pointer('pointermove', 130));
      for (const frame of frames.splice(0)) {
        frame(0);
      }
    });
    expect(view.tool.onCommit).not.toHaveBeenCalled();
    expect(view.tool.onPreview).toHaveBeenLastCalledWith({ type: 'translate', delta: [expect.closeTo(0.003), 0, 0] });
    act(() => {
      document.dispatchEvent(pointer('pointerup', 150));
      document.dispatchEvent(pointer('pointerup', 170));
    });
    expect(view.tool.onCommit).toHaveBeenCalledExactlyOnceWith({
      type: 'translate',
      delta: [expect.closeTo(0.005), 0, 0],
    });
    expect(controls.enabled).toBe(true);
    expect(hooks.release).toHaveBeenCalledOnce();
  });
  it.each(['Escape', 'artifact', 'revision', 'mode', 'retarget', 'unmount', 'blur'] as const)(
    'should cancel %s without committing and restore the camera and ghost',
    (reason) => {
      const view = harness();
      view.press();
      act(() => {
        document.dispatchEvent(pointer('pointermove', 140));
        for (const frame of frames.splice(0)) {
          frame(0);
        }
      });
      const ghost = view.result.current.ghost!;
      expect(ghost.group.visible).toBe(true);
      act(() => {
        switch (reason) {
          case 'Escape': {
            hooks.escape?.();
            break;
          }
          case 'retarget': {
            hooks.retarget?.();
            break;
          }
          case 'blur': {
            globalThis.dispatchEvent(new Event('blur'));
            break;
          }
          case 'unmount': {
            view.unmount();
            break;
          }
          default: {
            view.rerender({
              ...view.props,
              artifactKey: reason === 'artifact' ? 'artifact2' : view.props.artifactKey,
              tool: {
                ...view.tool,
                mode: reason === 'mode' ? 'rotate' : view.tool.mode,
                selection: { ...view.tool.selection!, revision: reason === 'revision' ? 'r2' : 'r1' },
              },
            });
          }
        }
      });
      expect(view.tool.onCommit).not.toHaveBeenCalled();
      expect(view.tool.onCancel).toHaveBeenCalledOnce();
      expect(controls.enabled).toBe(true);
      expect(ghost.group.visible).toBe(false);
      expect(hooks.release).toHaveBeenCalledOnce();
      act(() => {
        document.dispatchEvent(pointer('pointerup', 160));
      });
      expect(view.tool.onCommit).not.toHaveBeenCalled();
    },
  );
  it('should uniformly scale at the native pivot and commit exactly one positive factor', () => {
    const view = harness('scale');
    view.press();
    act(() => {
      document.dispatchEvent(pointer('pointerup', 100, 50));
    });
    expect(view.tool.onCommit).toHaveBeenCalledOnce();
    const change = vi.mocked(view.tool.onCommit).mock.calls[0]![0];
    expect(change).toMatchObject({
      type: 'scale',
      origin: [1000, 2000, 3000],
    });
    if (change.type !== 'scale') {
      expect.fail('Expected uniform scale');
    }
    expect(change.factor).toBeCloseTo(Math.exp(0.5));
  });
  it('should rotate around the selected native axis with model origin preserved', () => {
    const view = harness('rotate');
    view.press(new Vector3(0, 0, 1), 150);
    act(() => {
      document.dispatchEvent(pointer('pointerup', 100, 50));
    });
    expect(view.tool.onCommit).toHaveBeenCalledOnce();
    const change = vi.mocked(view.tool.onCommit).mock.calls[0]![0];
    expect(change).toMatchObject({
      type: 'rotate',
      axis: [0, 0, 1],
      origin: [1000, 2000, 3000],
    });
    if (change.type !== 'rotate') {
      expect.fail('Expected native rotation');
    }
    expect(change.angleRadians).toBeCloseTo(Math.PI / 2);
  });
});
