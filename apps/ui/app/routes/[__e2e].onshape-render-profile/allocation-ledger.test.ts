import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DataTexture, HalfFloatType, RGBAFormat, RGFormat, Texture, WebGLCoordinateSystem } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import {
  installAllocationLedger,
  readAllocationLedgers,
} from '#routes/[__e2e].onshape-render-profile/allocation-ledger.js';

describe('allocation accounting', () => {
  it('should reconcile tracking through release and resized reallocation', () => {
    const renderer = new WebGPURenderer();
    installAllocationLedger(renderer);
    const texture = new DataTexture(new Uint16Array(32), 4, 2, RGBAFormat, HalfFloatType);
    renderer.info.createTexture(texture);
    expect(renderer.info.memory.texturesSize).toBe(64);
    expect(readAllocationLedgers()).toEqual(
      expect.arrayContaining([expect.objectContaining({ trackedLive: 64, peak: 64 })]),
    );
    renderer.info.destroyTexture(texture);
    texture.image.width = 2;
    texture.format = RGFormat;
    renderer.info.createTexture(texture);
    expect(renderer.info.memory.texturesSize).toBe(16);
    expect(readAllocationLedgers()).toEqual(
      expect.arrayContaining([expect.objectContaining({ trackedLive: 16, peak: 64 })]),
    );
    renderer.info.destroyTexture(texture);
    expect(renderer.info.memory.texturesSize).toBe(0);
    expect(readAllocationLedgers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trackedLive: 0,
          peak: 64,
          textures: [expect.objectContaining({ live: false, trackedBytes: 16, format: RGFormat })],
        }),
      ]),
    );
    texture.dispose();
  });
});

it('should guard private allocation and pass boundaries against dependency changes', () => {
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve('three')), '..');
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'src/renderers/common/Info.js')))
      .digest('hex'),
  ).toBe('f57050b6d6865f6c80504deb2d7c91c002ed89f65ea25e6792e2335e06eaeef7');
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'src/renderers/common/Textures.js')))
      .digest('hex'),
    // Reviewed 8697c563a4: unresolved nodeGL mask depth uses a renderbuffer; sampled depth is unchanged.
  ).toBe('f254ca8221e17bf58a2aad3e99735bc6b5b183331dc9aeafd530d73bf2b3347c');
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'src/renderers/common/Backend.js')))
      .digest('hex'),
  ).toBe('1f65bf1c615a917cd6e0d0af1576e7c48ae9ebe50ecbbd4c7a5d4b0586606099');
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'src/renderers/webgpu/WebGPUBackend.js')))
      .digest('hex'),
  ).toBe('7e716cda174a0f155d3f53f2290dbdbf719c414f01923bb118eb31c433a8347e');
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'src/renderers/webgl-fallback/WebGLBackend.js')))
      .digest('hex'),
  ).toBe('453ebc61fe7acf2530e6570a5a12699947fdca5dcbd02c092496c1b8363b82f8');
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'src/renderers/webgpu/utils/WebGPUTextureUtils.js')))
      .digest('hex'),
  ).toBe('5f241b35187e26b1d1b56279330df466d55f62bdce4a53e0106835cacba06ce1');
  expect(
    createHash('sha256')
      .update(readFileSync(resolve(root, 'src/renderers/webgl-fallback/utils/WebGLTextureUtils.js')))
      .digest('hex'),
  ).toBe('6b08fc0d0af38b893bd243991ba09eef844c2af99cb07c59f53f7a1c7149acc0');
});

describe('allocation ledger retirement', () => {
  it.each(['webgpu', 'webgl2-node'] as const)(
    'distinguishes historical texture events from retired %s resources',
    async (backend) => {
      let retireDevice: (value: { reason: string }) => void = vi.fn();
      let contextLost = false;
      const events = new EventTarget();
      const detach = vi.spyOn(events, 'removeEventListener');
      const renderer = {
        coordinateSystem: backend === 'webgl2-node' ? WebGLCoordinateSystem : 2001,
        info: {
          memory: { texturesSize: 0 },
          createTexture: vi.fn(),
          destroyTexture: vi.fn(),
        },
        backend: {
          device: {
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            lost: new Promise<{ reason: string }>((resolve) => {
              retireDevice = resolve;
            }),
          },
          createTexture: vi.fn(),
          destroyTexture: vi.fn(),
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Match the upstream descriptor field.
          get: () => ({ textureDescriptorGPU: { size: { width: 5120, height: 2880 }, format: 'rgba16float' } }),
          beginRender: vi.fn(),
          finishRender: vi.fn(),
          draw: vi.fn(),
        },
        getContext: () => ({ isContextLost: () => contextLost }),
        dispose: () => {
          contextLost = true;
          retireDevice({ reason: 'destroyed' });
        },
      };
      installAllocationLedger(renderer as unknown as WebGPURenderer);
      const texture = new Texture();
      renderer.backend.createTexture(texture);
      expect(readAllocationLedgers()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            disposed: false,
            textures: [expect.objectContaining({ activeBackendAllocation: true })],
          }),
        ]),
      );
      if (backend === 'webgpu') {
        const emit = (message: string): void => {
          const event = new Event('uncapturederror');
          Object.defineProperty(event, 'error', { value: { message } });
          events.dispatchEvent(event);
        };
        emit('invalid depth view');
        emit('invalid depth view');
        expect((readAllocationLedgers() as unknown[]).at(-1)).toMatchObject({
          validationErrors: ['invalid depth view'],
        });
        for (let index = 0; index < 30; index++) {
          emit(`failure ${index}`);
        }
        expect(
          (readAllocationLedgers() as Array<{ validationErrors: string[] }>).at(-1)?.validationErrors,
        ).toHaveLength(20);
        retireDevice({ reason: 'destroyed' });
        await Promise.resolve();
        const lost = readAllocationLedgers() as unknown[];
        expect(lost.at(-1)).toMatchObject({
          disposed: false,
          retirement: 'device-destroyed',
          textures: [{ activeBackendAllocation: false }],
        });
      }
      renderer.dispose();
      const afterDisposal = new Event('uncapturederror');
      Object.defineProperty(afterDisposal, 'error', { value: { message: 'after disposal' } });
      events.dispatchEvent(afterDisposal);
      if (backend === 'webgpu') {
        expect(detach).toHaveBeenCalledWith('uncapturederror', expect.any(Function));
      }
      await Promise.resolve();
      const receipts = readAllocationLedgers() as unknown[];
      expect(receipts.at(-1)).toMatchObject({
        disposed: true,
        disposedAt: expect.any(Number) as unknown,
        retirement: backend === 'webgpu' ? 'device-destroyed' : 'context-lost',
        textures: [{ backendLive: true, activeBackendAllocation: false }],
      });
    },
  );
});
