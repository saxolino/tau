import { expect, it, vi } from 'vitest';
import { DataTexture, PerspectiveCamera, Scene } from 'three';
import { NodeMaterial, QuadMesh, WebGPUBackend } from 'three/webgpu';
import { float, sample, screenUV, texture, vec3, vec4 } from 'three/tsl';
import { createRenderer } from '#graphics/three/renderer.js';
import { createAoDenoise } from '#graphics/three/ao-denoise.js';
import { getGeneratedShaderSource } from '#graphics/three/utils/three-shader-debug.js';

// Installed Three declarations omit the native backend device surface.
type ShaderDevice = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
  queue: { onSubmittedWorkDone: () => Promise<void> };
  lost: Promise<unknown>;
  createShaderModule: (descriptor: { code: string }) => {
    getCompilationInfo: () => Promise<{ messages: ReadonlyArray<{ type: string }> }>;
  };
  pushErrorScope: (filter: 'validation') => void;
  popErrorScope: () => Promise<unknown>;
};

it('should compile AO rejection without promoting view-space distances to vec4', async () => {
  const renderer = await createRenderer('showcase', 'webgpu', document.createElement('canvas'));
  if (!(renderer.backend instanceof WebGPUBackend) || !('device' in renderer.backend)) {
    throw new Error('Native WebGPU is required for AO shader qualification');
  }
  const device = renderer.backend.device as ShaderDevice;
  const gpuErrors = vi.fn();
  device.addEventListener('uncapturederror', gpuErrors);
  const input = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  input.needsUpdate = true;
  const material = new NodeMaterial();
  const filter = createAoDenoise({
    texture: texture(input),
    depth: sample(() => float(0.5)),
    // Production MRT normals are RGBA; a TS assertion does not remove alpha.
    normal: sample(() => vec4(0, 0, 1, 1)),
    camera: new PerspectiveCamera(),
  });
  filter.step.value.set(1 / 384, 1 / 384);
  material.fragmentNode = vec4(vec3(filter.visibility(screenUV)), 1);
  material.depthTest = false;
  material.depthWrite = false;
  const quad = new QuadMesh(material);
  const scene = new Scene();
  scene.add(quad);
  try {
    const source = await getGeneratedShaderSource({
      renderer,
      scene,
      camera: quad.camera,
      object: quad,
    });
    if (!source.fragmentShader) {
      throw new Error('The AO material did not produce a fragment shader');
    }
    // A homogeneous W=1 added to the distance dot product rejects coplanar taps.
    expect(source.fragmentShader).not.toMatch(/dot\(\s*vec4/);
    const compilation = await device.createShaderModule({ code: source.fragmentShader }).getCompilationInfo();
    expect(compilation.messages.filter((message) => message.type === 'error')).toEqual([]);
    renderer.render(scene, quad.camera);
    await device.queue.onSubmittedWorkDone();
    expect(gpuErrors).not.toHaveBeenCalled();
    const lost = await Promise.race([device.lost, Promise.resolve(undefined)]);
    expect(lost).toBeUndefined();
    device.pushErrorScope('validation');
    const invalid = await device.createShaderModule({ code: 'invalid AO shader' }).getCompilationInfo();
    expect(invalid.messages.some((message) => message.type === 'error')).toBe(true);
    expect(await device.popErrorScope()).not.toBeNull();
  } finally {
    device.removeEventListener('uncapturederror', gpuErrors);
    material.dispose();
    input.dispose();
    renderer.dispose();
  }
});
