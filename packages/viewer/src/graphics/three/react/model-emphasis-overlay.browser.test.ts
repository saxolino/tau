import { expect, it } from 'vitest';
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  SphereGeometry,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
  WebGLRenderTarget,
} from 'three';
import type { WebGLRenderer } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createSectionClip } from '#graphics/three/materials/section-clip.js';
import type { SilhouetteNodeMaterial } from '#graphics/three/materials/model-emphasis-silhouette.node.js';
import {
  createModelEmphasisResources,
  renderModelEmphasisMask,
  syncModelEmphasisFrame,
  syncModelEmphasisProxies,
} from '#graphics/three/react/model-emphasis-overlay.jsx';

const comparePixels = (packed: Uint8Array<ArrayBuffer>, reference: Uint8Array<ArrayBuffer>, width: number): void => {
  let maxDifference = 0;
  let highlighted = 0;
  let visibleRed = 0;
  let hiddenRed = 0;
  const redLevels = new Set<number>();
  for (const [index, value] of packed.entries()) {
    maxDifference = Math.max(maxDifference, Math.abs(value - reference[index]!));
    if (index % 4 === 0) {
      redLevels.add(reference[index]!);
      if (reference[index]! > 100) {
        highlighted++;
      }
      const x = (index / 4) % width;
      if (x < width / 2 - 4) {
        visibleRed = Math.max(visibleRed, reference[index]!);
      }
      if (x > width / 2 + 4) {
        hiddenRed = Math.max(hiddenRed, reference[index]!);
      }
    }
  }
  expect(highlighted).toBeGreaterThan(100);
  expect(redLevels.size).toBeGreaterThan(5);
  expect(visibleRed).toBeGreaterThan(hiddenRed + 30);
  // Predeclared one-byte tolerance, including resolved fractional edge pixels.
  expect(maxDifference).toBeLessThanOrEqual(1);
};

// Compare storage layouts on the same initialized renderer, poses and sample locations.
// The RGBA reference is the prior production channel contract, not a different renderer.
it.each([false, true])('preserves fractional and occluded highlights with node WebGL2=%s', async (forceWebGl) => {
  const renderer = new WebGPURenderer({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Three constructor option.
    forceWebGL: forceWebGl,
    antialias: false,
    reversedDepthBuffer: !forceWebGl,
  });
  await renderer.init();
  expect(renderer.coordinateSystem).toBe(forceWebGl ? WebGLCoordinateSystem : WebGPUCoordinateSystem);
  renderer.setSize(320, 240);
  const geometry = new SphereGeometry(0.65, 32, 24);
  const source = new Mesh(geometry, new MeshBasicMaterial());
  const occluderGeometry = new BoxGeometry(0.7, 2, 0.1);
  const depthMaterial = new MeshBasicMaterial({ colorWrite: false });
  const occluder = new Mesh(occluderGeometry, depthMaterial);
  occluder.position.set(0.35, 0, 0.8);
  const depthScene = new Scene();
  depthScene.add(occluder);
  const target = new WebGLRenderTarget(320, 240);
  const resources = createModelEmphasisResources('webgpu', createSectionClip('webgpu'));
  const composite = resources.composite as SilhouetteNodeMaterial;
  const output = new Scene();
  // Isolate the outline; production wash and full composition are checked by the 5K fixture.
  output.add(resources.overlayGroup.children[1]!);
  const cases = [false, true].flatMap((perspective) =>
    [false, true].flatMap((selected) => [0, 0.003, 0.007].map((shift) => ({ perspective, selected, shift }))),
  );
  try {
    for (const { perspective, selected, shift } of cases) {
      const camera = perspective
        ? new PerspectiveCamera(40, 4 / 3, 0.1, 10)
        : new OrthographicCamera(-1.6, 1.6, 1.2, -1.2, 0.1, 10);
      camera.position.z = 4;
      camera.updateMatrixWorld();

      const pixelRatio = shift === 0.007 ? 2 : 1;
      const width = 320 * pixelRatio;
      const height = 240 * pixelRatio;
      renderer.setSize(width, height);
      target.setSize(width, height);
      source.position.x = shift;
      source.updateMatrixWorld();
      const capture = async (reference: boolean): Promise<Uint8Array<ArrayBuffer>> => {
        syncModelEmphasisProxies(resources, {
          hover: selected ? [] : [source],
          selected: selected ? [source] : [],
        });
        if (reference) {
          resources.maskTarget.dispose();
          resources.maskTarget.texture.format = RGBAFormat;
          composite.silhouettePackedAlpha.value = 0;
          resources.mask.coverage.hover.color.setRGB(1, 0, 0);
          resources.mask.coverage.selected.color.setRGB(0, 1, 0);
          resources.mask.visibility.hover.color.setRGB(0, 0, 1);
          resources.mask.visibility.selected.color.setRGB(0, 0, 0);
          resources.mask.visibility.selected.opacity = 1;
        }
        resources.setMaskSize({ width, height, pixelRatio });
        syncModelEmphasisFrame(resources);
        renderModelEmphasisMask(resources, {
          gl: renderer as unknown as WebGLRenderer,
          camera,
          previousClear: new Color(),
          restoreDepth: () => {
            renderer.render(depthScene, camera);
          },
        });
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x12_34_56, 1);
        renderer.autoClear = true;
        renderer.render(output, camera);
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
        renderer.setRenderTarget(null);
        syncModelEmphasisProxies(resources, { hover: [], selected: [] });
        return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice();
      };
      // oxlint-disable-next-line no-await-in-loop -- Both captures mutate the same renderer and target.
      const packed = await capture(false);
      // oxlint-disable-next-line no-await-in-loop -- Compare only after the preceding readback completes.
      const reference = await capture(true);
      comparePixels(packed, reference, width);
    }
  } finally {
    resources.dispose();
    target.dispose();
    geometry.dispose();
    source.material.dispose();
    occluderGeometry.dispose();
    depthMaterial.dispose();
    renderer.dispose();
  }
});
