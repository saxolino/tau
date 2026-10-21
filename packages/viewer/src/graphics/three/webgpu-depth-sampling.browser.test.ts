import { expect, it } from 'vitest';
import {
  AlwaysDepth,
  AlwaysStencilFunc,
  DepthStencilFormat,
  DepthTexture,
  NotEqualStencilFunc,
  FloatType,
  NoColorSpace,
  RenderTarget,
  ReplaceStencilOp,
  UnsignedInt248Type,
} from 'three';
import { NodeMaterial, QuadMesh, WebGLBackend, WebGPUBackend } from 'three/webgpu';
import { float, texture, vec4 } from 'three/tsl';
import { createRenderer } from '#graphics/three/renderer.js';

// oxlint-disable no-await-in-loop -- Sequential reuse and disposal are the behavior under test.
it.each([
  { execution: 'webgpu', type: FloatType },
  { execution: 'webgpu', type: UnsignedInt248Type },
  { execution: 'webgl', type: UnsignedInt248Type },
] as const)(
  'should preserve sampled depth and attachment stencil through resize/recreation on $execution/$type',
  async ({ execution, type }) => {
    // Two independent instances exercise factory installation and device-local view ownership.
    for (let instance = 0; instance < 2; instance++) {
      const renderer = await createRenderer('showcase', execution, document.createElement('canvas'));
      expect(renderer.backend).toBeInstanceOf(execution === 'webgpu' ? WebGPUBackend : WebGLBackend);
      const native = renderer.backend as typeof renderer.backend & {
        device?: {
          addEventListener: (type: string, callback: (event: { error: { message: string } }) => void) => void;
          removeEventListener: (type: string, callback: (event: { error: { message: string } }) => void) => void;
          queue: { onSubmittedWorkDone: () => Promise<void> };
        };
      };
      const errors: string[] = [];
      const observe = (event: { error: { message: string } }): void => {
        errors.push(event.error.message);
      };
      native.device?.addEventListener('uncapturederror', observe);
      const depth = new DepthTexture(16, 16, type);
      depth.format = DepthStencilFormat;
      const source = new RenderTarget(16, 16, { depthTexture: depth, stencilBuffer: true });
      const destination = new RenderTarget(16, 16, { depthBuffer: false, type: FloatType });
      destination.texture.colorSpace = NoColorSpace;
      const write = new NodeMaterial();
      write.fragmentNode = vec4(1, 0, 0, 1);
      write.depthFunc = AlwaysDepth;
      write.stencilWrite = true;
      write.stencilFunc = AlwaysStencilFunc;
      write.stencilRef = 7;
      write.stencilZPass = ReplaceStencilOp;
      const probe = new NodeMaterial();
      probe.fragmentNode = vec4(0, 1, 0, 1);
      probe.depthTest = false;
      probe.depthWrite = false;
      probe.stencilWrite = true;
      probe.stencilFunc = NotEqualStencilFunc;
      // Nonzero stencil proves the attachment survived the pass boundary.
      // r184 separately caches nonzero stencil references across render passes.
      probe.stencilRef = 0;
      const read = new NodeMaterial();
      read.fragmentNode = vec4(texture(depth).r, 0, 0, 1);
      read.depthTest = false;
      read.depthWrite = false;
      const writeQuad = new QuadMesh(write);
      const probeQuad = new QuadMesh(probe);
      const readQuad = new QuadMesh(read);
      try {
        if (execution === 'webgpu' && type === FloatType) {
          expect(renderer.hasFeature('depth32float-stencil8')).toBe(true);
        }
        for (const [index, [width, height]] of (
          [
            [16, 16],
            [5120, 2880],
            [16, 16],
          ] as const
        ).entries()) {
          source.setSize(width, height);
          destination.setSize(width, height);
          const expected = 0.375 + index * 2 ** -24;
          write.depthNode = float(expected);
          write.needsUpdate = true;
          renderer.autoClear = true;
          renderer.setRenderTarget(source);
          writeQuad.render(renderer);
          renderer.autoClear = false;
          probeQuad.render(renderer);
          const stencilPixels = await renderer.readRenderTargetPixelsAsync(source, 0, 0, 1, 1);
          expect([...stencilPixels].slice(0, 4)).toEqual([0, 255, 0, 255]);
          renderer.autoClear = true;
          renderer.setRenderTarget(destination);
          readQuad.render(renderer);
          for (const [x, y] of [
            [0, 0],
            [width - 1, 0],
            [0, height - 1],
            [width - 1, height - 1],
            [Math.floor(width / 2), Math.floor(height / 2)],
          ]) {
            const pixels = await renderer.readRenderTargetPixelsAsync(destination, x!, y!, 1, 1);
            expect(pixels).toBeInstanceOf(Float32Array);
            expect(Math.abs(Number(pixels[0]) - expected)).toBeLessThanOrEqual(2 ** -25);
          }
          await native.device?.queue.onSubmittedWorkDone();
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
          expect(errors).toEqual([]);
          if (execution === 'webgl') {
            expect((renderer.getContext() as WebGL2RenderingContext).getError()).toBe(0);
          }
        }
      } finally {
        native.device?.removeEventListener('uncapturederror', observe);
        source.dispose();
        destination.dispose();
        write.dispose();
        probe.dispose();
        read.dispose();
        renderer.dispose();
      }
    }
  },
);

// oxlint-enable no-await-in-loop -- End sequential lifecycle checks.
