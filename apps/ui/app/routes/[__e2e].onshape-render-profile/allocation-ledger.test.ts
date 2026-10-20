import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataTexture, HalfFloatType, RGBAFormat, RGFormat } from 'three';
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
  ).toBe('28faf9665bfdcbc063be31cd7725fa4e5d2d1ee822e890bbb6b6c204d88978a4');
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
