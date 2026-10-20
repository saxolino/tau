import '#test/browser.css';
import { cleanup, render } from '@testing-library/react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import {
  BoxGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
  Scene,
  OrthographicCamera,
} from 'three';
import { WebGPUBackend, WebGLBackend, WebGPURenderer } from 'three/webgpu';
import { createActor, createAsyncLogic } from 'xstate';
import { afterEach, expect, inject, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { SceneOverlay, useOverlayDepthRestorer } from '#graphics/three/scene-overlay.jsx';
import { GraphicsProvider, useCameraRig } from '#hooks/use-graphics.jsx';
import { graphicsMachine } from '#machines/graphics.machine.js';
import { ThreeCanvasInstance } from '#graphics/three/three-canvas-instance.jsx';
import { isViewportWebGpu } from '#graphics/three/viewport-cad-renderer.js';
import { syncGltfSurfaceDepthBias } from '#graphics/three/materials/gltf-surface-depth-bias.js';
import { resolveSectionPieces } from '#graphics/section-cuts.js';
import { writeSectionClip } from '#graphics/three/materials/section-clip.js';
import {
  createModelEmphasisResources,
  renderModelEmphasisMask,
  syncModelEmphasisFrame,
  syncModelEmphasisProxies,
} from '#graphics/three/react/model-emphasis-overlay.jsx';
import { measureEmphasisPixels } from '#graphics/three/materials/model-emphasis-pixels.test-utils.js';
import { useSectionClip } from '#graphics/three/react/section-clipping-group.jsx';
import { createSectionStencilCaps } from '#graphics/three/utils/section-stencil-caps.js';
import type * as rendererModule from '#graphics/three/renderer.js';
import {
  captureRendererOutput as captureInstalledRendererOutput,
  disposeRendererOutput as disposeInstalledRendererOutput,
  installRendererOutput,
} from '@taucad/runtime-testing/browser/three-renderer-output';

const referenceMode = vi.hoisted(() => ({ forceNodeWebGl2: false }));

const captureRendererOutput = async (renderer: rendererModule.RendererInstance): Promise<Uint8ClampedArray> => {
  if (isViewportWebGpu(renderer) && renderer.backend instanceof WebGLBackend) {
    const copy = document.createElement('canvas');
    copy.width = renderer.domElement.width;
    copy.height = renderer.domElement.height;
    const context = copy.getContext('2d');
    if (!context) {
      throw new Error('Node WebGL2 reference requires Canvas2D');
    }
    context.drawImage(renderer.domElement, 0, 0);
    return context.getImageData(0, 0, copy.width, copy.height).data;
  }
  return captureInstalledRendererOutput(renderer);
};
const disposeRendererOutput = async (renderer: rendererModule.RendererInstance): Promise<void> => {
  if (isViewportWebGpu(renderer) && renderer.backend instanceof WebGLBackend) {
    return;
  }
  await disposeInstalledRendererOutput(renderer);
};

vi.mock('#graphics/three/renderer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof rendererModule>();
  return {
    ...actual,
    createRenderer: async (...args: Parameters<typeof actual.createRenderer>) => {
      if (referenceMode.forceNodeWebGl2) {
        const target = args[2];
        const renderer = new WebGPURenderer({
          canvas: 'canvas' in target ? target.canvas : target,
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Three constructor option.
          forceWebGL: true,
          antialias: false,
          samples: 0,
          alpha: true,
          stencil: true,
        });
        await renderer.init();
        renderer.setRenderObjectFunction((...draw) => {
          syncGltfSurfaceDepthBias.call(draw[4], renderer);
          renderer.renderObject(...draw);
        });
        return renderer;
      }
      const renderer = await actual.createRenderer(...args);
      installRendererOutput(renderer, inject('webGpuProfile'));
      return renderer;
    },
  };
});

afterEach(() => {
  cleanup();
  referenceMode.forceNodeWebGl2 = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['webgl', 'webgpu'] as const)('should smooth shader edges in the final %s image', async (backend) => {
  await page.viewport(600, 500);
  const actor = createActor(
    graphicsMachine.provide({
      actors: {
        probeWebGpu: createAsyncLogic({
          run: async () => backend === 'webgpu',
        }),
      },
    }),
    { input: { enablePostProcessing: true } },
  ).start();
  // Nearest-filtered diagonal is a shader edge: geometry MSAA alone cannot smooth it.
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const offset = (y * 64 + x) * 4;
      pixels.fill(x > y * 0.37 + 18 ? 255 : 0, offset, offset + 3);
      pixels[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, 64, 64, RGBAFormat);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  let smoothed = 0;
  let dark = 0;
  let bright = 0;
  let state: RootState | undefined;
  let pending: Promise<void> | undefined;
  let retired = false;
  let captureError: Error | undefined;
  const measure = async (current: RootState): Promise<void> => {
    try {
      const data = await captureRendererOutput(current.gl);
      smoothed = 0;
      dark = 0;
      bright = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] !== 255) {
          continue;
        }
        const value = data[index]!;
        if (value > 25 && value < 215) {
          smoothed += 1;
        } else if (value < 5) {
          dark += 1;
        } else if (value > 230) {
          bright += 1;
        }
      }
    } catch (error) {
      captureError = error instanceof Error ? error : new Error(String(error));
    } finally {
      pending = undefined;
    }
  };
  const Probe = (): undefined => {
    state = useThree();
    useFrame((current) => {
      state = current;
      if (!pending && !retired) {
        pending = measure(current);
      }
    }, 4);
    return undefined;
  };
  try {
    render(
      <div style={{ width: 256, height: 256 }}>
        <GraphicsProvider
          graphicsRef={actor}
          seed={{
            camera: {
              cameraView: {
                frameId: 'tau:root',
                target: [0, 0, 0],
                direction: [0, 0, 1],
                up: [0, 1, 0],
                verticalSpan: 4,
                perspectiveZoom: 1,
              },
            },
          }}
        >
          <ThreeCanvasInstance
            graphicsBackend={backend}
            upDirection='y'
            postProcessingSettings={{ intensity: 0, gtaoIntensity: 0 }}
            onRetry={() => undefined}
          >
            <mesh>
              <planeGeometry args={[4, 4]} />
              <meshBasicMaterial map={texture} />
            </mesh>
            <Probe />
          </ThreeCanvasInstance>
        </GraphicsProvider>
      </div>,
    );
    await vi.waitFor(
      () => {
        state?.invalidate();
        // Explicit test frames also exercise the graph when the OS suspends rAF.
        // Software profile reads the final offscreen target, not screen presentation.
        state?.advance(performance.now(), true);
        if (captureError) {
          throw captureError;
        }
        expect(smoothed, JSON.stringify({ smoothed, dark, bright })).toBeGreaterThan(32);
        expect(dark).toBeGreaterThan(1000);
        expect(bright).toBeGreaterThan(1000);
      },
      { timeout: 45_000 },
    );
    expect(isViewportWebGpu(state!.gl)).toBe(backend === 'webgpu');
    if (isViewportWebGpu(state!.gl)) {
      expect('isWebGPUBackend' in state!.gl.backend && state!.gl.backend.isWebGPUBackend).toBe(true);
      expect(state!.gl.samples).toBe(4);
      expect(state!.gl.reversedDepthBuffer).toBe(true);
    }
  } finally {
    retired = true;
    await pending;
    if (state) {
      await disposeRendererOutput(state.gl);
    }
    cleanup();
    actor.stop();
    texture.dispose();
  }
  if (captureError) {
    throw captureError;
  }
});

// A straight wall meets a flat floor. Away from its ends, occlusion must be
// constant along each horizontal row; noise cannot masquerade as surface detail.
it.each(
  (['webgl', 'webgpu', 'node-webgl2'] as const).flatMap((execution) =>
    [1, 2].flatMap((dpr) => [0, 45].map((fov) => ({ execution, dpr, fov }))),
  ),
)('should keep contact AO smooth without erasing it: $execution DPR $dpr FOV $fov', async ({ execution, dpr, fov }) => {
  referenceMode.forceNodeWebGl2 = execution === 'node-webgl2';
  const backend = execution === 'webgl' ? 'webgl' : 'webgpu';
  vi.stubGlobal('devicePixelRatio', dpr);
  await page.viewport(600, 500);
  const actor = createActor(
    graphicsMachine.provide({
      actors: {
        probeWebGpu: createAsyncLogic({
          run: async () => backend === 'webgpu',
        }),
      },
    }),
    { input: { enablePostProcessing: true } },
  ).start();
  let state: RootState | undefined;
  let pending: Promise<void> | undefined;
  let pixels: Uint8ClampedArray | undefined;
  let captureError: Error | undefined;
  let retired = false;
  let movingWall: Mesh | undefined;
  let motionPhase: number | undefined;
  let cameraOriginX = 0;
  let cameraOriginY = 0;
  let wallOriginY = 0;
  let frame = 0;
  let capturedFrame = 0;
  const measure = async (current: RootState): Promise<void> => {
    try {
      const requestedFrame = frame;
      pixels = await captureRendererOutput(current.gl);
      capturedFrame = requestedFrame;
    } catch (error) {
      captureError = error instanceof Error ? error : new Error(String(error));
    } finally {
      pending = undefined;
    }
  };
  const Probe = (): undefined => {
    const currentState = useThree();
    state = currentState;
    useFrame((current) => {
      if (motionPhase === undefined || !movingWall) {
        return;
      }
      current.camera.position.x = cameraOriginX + (motionPhase * 4) / current.gl.domElement.width;
      current.camera.position.y = cameraOriginY + (motionPhase * 4) / current.gl.domElement.width;
      current.camera.updateMatrix();
      current.camera.updateMatrixWorld(true);
      movingWall.matrix.elements[12] = (motionPhase * 2) / current.gl.domElement.width;
      movingWall.matrix.elements[13] = wallOriginY + (motionPhase * 2) / current.gl.domElement.width;
      movingWall.matrixWorldNeedsUpdate = true;
      movingWall.updateMatrixWorld(true);
    }, 0.9);
    useFrame((current) => {
      frame++;
      state = current;
      if (!pending && !retired) {
        pending = measure(current);
      }
    }, 4);
    return undefined;
  };
  const currentWidth = (): number => state?.gl.domElement.width ?? 0;
  try {
    render(
      <div style={{ width: 384, height: 384 }}>
        <GraphicsProvider
          graphicsRef={actor}
          seed={{
            camera: {
              cameraFovAngle: fov,
              cameraView: {
                frameId: 'tau:root',
                target: [0, 0, 0],
                direction: [0, 0, 1],
                up: [0, 1, 0],
                verticalSpan: 4,
                perspectiveZoom: 1,
              },
            },
          }}
        >
          <ThreeCanvasInstance
            graphicsBackend={backend}
            upDirection='y'
            postProcessingSettings={{
              displayMode: 'ao',
              radiusCssPixels: 24,
            }}
            onRetry={() => undefined}
          >
            <mesh>
              <planeGeometry args={[4, 4]} />
              <meshStandardMaterial />
            </mesh>
            <mesh
              position={[0, 0.5, 0.2]}
              ref={(mesh) => {
                movingWall = mesh ?? undefined;
              }}
            >
              <boxGeometry args={[3, 1, 0.4]} />
              <meshStandardMaterial />
            </mesh>
            <Probe />
          </ThreeCanvasInstance>
        </GraphicsProvider>
      </div>,
    );
    await vi.waitFor(
      () => {
        // Keep at most one readback in flight. Queuing more software frames while
        // waiting for its GPU saturates the queue and makes the oracle time out.
        if (!pending && capturedFrame < 4) {
          state?.advance(performance.now(), true);
        }
        if (captureError) {
          throw captureError;
        }
        const width = currentWidth();
        expect(width).toBe(384 * dpr);
        expect(pixels?.length).toBe(width * width * 4);
        // Admit a completed graph after camera settling; do not wait on the quality assertion.
        expect(capturedFrame).toBeGreaterThanOrEqual(4);
      },
      { timeout: 45_000 },
    );
    retired = true;
    await pending;
    const { width, height } = state!.gl.domElement;
    const measureContact = (image: Uint8ClampedArray): { noise: number; contact: number; residuals: number[] } => {
      const rowNoise: number[] = [];
      const rowMeans: number[] = [];
      const residuals: number[] = [];
      // A planar contact must be uniform along each row, including fractional-pixel motion.
      for (let y = Math.ceil(height * 0.51); y < Math.floor(height * 0.55); y++) {
        const values: number[] = [];
        for (let x = Math.ceil(width * 0.35); x < Math.floor(width * 0.65); x++) {
          values.push(image[(y * width + x) * 4]!);
        }
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        rowMeans.push(mean);
        residuals.push(...values.map((value) => value - mean));
        rowNoise.push(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length));
      }
      return {
        noise: Math.sqrt(rowNoise.reduce((sum, value) => sum + value ** 2, 0) / rowNoise.length),
        contact: Math.min(...rowMeans),
        residuals,
      };
    };
    cameraOriginX = state!.camera.position.x;
    cameraOriginY = state!.camera.position.y;
    wallOriginY = movingWall!.matrix.elements[13]!;
    const initialImage = new Uint8ClampedArray(pixels!);
    let changedPixels = 0;
    let previous = measureContact(pixels!).residuals;
    // Remove each row's mean to separate the moving contact gradient from grain.
    // Move camera and wall in both axes through subpixel phases.
    for (const phase of [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 0]) {
      motionPhase = phase;
      // Node passes update once per animation frame; synchronous advances would reuse their textures.
      // oxlint-disable-next-line no-await-in-loop -- Each phase must reach a separate GPU frame before changing transforms.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      state!.advance(performance.now(), true);
      // oxlint-disable-next-line no-await-in-loop -- Read this phase before submitting the next one.
      const image = await captureRendererOutput(state!.gl);
      changedPixels = Math.max(
        changedPixels,
        image.reduce((count, value, index) => count + Number(index % 4 === 0 && value !== initialImage[index]), 0),
      );
      const sample = measureContact(image);
      const previousResiduals = previous;
      const shimmer = Math.sqrt(
        sample.residuals.reduce((sum, value, i) => sum + (value - previousResiduals[i]!) ** 2, 0) /
          previousResiduals.length,
      );
      const diagnostic = JSON.stringify({
        execution,
        dpr,
        fov,
        phase,
        noise: sample.noise,
        contact: sample.contact,
        shimmer,
      });
      expect(sample.noise, diagnostic).toBeLessThan(0.75);
      expect(shimmer, diagnostic).toBeLessThan(1);
      expect(sample.contact, diagnostic).toBeLessThan(250);
      expect(sample.contact, diagnostic).toBeGreaterThan(80);
      expect(image[(Math.floor(height * 0.8) * width + Math.floor(width / 2)) * 4], diagnostic).toBeGreaterThan(250);
      previous = sample.residuals;
    }
    expect(changedPixels, 'Motion must change the rendered image').toBeGreaterThan(10);
    expect(state!.camera.type).toBe(fov === 0 ? 'OrthographicCamera' : 'PerspectiveCamera');
    expect(isViewportWebGpu(state!.gl)).toBe(backend === 'webgpu');
    if (isViewportWebGpu(state!.gl)) {
      expect(state!.gl.backend).toBeInstanceOf(execution === 'node-webgl2' ? WebGLBackend : WebGPUBackend);
    }
  } finally {
    retired = true;
    await pending;
    if (state) {
      await disposeRendererOutput(state.gl);
    }
    cleanup();
    actor.stop();
  }
});

// A cap is drawn by a child of Scene after post-processing, before the grid/axes overlay.
// Exercise that ownership boundary with flat colours so either lost depth has an unambiguous pixel.
it.each((['webgl', 'webgpu'] as const).flatMap((backend) => ['front', 'behind'].map((cap) => ({ backend, cap }))))(
  'should retain scene and cap depth before later overlays: $backend cap $cap',
  async ({ backend, cap }) => {
    vi.stubGlobal('devicePixelRatio', 1);
    await page.viewport(400, 400);
    const actor = createActor(
      graphicsMachine.provide({
        actors: {
          probeWebGpu: createAsyncLogic({ run: async () => backend === 'webgpu' }),
        },
      }),
      { input: { enablePostProcessing: true } },
    ).start();
    let state: RootState | undefined;
    let pending: Promise<void> | undefined;
    let pixels: Uint8ClampedArray | undefined;
    let captureError: Error | undefined;
    let retired = false;
    let frames = 0;
    let captured = 0;
    const Cap = () => {
      const scene = useMemo(() => new Scene(), []);
      const restoreDepth = useOverlayDepthRestorer();
      useFrame(({ gl, camera }) => {
        restoreDepth();
        const previous = gl.autoClear;
        gl.autoClear = false;
        try {
          gl.render(scene, camera);
        } finally {
          gl.autoClear = previous;
        }
      }, 1.2);
      return createPortal(
        <mesh position={[0, 0, cap === 'front' ? 0.2 : -0.2]}>
          <planeGeometry args={[2, 2]} />
          <meshBasicMaterial color='red' toneMapped={false} />
        </mesh>,
        scene,
      );
    };
    const measure = async (current: RootState): Promise<void> => {
      const requested = frames;
      try {
        pixels = await captureRendererOutput(current.gl);
        captured = requested;
      } catch (error) {
        captureError = error instanceof Error ? error : new Error(String(error));
      } finally {
        pending = undefined;
      }
    };
    const Probe = (): undefined => {
      state = useThree();
      useFrame((current) => {
        frames++;
        if (!pending && !retired) {
          pending = measure(current);
        }
      }, 4);
      return undefined;
    };
    try {
      render(
        <div style={{ width: 128, height: 128 }}>
          <GraphicsProvider
            graphicsRef={actor}
            seed={{
              camera: {
                cameraFovAngle: 0,
                cameraView: {
                  frameId: 'tau:root',
                  target: [0, 0, 0],
                  direction: [0, 0, 1],
                  up: [0, 1, 0],
                  verticalSpan: 4,
                  perspectiveZoom: 1,
                },
              },
            }}
          >
            <ThreeCanvasInstance
              graphicsBackend={backend}
              upDirection='y'
              onRetry={() => undefined}
              postProcessingSettings={{ intensity: 0, gtaoIntensity: 0, toneMapping: 'none' }}
            >
              <mesh>
                <planeGeometry args={[4, 4]} />
                <meshBasicMaterial color='blue' toneMapped={false} />
              </mesh>
              <Cap />
              <SceneOverlay overlayActive>
                <mesh position={[0, 0, cap === 'front' ? 0.1 : -0.1]}>
                  <planeGeometry args={[4, 4]} />
                  <meshBasicMaterial color='lime' toneMapped={false} />
                </mesh>
              </SceneOverlay>
              <Probe />
            </ThreeCanvasInstance>
          </GraphicsProvider>
        </div>,
      );
      await vi.waitFor(
        () => {
          if (!pending && captured < 4) {
            state?.advance(performance.now(), true);
          }
          if (captureError) {
            throw captureError;
          }
          expect(captured).toBeGreaterThanOrEqual(4);
        },
        { timeout: 45_000 },
      );
      retired = true;
      await pending;
      const { width } = state!.gl.domElement;
      const centre = [...pixels!.subarray((64 * width + 64) * 4, (64 * width + 64) * 4 + 3)];
      expect(isViewportWebGpu(state!.gl)).toBe(backend === 'webgpu');
      expect(centre, JSON.stringify({ backend, cap, centre })).toEqual(cap === 'front' ? [255, 0, 0] : [0, 0, 255]);
      const outside = [...pixels!.subarray((64 * width + 8) * 4, (64 * width + 8) * 4 + 3)];
      expect(outside).toEqual(cap === 'front' ? [0, 255, 0] : [0, 0, 255]);
    } finally {
      retired = true;
      await pending;
      if (state) {
        await disposeRendererOutput(state.gl);
      }
      cleanup();
      actor.stop();
    }
  },
);

// Diagnostic qualification: accepted WebGL is the reference. Integrate contrast
// around isolated strokes so subpixel placement cannot hide width differences.
it.each([1, 1.5, 2].flatMap((dpr) => [0x00_00_00, 0xff_d5_4a].map((color) => ({ dpr, color }))))(
  'should match final edge contrast across subpixel phases at DPR $dpr color $color',
  async ({ dpr, color }) => {
    vi.stubGlobal('devicePixelRatio', dpr);
    await page.viewport(600, 500);
    const { Vector2 } = await import('three');
    const { createGltfFatLineMaterial, createGltfFatLineSegmentsFromPositions } =
      await import('#graphics/three/materials/gltf-edges.js');
    const phases = [0, 0.25, 0.5, 0.75];
    const centers = phases.flatMap((phase, row) =>
      [0, Math.PI / 2, Math.PI / 4, null].map((angle, column) => ({
        x: 32 + column * 64 + phase,
        y: 32 + row * 64 + phase,
        angle,
      })),
    );
    const positions = new Float32Array(
      centers.flatMap(({ x, y, angle }) => {
        if (angle === null) {
          const radius = 16;
          const point = (index: number) => {
            const theta = -1.25 + (index * 2.5) / 32;
            return [x - 128 - radius + radius * Math.cos(theta), 128 - y + radius * Math.sin(theta), 0.01];
          };
          return Array.from({ length: 32 }, (_, index) => [...point(index), ...point(index + 1)]).flat();
        }
        const dx = Math.cos(angle) * 20;
        const dy = Math.sin(angle) * 20;
        return [x - 128 - dx, 128 - y - dy, 0.01, x - 128 + dx, 128 - y + dy, 0.01];
      }),
    );
    const results: number[][] = [];
    for (const execution of ['webgl', 'webgpu', 'node-webgl2'] as const) {
      referenceMode.forceNodeWebGl2 = execution === 'node-webgl2';
      const backend = execution === 'webgl' ? 'webgl' : 'webgpu';
      const actor = createActor(
        graphicsMachine.provide({
          actors: {
            probeWebGpu: createAsyncLogic({ run: async () => backend === 'webgpu' }),
          },
        }),
        { input: { enablePostProcessing: true } },
      ).start();
      const material = createGltfFatLineMaterial({ backend, resolution: new Vector2(256, 256), edgeColor: color });
      const lines = createGltfFatLineSegmentsFromPositions({ backend, positions, material });
      if (!lines) {
        throw new Error('Expected non-empty edge fixture');
      }
      let state: RootState | undefined;
      let pending: Promise<void> | undefined;
      let pixels: Uint8ClampedArray | undefined;
      let captureError: Error | undefined;
      let frame = 0;
      let capturedFrame = 0;
      let retired = false;
      const measure = async (current: RootState): Promise<void> => {
        const requestedFrame = frame;
        try {
          pixels = await captureRendererOutput(current.gl);
          capturedFrame = requestedFrame;
        } catch (error) {
          captureError = error instanceof Error ? error : new Error(String(error));
        } finally {
          pending = undefined;
        }
      };
      const Probe = (): undefined => {
        state = useThree();
        useFrame((current) => {
          frame++;
          if (!pending && !retired) {
            pending = measure(current);
          }
        }, 4);
        return undefined;
      };
      try {
        render(
          <div style={{ width: 256, height: 256 }}>
            <GraphicsProvider
              graphicsRef={actor}
              seed={{
                camera: {
                  cameraFovAngle: 0,
                  cameraView: {
                    frameId: 'tau:root',
                    target: [0, 0, 0],
                    direction: [0, 0, 1],
                    up: [0, 1, 0],
                    verticalSpan: 256,
                    perspectiveZoom: 1,
                  },
                },
              }}
            >
              <ThreeCanvasInstance
                graphicsBackend={backend}
                upDirection='y'
                postProcessingSettings={{ intensity: 0, gtaoIntensity: 0 }}
                onRetry={() => undefined}
              >
                <mesh>
                  <planeGeometry args={[512, 512]} />
                  <meshBasicMaterial color={0xff_ff_ff} />
                </mesh>
                <primitive object={lines} />
                <Probe />
              </ThreeCanvasInstance>
            </GraphicsProvider>
          </div>,
        );
        // oxlint-disable-next-line no-await-in-loop -- comparison must dispose one backend before opening the next.
        await vi.waitFor(
          () => {
            if (!pending && capturedFrame < 4) {
              state?.advance(performance.now(), true);
            }
            if (captureError) {
              throw captureError;
            }
            expect(state?.gl.domElement.width).toBe(256 * dpr);
            expect(capturedFrame).toBeGreaterThanOrEqual(4);
          },
          { timeout: 45_000 },
        );
        retired = true;
        // oxlint-disable-next-line no-await-in-loop -- drain the final readback before measurement.
        await pending;
        expect(state!.camera.type).toBe('OrthographicCamera');
        expect(isViewportWebGpu(state!.gl)).toBe(backend === 'webgpu');
        if (isViewportWebGpu(state!.gl)) {
          expect(state!.gl.backend).toBeInstanceOf(execution === 'node-webgl2' ? WebGLBackend : WebGPUBackend);
        }
        const background = pixels![2]!;
        expect(background).toBeGreaterThan(200);
        const widths = centers.map(({ x, y }) => {
          let contrast = 0;
          for (let row = Math.floor((y - 26) * dpr); row < Math.ceil((y + 26) * dpr); row++) {
            for (let column = Math.floor((x - 26) * dpr); column < Math.ceil((x + 26) * dpr); column++) {
              contrast += 1 - pixels![(row * 256 * dpr + column) * 4 + 2]! / background;
            }
          }
          return contrast / (40 * dpr * dpr);
        });
        results.push(widths);
      } finally {
        retired = true;
        // oxlint-disable-next-line no-await-in-loop -- drain owned resources before the next backend.
        await pending;
        if (state) {
          // oxlint-disable-next-line no-await-in-loop -- teardown is sequential.
          await disposeRendererOutput(state.gl);
        }
        cleanup();
        actor.stop();
        lines.geometry.dispose();
        material.dispose();
      }
    }
    const differences = results
      .slice(1)
      .flatMap((candidate) => results[0]!.map((value, index) => Math.abs(value - candidate[index]!)));
    expect(Math.min(...results.flat()), JSON.stringify(results)).toBeGreaterThan(0.05);
    expect(Math.max(...differences), JSON.stringify({ dpr, results, differences })).toBeLessThanOrEqual(0.1);
  },
);

it.each(['webgl', 'webgpu', 'node-webgl2'].flatMap((execution) => [1, -1].map((side) => ({ execution, side }))))(
  'should occlude grid and hidden outlines through actual stencil caps: $execution side $side',
  async ({ execution, side }) => {
    vi.stubGlobal('devicePixelRatio', 1);
    await page.viewport(400, 400);
    referenceMode.forceNodeWebGl2 = execution === 'node-webgl2';
    const backend = execution === 'webgl' ? 'webgl' : 'webgpu';
    const actor = createActor(
      graphicsMachine.provide({
        actors: {
          probeWebGpu: createAsyncLogic({ run: async () => backend === 'webgpu' }),
        },
      }),
      { input: { enablePostProcessing: true } },
    ).start();
    const geometry = new BoxGeometry(2, 2, 2);
    const material = new MeshBasicMaterial({ color: 'blue', side: DoubleSide, toneMapped: false });
    const surface = new Mesh(geometry, material);
    const pieces = resolveSectionPieces([{ id: 'cut', kind: 'plane', plane: 'xy', offset: 0, isFlipped: false }]);
    const caps = createSectionStencilCaps(backend);
    let state: RootState | undefined;
    let outputTransforms = 0;
    let measuredOutputTransforms = 0;
    let observedRenderer: RootState['gl'] | undefined;
    let pending: Promise<void> | undefined;
    let pixels: Uint8ClampedArray | undefined;
    let beforeGrid: Uint8ClampedArray | undefined;
    let beforeCaps: Uint8ClampedArray | undefined;
    let capsEnabled = side === 1;
    let grid: Mesh | undefined;
    let captureError: Error | undefined;
    let frame = 0;
    let captured = 0;
    let retired = false;
    const Cap = (): undefined => {
      const clip = useSectionClip();
      useFrame(() => {
        writeSectionClip(clip, pieces);
      }, 0.5);
      const restoreDepth = useOverlayDepthRestorer();
      useFrame(({ gl, camera }) => {
        if (!capsEnabled) {
          return;
        }
        restoreDepth();
        caps.render(gl, {
          camera,
          pieces,
          sources: [{ key: 'box', ownerKey: 'box', meshes: [surface], tintHex: 0xff_00_00, edgeHex: 0xff_ff_00 }],
          stripes: { stripeFrequency: 1e6, stripeWidth: 0 },
          outlineWidthPixels: 1.5,
          viewportHeightPixels: 128,
        });
      }, 1.2);
      return undefined;
    };
    const ColorProbe = (): ReactNode => {
      const overlayScene = useMemo(() => new Scene(), []);
      const camera = useMemo(() => new OrthographicCamera(-1, 1, 1, -1, 0.1, 10), []);
      camera.position.z = 2;
      useFrame(({ gl }) => {
        const previous = gl.autoClear;
        gl.autoClear = false;
        try {
          gl.render(overlayScene, camera);
        } finally {
          gl.autoClear = previous;
        }
      }, 2.2);
      return createPortal(
        <>
          <mesh position={[-0.75, 0.75, 0]}>
            <planeGeometry args={[0.25, 0.25]} />
            <meshBasicMaterial color='#808080' depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh position={[0.75, 0.75, 0]} renderOrder={1}>
            <planeGeometry args={[0.25, 0.25]} />
            <meshBasicMaterial color='#808080' depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh position={[0.75, 0.75, 0]} renderOrder={2}>
            <planeGeometry args={[0.25, 0.25]} />
            <meshBasicMaterial
              color='red'
              transparent
              opacity={0.5}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </>,
        overlayScene,
      );
    };
    const measure = async (current: RootState): Promise<void> => {
      const requestedFrame = frame;
      try {
        pixels = await captureRendererOutput(current.gl);
        captured = requestedFrame;
        if (captured >= 4 && !beforeCaps) {
          beforeCaps = pixels;
          capsEnabled = true;
        }
        if (captured >= 8 && !beforeGrid && grid) {
          beforeGrid = pixels;
          grid.visible = true;
        }
      } catch (error) {
        captureError = error instanceof Error ? error : new Error('Renderer capture failed', { cause: error });
      } finally {
        pending = undefined;
      }
    };
    const Probe = (): undefined => {
      const current = useThree();
      state = current;
      if (current.gl !== observedRenderer && isViewportWebGpu(current.gl)) {
        observedRenderer = current.gl;
        const renderer = current.gl;
        const previous = renderer.getRenderObjectFunction();
        renderer.setRenderObjectFunction((...draw) => {
          if (draw[0].name === 'Output Color Transform' || draw[0].name === 'Tau final output') {
            outputTransforms++;
          }
          if (previous) {
            previous(...draw);
          } else {
            renderer.renderObject(...draw);
          }
        });
      }
      useFrame(() => {
        outputTransforms = 0;
      }, 0.9);
      useFrame((current) => {
        measuredOutputTransforms = outputTransforms;
        frame++;
        if (!pending && !retired) {
          pending = measure(current);
        }
      }, 4);
      return undefined;
    };
    try {
      render(
        <div style={{ width: 128, height: 128 }}>
          <GraphicsProvider
            graphicsRef={actor}
            seed={{
              camera: {
                cameraFovAngle: 0,
                cameraView: {
                  frameId: 'tau:root',
                  target: [0, 0, 0],
                  direction: [0.4, 0, side],
                  up: [0, 1, 0],
                  verticalSpan: 4,
                  perspectiveZoom: 1,
                },
              },
            }}
          >
            <ThreeCanvasInstance
              graphicsBackend={backend}
              upDirection='y'
              onRetry={() => undefined}
              postProcessingSettings={{ intensity: 0, gtaoIntensity: 0, toneMapping: 'none' }}
            >
              <primitive object={surface} />
              <mesh visible={side === -1} position={[0, 0, -1.5]}>
                <boxGeometry args={[2.4, 2.4, 0.1]} />
                <meshBasicMaterial color='magenta' toneMapped={false} />
              </mesh>
              <Cap />
              <SceneOverlay overlayActive>
                <mesh
                  ref={(node) => {
                    grid = node ?? undefined;
                  }}
                  visible={false}
                  position={[0, 0, -0.25]}
                >
                  <planeGeometry args={[4, 4]} />
                  <meshBasicMaterial color='lime' side={DoubleSide} toneMapped={false} />
                </mesh>
              </SceneOverlay>
              <ColorProbe />
              <Probe />
            </ThreeCanvasInstance>
          </GraphicsProvider>
        </div>,
      );
      await vi.waitFor(
        () => {
          if (!pending && captured < 12) {
            state?.advance(performance.now(), true);
          }
          if (captureError) {
            throw captureError;
          }
          expect(captured).toBeGreaterThanOrEqual(12);
        },
        { timeout: 45_000 },
      );
      retired = true;
      await pending;
      if (isViewportWebGpu(state!.gl)) {
        expect(state!.gl.backend).toBeInstanceOf(execution === 'node-webgl2' ? WebGLBackend : WebGPUBackend);
      }
      if (backend === 'webgpu') {
        expect(measuredOutputTransforms, 'one encoding after all cap and overlay draws').toBe(1);
        // Encoded grey and a linear-light 50% red blend distinguish missing/double encoding.
        for (const [x, expected] of [
          [16, [128, 128, 128]],
          [112, [205, 92, 92]],
        ] as const) {
          const actual = pixels!.subarray((16 * 128 + x) * 4, (16 * 128 + x) * 4 + 3);
          for (const [channel, value] of expected.entries()) {
            expect(Math.abs(actual[channel]! - value)).toBeLessThanOrEqual(2);
          }
        }
      }
      // The cut-facing view is red; the back-facing cut is hidden by a magenta
      // opaque occluder. Neither
      // may contain the later green grid or a yellow hidden cap outline. Compare
      // before/after adding the grid so the existing striped tint is preserved.
      for (let y = 38; y < 90; y++) {
        for (let x = 48; x < 80; x++) {
          const offset = (y * 128 + x) * 4;
          const actual = [...pixels!.subarray(offset, offset + 3)];
          expect(actual, `${execution}, side ${side}, ${x},${y}`).toEqual([
            ...beforeGrid!.subarray(offset, offset + 3),
          ]);
          if (side === 1) {
            expect(actual[0]! - actual[1]!).toBeGreaterThan(100);
            expect(Math.abs(actual[1]! - actual[2]!)).toBeLessThanOrEqual(1);
          } else {
            expect(actual).toEqual([255, 0, 255]);
          }
        }
      }
      if (side === -1) {
        const isOccluderInterior = (x: number, y: number): boolean =>
          [-2, 0, 2].every((dy) =>
            [-2, 0, 2].every((dx) => {
              const offset = ((y + dy) * 128 + x + dx) * 4;
              return beforeCaps![offset] === 255 && beforeCaps![offset + 1] === 0 && beforeCaps![offset + 2] === 255;
            }),
          );
        let checked = 0;
        for (let y = 38; y < 90; y++) {
          for (let x = 8; x < 120; x++) {
            if (!isOccluderInterior(x, y)) {
              continue;
            }
            const offset = (y * 128 + x) * 4;
            expect([...beforeGrid!.subarray(offset, offset + 3)], `hidden outline at ${x},${y}`).toEqual([255, 0, 255]);
            checked++;
          }
        }
        expect(checked).toBeGreaterThan(1000);
      }
      expect([...pixels!.subarray((64 * 128 + 20) * 4, (64 * 128 + 20) * 4 + 3)]).toEqual([0, 255, 0]);
    } finally {
      retired = true;
      await pending;
      if (state) {
        await disposeRendererOutput(state.gl);
      }
      cleanup();
      actor.stop();
      caps.dispose();
      material.dispose();
      geometry.dispose();
    }
  },
);

// Use the live post owner (PBR, AO, retained frame depth, overlays and final encoding),
// not a standalone mask render. The prior native fusion passed isolated mask pixels.
it.each([false, true])(
  'should clear persistent emphasis through the production node frame: WebGL2=%s',
  async (forceNodeWebGl2) => {
    referenceMode.forceNodeWebGl2 = forceNodeWebGl2;
    vi.stubGlobal('devicePixelRatio', 2);
    await page.viewport(500, 500);
    const actor = createActor(
      graphicsMachine.provide({
        actors: {
          probeWebGpu: createAsyncLogic({ run: async () => true }),
        },
      }),
      { input: { enablePostProcessing: true } },
    ).start();
    let state: RootState | undefined;
    let resources: ReturnType<typeof createModelEmphasisResources> | undefined;
    let source: Mesh | undefined;
    let occluder: Mesh | undefined;
    let cameraRig: ReturnType<typeof useCameraRig> | undefined;
    let separate = false;
    let cropped = true;
    const comparisons: unknown[] = [];
    let pixels: Uint8ClampedArray | undefined;
    let pending: Promise<void> | undefined;
    let captureError: Error | undefined;
    let retired = false;
    let frames = 0;
    let captured = 0;
    const Mask = (): ReactNode => {
      state = useThree();
      cameraRig = useCameraRig();
      const clip = useSectionClip();
      const restoreDepth = useOverlayDepthRestorer();
      const owned = useMemo(() => createModelEmphasisResources('webgpu', clip), [clip]);
      resources = owned;
      const previousClear = useMemo(() => new Color(), []);
      useFrame(({ gl, camera }) => {
        if (!source) {
          return;
        }
        owned.setMaskSize({ width: gl.domElement.width, height: gl.domElement.height, pixelRatio: gl.getPixelRatio() });
        syncModelEmphasisFrame(owned);
        const selected = separate ? { ...owned, setFrameDepth: () => false } : owned;
        renderModelEmphasisMask(selected, {
          gl,
          camera,
          restoreDepth,
          previousClear,
          boundedComposite: true,
          croppedMask: cropped,
          fuseNativeClear: !separate,
        });
      }, 1.4);
      useFrame((current) => {
        frames++;
        if (retired || pending) {
          return;
        }
        const requested = frames;
        pending = (async () => {
          try {
            pixels = new Uint8ClampedArray(await captureRendererOutput(current.gl));
            captured = requested;
          } catch (error) {
            captureError = error instanceof Error ? error : new Error(String(error));
          } finally {
            pending = undefined;
          }
        })();
      }, 4);
      return (
        <SceneOverlay overlayActive renderPriority={1.5}>
          <primitive object={owned.overlayGroup} />
        </SceneOverlay>
      );
    };
    try {
      render(
        <div style={{ width: 256, height: 256 }}>
          <GraphicsProvider
            graphicsRef={actor}
            seed={{
              camera: {
                cameraFovAngle: 0,
                cameraView: {
                  frameId: 'tau:root',
                  target: [0, 0, 0],
                  direction: [0, 0, 1],
                  up: [0, 1, 0],
                  verticalSpan: 4,
                  perspectiveZoom: 1,
                },
              },
            }}
          >
            <ThreeCanvasInstance graphicsBackend='webgpu' upDirection='y' onRetry={() => undefined}>
              <mesh
                ref={(mesh) => {
                  source = mesh ?? undefined;
                }}
              >
                <sphereGeometry args={[0.5, 24, 16]} />
                <meshStandardMaterial color={0x42_8a_c4} roughness={0.6} metalness={0.2} />
              </mesh>
              <mesh
                ref={(mesh) => {
                  occluder = mesh ?? undefined;
                }}
                position={[0.4, 0, 0.8]}
              >
                <boxGeometry args={[0.35, 1.6, 0.1]} />
                <meshStandardMaterial color='white' />
              </mesh>
              <directionalLight position={[1, 2, 4]} intensity={3} />
              <Mask />
            </ThreeCanvasInstance>
          </GraphicsProvider>
        </div>,
      );
      await vi.waitFor(
        () => {
          expect(state).toBeDefined();
          expect(resources).toBeDefined();
          expect(source).toBeDefined();
        },
        { timeout: 30_000 },
      );
      const capture = async (): Promise<Uint8ClampedArray> => {
        await pending;
        const start = frames;
        await vi.waitFor(
          () => {
            if (!pending) {
              state!.advance(performance.now(), true);
            }
            if (captureError) {
              throw captureError;
            }
            expect(captured).toBeGreaterThan(start + 2);
          },
          { timeout: 30_000 },
        );
        await pending;
        return new Uint8ClampedArray(pixels!);
      };
      for (const [index, x] of [-0.6, 0.6, 0, -0.3, 0.25, -0.5, 0, 0.5].entries()) {
        source!.position.x = x;
        if (index === 2 || index === 5) {
          cameraRig!.actorRef.send({ type: 'setVerticalFieldOfView', verticalFieldOfView: index === 2 ? 40 : 0 });
        }
        if (index === 4) {
          syncModelEmphasisProxies(resources!, { hover: [], selected: [] });
          expect(resources!.maskTarget.width).toBe(1);
          state!.setDpr(1.5);
        }
        if (index === 1) {
          syncModelEmphasisProxies(resources!, { hover: [], selected: [] });
        }
        syncModelEmphasisProxies(
          resources!,
          index % 3 === 0
            ? { hover: [occluder!], selected: [source!] }
            : index % 3 === 1
              ? { hover: [], selected: [source!] }
              : { hover: [source!], selected: [] },
        );
        separate = false;
        cropped = true;
        // oxlint-disable-next-line no-await-in-loop -- Reuse the same frame and mask through successive poses.
        const candidate = await capture();
        if (index === 1) {
          expect(resources!.maskTarget.width * resources!.maskTarget.height).toBeLessThan(
            state!.gl.domElement.width * state!.gl.domElement.height,
          );
        }
        expect(state!.camera instanceof OrthographicCamera).toBe(index < 2 || index >= 5);
        expect(state!.gl.getPixelRatio()).toBe(index < 4 ? 2 : 1.5);
        const candidateCamera = {
          world: state!.camera.matrixWorld.toArray(),
          projection: state!.camera.projectionMatrix.toArray(),
        };
        cropped = false;
        // oxlint-disable-next-line no-await-in-loop -- Clear-only control isolates pass ordering from changed projection.
        const clearOnly = await capture();
        separate = true;
        // oxlint-disable-next-line no-await-in-loop -- Explicit-clear reference for exactly the same live composition.
        const reference = await capture();
        expect({
          world: state!.camera.matrixWorld.toArray(),
          projection: state!.camera.projectionMatrix.toArray(),
        }).toEqual(candidateCamera);
        let yellow = 0;
        for (let i = 0; i < reference.length; i += 4) {
          if (reference[i]! > reference[i + 2]! + 15 && reference[i + 1]! > reference[i + 2]! + 10) {
            yellow++;
          }
        }
        expect(yellow).toBeGreaterThan(30);
        const clearResult = measureEmphasisPixels(clearOnly, reference, state!.gl.domElement.width);
        expect(clearResult.maxDelta, JSON.stringify({ forceNodeWebGl2, index, clearResult })).toBeLessThanOrEqual(1);
        const result = measureEmphasisPixels(candidate, reference, state!.gl.domElement.width);
        comparisons.push({ index, result });
        // Gate revision 2: boundary-local screen, with negative controls in model-emphasis-pixels.test.ts.
        expect(result.interiorChanges, JSON.stringify({ forceNodeWebGl2, index, result })).toBe(0);
        expect(result.maxLocalMean, JSON.stringify({ forceNodeWebGl2, index, result })).toBeLessThanOrEqual(16);
      }
      console.info('Mask crop pixel evidence', JSON.stringify({ forceNodeWebGl2, comparisons }));
      expect(isViewportWebGpu(state!.gl)).toBe(true);
      if (isViewportWebGpu(state!.gl)) {
        expect(state!.gl.backend).toBeInstanceOf(forceNodeWebGl2 ? WebGLBackend : WebGPUBackend);
      }
    } finally {
      retired = true;
      await pending;
      if (state) {
        await disposeRendererOutput(state.gl);
      }
      cleanup();
      resources?.dispose();
      actor.stop();
    }
  },
);
