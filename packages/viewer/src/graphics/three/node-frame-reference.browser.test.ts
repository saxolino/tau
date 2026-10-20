import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  RenderTarget,
  HalfFloatType,
  UnsignedByteType,
  LinearSRGBColorSpace,
  NormalBlending,
  Vector2,
  AlwaysDepth,
  WebGLCoordinateSystem,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
} from 'three';
import { WebGLBackend, WebGPUBackend, RenderPipeline, NodeMaterial, QuadMesh } from 'three/webgpu';
import { pass, screenUV, vec4 } from 'three/tsl';
import { createRenderer } from '#graphics/three/renderer.js';

// This minimal reference intentionally isolates output ownership from AO, edge
// coverage, clipping and stencil. Those remain separate production gates.
it.each(['classic', 'node-webgpu', 'node-webgl2', 'node-webgpu-viewport'] as const)(
  'should preserve PBR color and cap depth through subsequent draws on %s',
  async (configuration) => {
    await page.viewport(400, 300);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const renderer =
      configuration === 'classic'
        ? await createRenderer('viewport', 'webgl', canvas)
        : configuration === 'node-webgpu-viewport'
          ? await createRenderer('viewport', 'webgpu', canvas)
          : await createRenderer('showcase', configuration === 'node-webgpu' ? 'webgpu' : 'webgl', canvas);
    const geometry = new PlaneGeometry(4, 4);
    const material = new MeshStandardMaterial({ color: 0x42_8a_c4, roughness: 0.6, metalness: 0.2 });
    const scene = new Scene();
    scene.background = new Color(0xff_ff_ff);
    scene.add(new Mesh(geometry, material));
    const light = new DirectionalLight(0xff_ff_ff, 3);
    light.position.set(1, 2, 4);
    scene.add(light);
    const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
    camera.position.z = 5;
    const overlay = new Scene();
    const overlayMaterial = new MeshBasicMaterial({ color: 0xff_00_00 });
    const gridMaterial = new MeshBasicMaterial({ color: 0x00_ff_00 });
    const cap = new Mesh(geometry, overlayMaterial);
    cap.scale.set(0.25, 0.25, 1);
    cap.position.z = 0.2;
    overlay.add(cap);
    const grid = new Scene();
    const stripe = new Mesh(geometry, gridMaterial);
    stripe.scale.set(1, 0.125, 1);
    stripe.position.z = 0.1;
    grid.add(stripe);
    const hidden = new Mesh(geometry, gridMaterial);
    hidden.scale.set(1, 0.125, 1);
    hidden.position.set(0, 1, -0.2);
    grid.add(hidden);
    const restoreMaterial = new NodeMaterial();
    restoreMaterial.depthWrite = true;
    restoreMaterial.depthTest = renderer.coordinateSystem === WebGLCoordinateSystem;
    restoreMaterial.depthFunc = AlwaysDepth;
    restoreMaterial.colorWrite = false;
    const restore = new QuadMesh(restoreMaterial);
    let pipeline: RenderPipeline | undefined;
    let scenePass: ReturnType<typeof pass> | undefined;
    const copy = document.createElement('canvas');
    copy.width = 128;
    copy.height = 128;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Reference capture requires Canvas2D');
    }
    const capture = (): Uint8ClampedArray => {
      context.drawImage(canvas, 0, 0);
      return context.getImageData(0, 0, 128, 128).data;
    };
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(128, 128);
      renderer.toneMapping = NoToneMapping;
      renderer.outputColorSpace = SRGBColorSpace;
      if ('isWebGPURenderer' in renderer) {
        expect(renderer.backend).toBeInstanceOf(configuration === 'node-webgl2' ? WebGLBackend : WebGPUBackend);
        scenePass = pass(scene, camera);
        pipeline = new RenderPipeline(renderer, scenePass.getTextureNode().mul(vec4(0.5, 1, 0.25, 1)));
        restoreMaterial.depthNode = scenePass.getTextureNode('depth').sample(screenUV);
      }
      const draw = (): void => {
        renderer.autoClear = true;
        if (pipeline) {
          pipeline.render();
        } else {
          renderer.render(scene, camera);
        }
      };
      draw();
      const before = capture();
      const center = (64 * 128 + 64) * 4;
      expect(before[center + 2]).toBeGreaterThan(80);
      expect(before[center + 3]).toBe(255);
      // A fresh frame avoids relying on preserveDrawingBuffer in classic GL.
      draw();
      renderer.autoClear = false;
      if ('isWebGPURenderer' in renderer) {
        restore.render(renderer);
      }
      renderer.render(overlay, camera);
      renderer.render(grid, camera);
      const after = capture();
      // Cap depth must reject the later green stripe, and the outside stripe
      // must remain in front of the base. Uncovered PBR color must survive.
      expect([...after.subarray(center, center + 4)]).toEqual([255, 0, 0, 255]);
      const outside = (64 * 128 + 16) * 4;
      expect([...after.subarray(outside, outside + 4)]).toEqual([0, 255, 0, 255]);
      const hiddenPixel = (32 * 128 + 64) * 4;
      for (let channel = 0; channel < 4; channel++) {
        expect(
          Math.abs(after[hiddenPixel + channel]! - before[hiddenPixel + channel]!),
          JSON.stringify({
            before: [...before.subarray(hiddenPixel, hiddenPixel + 4)],
            after: [...after.subarray(hiddenPixel, hiddenPixel + 4)],
          }),
        ).toBeLessThanOrEqual(2);
      }
      const untouched = (16 * 128 + 16) * 4;
      for (let channel = 0; channel < 4; channel++) {
        expect(Math.abs(after[untouched + channel]! - before[untouched + channel]!)).toBeLessThanOrEqual(2);
      }
    } finally {
      pipeline?.dispose();
      scenePass?.dispose();
      geometry.dispose();
      material.dispose();
      overlayMaterial.dispose();
      gridMaterial.dispose();
      restoreMaterial.dispose();
      renderer.dispose();
      canvas.remove();
    }
  },
);

it.each(['webgpu', 'webgl'] as const)('should draw Tau node lines directly on %s', async (backend) => {
  const { createGltfFatLineMaterial, createGltfFatLineSegmentsFromPositions } =
    await import('#graphics/three/materials/gltf-edges.js');
  const { createSectionClip, installSectionClip } = await import('#graphics/three/materials/section-clip.js');
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = await createRenderer('showcase', backend, canvas);
  const material = createGltfFatLineMaterial({ backend: 'webgpu', resolution: new Vector2(128, 128), edgeColor: 0 });
  installSectionClip(material, createSectionClip('webgpu'));
  const lines = createGltfFatLineSegmentsFromPositions({
    backend: 'webgpu',
    material,
    positions: new Float32Array([-1, 0, 0, 1, 0, 0]),
  });
  if (!lines) {
    throw new Error('Expected node line fixture');
  }
  const scene = new Scene();
  scene.background = new Color(0xff_ff_ff);
  scene.add(lines);
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  camera.position.z = 5;
  const copy = document.createElement('canvas');
  copy.width = 128;
  copy.height = 128;
  const context = copy.getContext('2d');
  if (!context) {
    throw new Error('Expected Canvas2D');
  }
  try {
    expect(renderer.backend).toBeInstanceOf(backend === 'webgpu' ? WebGPUBackend : WebGLBackend);
    renderer.setSize(128, 128);
    renderer.render(scene, camera);
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, 128, 128).data;
    expect(pixels[(63 * 128 + 64) * 4]).toBeLessThan(240);
  } finally {
    lines.geometry.dispose();
    material.dispose();
    renderer.dispose();
    canvas.remove();
  }
});

it.each(['webgpu', 'webgl'] as const)(
  'should preserve display ramps, alpha and linear overlay blends in compact frame storage on %s',
  async (backend) => {
    const { texture, renderOutput, uv, vec3, uniform } = await import('three/tsl');
    const canvas = document.createElement('canvas');
    const renderer = await createRenderer('showcase', backend, canvas);
    const reference = new RenderTarget(256, 32, { type: HalfFloatType, depthBuffer: false });
    reference.texture.colorSpace = LinearSRGBColorSpace;
    const compact = new RenderTarget(256, 32, { type: UnsignedByteType, depthBuffer: false });
    compact.texture.colorSpace = SRGBColorSpace;
    // Deliberately wrong storage: uniformly spaced linear bytes visibly crush dark ramps.
    const negative = new RenderTarget(256, 32, { type: UnsignedByteType, depthBuffer: false });
    negative.texture.colorSpace = LinearSRGBColorSpace;
    const destination = new RenderTarget(256, 32, { type: UnsignedByteType, depthBuffer: false });
    const base = new NodeMaterial();
    const alpha = uniform(1);
    const dark = uniform(0.05);
    base.fragmentNode = vec4(uv().x.mul(dark), uv().x.mul(dark), uv().x.mul(dark), alpha);
    base.depthTest = false;
    base.depthWrite = false;
    const baseQuad = new QuadMesh(base);
    const overlay = new NodeMaterial();
    overlay.fragmentNode = vec4(vec3(1, 0.12, 0.02), 0.17);
    overlay.transparent = true;
    overlay.blending = NormalBlending;
    overlay.depthTest = false;
    overlay.depthWrite = false;
    const overlayQuad = new QuadMesh(overlay);
    const outputs = [reference, compact, negative].map((target) => {
      const material = new NodeMaterial();
      material.fragmentNode = renderOutput(texture(target.texture), NoToneMapping, SRGBColorSpace);
      material.depthTest = false;
      material.depthWrite = false;
      return new QuadMesh(material);
    });
    const onError = vi.fn();
    // Installed r184 declarations omit the native device property.
    const device =
      renderer.backend instanceof WebGPUBackend && 'device' in renderer.backend
        ? (renderer.backend.device as Pick<EventTarget, 'addEventListener' | 'removeEventListener'>)
        : undefined;
    device?.addEventListener('uncapturederror', onError);
    try {
      expect(renderer.backend).toBeInstanceOf(backend === 'webgpu' ? WebGPUBackend : WebGLBackend);
      renderer.setSize(256, 32);
      renderer.outputColorSpace = LinearSRGBColorSpace;
      renderer.toneMapping = NoToneMapping;
      for (const scenario of [
        { range: 0.05, alpha: 1, layers: 0, tolerance: 2 },
        { range: 1, alpha: 0.31, layers: 0, tolerance: 2 },
        { range: 1, alpha: 1, layers: 1, tolerance: 2 },
        { range: 1, alpha: 0.31, layers: 4, tolerance: 3 },
      ]) {
        dark.value = scenario.range;
        alpha.value = scenario.alpha;
        const images: Array<Uint8Array<ArrayBuffer>> = [];
        for (const [index, target] of [reference, compact, negative].entries()) {
          renderer.setRenderTarget(target);
          renderer.autoClear = true;
          baseQuad.render(renderer);
          renderer.autoClear = false;
          for (let layer = 0; layer < scenario.layers; layer++) {
            overlayQuad.render(renderer);
          }
          renderer.setRenderTarget(destination);
          renderer.autoClear = true;
          outputs[index]!.render(renderer);
          // oxlint-disable-next-line no-await-in-loop -- Read each completed variant before reusing the destination.
          const bytes = await renderer.readRenderTargetPixelsAsync(destination, 0, 0, 256, 32);
          images.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice());
        }
        const maximum = (image: Uint8Array<ArrayBuffer>): number => {
          let largest = 0;
          for (const [index, value] of image.entries()) {
            largest = Math.max(largest, Math.abs(value - images[0]![index]!));
          }
          return largest;
        };
        expect(maximum(images[1]!), JSON.stringify(scenario)).toBeLessThanOrEqual(scenario.tolerance);
        if (scenario.range === 0.05) {
          expect(maximum(images[2]!)).toBeGreaterThan(3);
        }
      }
      expect(onError).not.toHaveBeenCalled();
    } finally {
      device?.removeEventListener('uncapturederror', onError);
      renderer.setRenderTarget(null);
      for (const quad of outputs) {
        (quad.material as NodeMaterial).dispose();
      }
      base.dispose();
      overlay.dispose();
      reference.dispose();
      compact.dispose();
      negative.dispose();
      destination.dispose();
      renderer.dispose();
    }
  },
);
