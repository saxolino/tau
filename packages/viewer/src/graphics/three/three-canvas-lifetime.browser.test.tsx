import { createRoot, _roots, flushSync, extend } from '@react-three/fiber';
import { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

extend({ Group });

const renderers = new Set<WebGLRenderer>();
const canvases = new Set<HTMLCanvasElement>();
const roots = new Set<ReturnType<typeof createRoot>>();
afterEach(() => {
  for (const root of roots) {
    flushSync(() => {
      root.unmount();
    });
  }
  for (const canvas of canvases) {
    canvas.remove();
  }
  roots.clear();
  for (const renderer of renderers) {
    renderer.dispose();
  }
  canvases.clear();
  renderers.clear();
});

describe('same-canvas WebGL ownership', () => {
  it.each(['before replacement', 'after replacement'] as const)(
    'keeps the replacement context usable when the retired factory constructs %s',
    async (construction) => {
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      canvases.add(canvas);
      const makeRenderer = (): WebGLRenderer => {
        const renderer = new WebGLRenderer({ canvas });
        renderers.add(renderer);
        return renderer;
      };
      let oldRenderer = construction === 'before replacement' ? makeRenderer() : undefined;
      let release: ((renderer: WebGLRenderer) => void) | undefined;
      const camera = new PerspectiveCamera();
      const old = createRoot(canvas);
      const oldConfiguration = old.configure({
        gl: async () =>
          new Promise<WebGLRenderer>((resolve) => {
            release = resolve;
          }),
        camera,
        size: { width: 10, height: 10, top: 0, left: 0 },
        frameloop: 'never',
      });
      old.render(<group name='retired' />);
      flushSync(() => {
        old.unmount();
      });
      const survivor = createRoot(canvas);
      roots.add(survivor);
      const renderer = makeRenderer();
      await survivor.configure({
        gl: renderer,
        camera,
        size: { width: 80, height: 60, top: 0, left: 0 },
        dpr: 1.5,
        frameloop: 'never',
      });
      survivor.render(<group name='survivor' />);
      const backing = [canvas.width, canvas.height];
      const projection = camera.projectionMatrix.toArray();
      oldRenderer ??= makeRenderer();
      expect(oldRenderer.getContext()).toBe(renderer.getContext());
      const dispose = vi.spyOn(oldRenderer, 'dispose');
      const loseContext = vi.spyOn(oldRenderer, 'forceContextLoss');
      release!(oldRenderer);
      await oldConfiguration;
      await vi.waitFor(() => {
        expect(dispose).toHaveBeenCalledOnce();
      });
      expect(loseContext).not.toHaveBeenCalled();
      expect([canvas.width, canvas.height]).toEqual(backing);
      expect(camera.projectionMatrix.toArray()).toEqual(projection);
      expect(_roots.get(canvas)?.store.getState().gl).toBe(renderer);
      const gl = renderer.getContext();
      expect(gl.isContextLost()).toBe(false);
      renderer.setClearColor(0x00_ff_00, 1);
      renderer.render(new Scene(), camera);
      const pixel = new Uint8Array(4);
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      expect([...pixel]).toEqual([0, 255, 0, 255]);
      expect(gl.getError()).toBe(gl.NO_ERROR);
    },
  );
});
