import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { act, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import {
  UnsignedByteType,
  UnsignedInt248Type,
  DepthStencilFormat,
  HalfFloatType,
  RedFormat,
  NeutralToneMapping,
  NoToneMapping,
  SRGBColorSpace,
  RenderTarget,
} from 'three';
import type { ToneMapping, Vector2 } from 'three';
import type { PostProcessingSettings } from '#graphics/three/post-processing-settings.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockCameraSnapshot = { view: { target: [number, number, number] } };
type MockAoNode = {
  resolutionScale: number;
  useTemporalFiltering: boolean;
  radius: { value: number };
  thickness: { value: number };
  samples: { value: number };
  distanceFallOff: { value: number };
  scale: { value: number; greaterThan: (value: number) => unknown };
  getTextureNode: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  _noiseNode: { value: { dispose: ReturnType<typeof vi.fn> } };
};

const mocks = vi.hoisted(() => {
  const perspectiveCamera = { kind: 'perspective' };
  const orthographicCamera = { kind: 'orthographic' };
  const scene = { isScene: true };
  const invalidate = vi.fn();
  const glRender = vi.fn();
  const clearDepth = vi.fn();
  const compileSettlers: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  const compileAsync = vi.fn(
    async () =>
      new Promise<void>((resolve, reject) => {
        compileSettlers.push({ resolve, reject });
      }),
  );
  const rendererState = { target: { kind: 'prior-target' } as unknown, mrt: null as unknown };
  const getRenderTarget = vi.fn(() => rendererState.target);
  const setRenderTarget = vi.fn((target: unknown) => {
    rendererState.target = target;
  });
  const getMrt = vi.fn(() => rendererState.mrt);
  const setMrt = vi.fn((value: unknown) => {
    rendererState.mrt = value;
  });
  const gl = {
    coordinateSystem: 2001,
    autoClear: true,
    outputColorSpace: 'srgb',
    toneMapping: 0,
    getDrawingBufferSize: (target: Vector2) => target.set(3000, 2000),
    clearDepth,
    compileAsync,
    getRenderTarget,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Three.js API property.
    getMRT: getMrt,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Three.js API property.
    isWebGPURenderer: true,
    render: glRender,
    reversedDepthBuffer: true,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Three.js API property.
    setMRT: setMrt,
    setRenderTarget,
  };
  const getCurrentViewport = vi.fn((camera: unknown) => ({
    height: camera === perspectiveCamera ? 20 : 40,
    width: 20,
  }));
  const state = {
    gl,
    scene,
    camera: perspectiveCamera,
    invalidate,
    size: { width: 1500, height: 1000 },
    viewport: { getCurrentViewport, dpr: 2 },
  };
  const rig = {
    perspectiveCamera,
    orthographicCamera,
    activeCamera: perspectiveCamera,
    renderFrame: { anchorFrameId: 'tau:root', originMeters: [10, 20, 30], metersPerRenderUnit: 0.001 },
  };
  const snapshot: MockCameraSnapshot = { view: { target: [10.01, 20.02, 30.03] } };

  let frame:
    | ((
        state: { gl: typeof gl; scene: typeof scene; camera: typeof perspectiveCamera; invalidate: typeof invalidate },
        delta: number,
      ) => void)
    | undefined;
  let finalFrame: typeof frame;
  let retarget: ((camera: typeof perspectiveCamera, snapshot: MockCameraSnapshot) => void) | undefined;
  let restoreDepth: ((target?: unknown) => void) | undefined;
  let constructionCamera: unknown;
  const scenePasses: Array<{
    camera: unknown;
    compileAsync: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    getTexture: ReturnType<typeof vi.fn>;
    getTextureNode: ReturnType<typeof vi.fn>;
    setMRT: ReturnType<typeof vi.fn>;
    setup: ReturnType<typeof vi.fn>;
    updateBefore: ReturnType<typeof vi.fn>;
  }> = [];
  const outputQuads: Array<{
    endpointCamera: unknown;
    material: { fragmentNode?: unknown };
    render: ReturnType<typeof vi.fn>;
  }> = [];
  const aoNodes: MockAoNode[] = [];
  const displayUniforms: Array<{ value: number }> = [];
  const postDispose = vi.fn();
  const antialiasDispose = vi.fn();
  const aoDispose = vi.fn();
  const noiseDispose = vi.fn();

  const depthNode = { kind: 'depth', sample: vi.fn(() => ({ kind: 'sampled-depth' })) };
  const normalNode = { sample: vi.fn(() => ({ kind: 'normal-sample' })) };
  const colorNode = { a: { kind: 'scene-alpha' }, mul: vi.fn(() => ({ kind: 'composed-color' })) };
  const renderOutput = vi.fn((color: unknown, toneMapping: unknown, colorSpace: unknown) => ({
    color,
    toneMapping,
    colorSpace,
    mul: (factor: unknown) => ({ kind: 'display-composed-color', color, factor }),
  }));
  const aoTexture = { sample: vi.fn(() => ({ r: { kind: 'ao-r' } })) };
  const normalTexture = { type: 0, format: 0 };
  const prewarm = vi.fn();
  const updateAoCamera = vi.fn();
  const createGtaoCameraAdapter = vi.fn((camera: unknown) => ({ camera, update: updateAoCamera }));

  const pass = vi.fn((_scene: unknown, camera: unknown) => {
    constructionCamera = camera;
    const scenePass = {
      camera,
      compileAsync: vi.fn(async () => {
        const previousMrt = rendererState.mrt;
        const previousTarget = rendererState.target;
        rendererState.mrt = { camera };
        rendererState.target = { camera };
        await new Promise<void>((resolve, reject) => {
          compileSettlers.push({ resolve, reject });
        });
        rendererState.mrt = previousMrt;
        rendererState.target = previousTarget;
      }),
      setup: vi.fn(),
      updateBefore: vi.fn(() => {
        const previousMrt = rendererState.mrt;
        const previousTarget = rendererState.target;
        rendererState.mrt = { camera };
        rendererState.target = { camera };
        prewarm();
        rendererState.mrt = previousMrt;
        rendererState.target = previousTarget;
      }),
      dispose: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Three.js API method.
      setMRT: vi.fn(),
      getTexture: vi.fn(() => normalTexture),
      getTextureNode: vi.fn((name: string) => {
        if (name === 'depth') {
          return depthNode;
        }
        if (name === 'normal') {
          return normalNode;
        }
        return colorNode;
      }),
    };
    scenePasses.push(scenePass);
    return scenePass;
  });

  const ao = vi.fn((): MockAoNode => {
    const node: MockAoNode = {
      resolutionScale: 1,
      useTemporalFiltering: true,
      radius: { value: 0 },
      thickness: { value: 0 },
      samples: { value: 0 },
      distanceFallOff: { value: 0 },
      scale: { value: 0, greaterThan: (value: number) => ({ intensityAbove: value }) },
      getTextureNode: vi.fn(() => aoTexture),
      dispose: aoDispose,
      _noiseNode: { value: { dispose: noiseDispose } },
    };
    aoNodes.push(node);
    return node;
  });

  return {
    denoise: vi.fn(() => ({
      visibility: vi.fn(() => ({ kind: 'coarse-ao-r' })),
      upsample: vi.fn(() => ({ kind: 'denoised-ao-r' })),
      step: { value: { set: vi.fn() } },
      depthPhi: { value: 1 },
    })),
    ao,
    aoDispose,
    noiseDispose,
    aoNodes,
    aoTexture,
    clearDepth,
    colorNode,
    compileAsync,
    compileSettlers,
    createGtaoCameraAdapter,
    depthNode,
    displayUniforms,
    fxaa: vi.fn((value: unknown) => value),
    mix: vi.fn((beauty: unknown, aoOnly: unknown, factor: unknown) => ({ beauty, aoOnly, factor })),
    getFrame: () => frame,
    getFinalFrame: () => finalFrame,
    setFinalFrame: (callback: typeof frame) => {
      finalFrame = callback;
    },
    getCurrentViewport,
    getRetarget: () => retarget,
    getRestoreDepth: () => restoreDepth,
    gl,
    glRender,
    invalidate,
    normalNode,
    normalTexture,
    orthographicCamera,
    pass,
    perspectiveCamera,
    outputQuads,
    prewarm,
    postDispose,
    antialiasDispose,
    antialiasTargetDispose: vi.fn(),
    antialiasMaterialDispose: vi.fn(),
    antialiasTargetOptions: vi.fn(),
    denoiseSize: vi.fn(),
    rig,
    scene,
    snapshot,
    scenePasses,
    rendererState,
    renderOutput,
    state,
    setFrame: (callback: typeof frame) => {
      frame = callback;
    },
    setRetarget: (callback: typeof retarget) => {
      retarget = callback;
      callback?.(rig.activeCamera, snapshot);
    },
    setRestoreDepth: (callback: typeof restoreDepth) => {
      restoreDepth = callback;
    },
    setRenderTarget,
    takeConstructionCamera: () => constructionCamera,
    updateAoCamera,
  };
});

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: Parameters<typeof mocks.setFrame>[0], priority: number) => {
    if (priority === 1) {
      mocks.setFrame(callback);
    } else if (priority === 3.5) {
      mocks.setFinalFrame(callback);
    }
  },
  useThree: () => mocks.state,
}));

vi.mock('#hooks/use-graphics.jsx', () => ({
  useCameraRig: () => mocks.rig,
  useRenderFrame: () => mocks.rig.renderFrame,
  useCameraRetarget: (callback: (camera: typeof mocks.perspectiveCamera, snapshot: typeof mocks.snapshot) => void) => {
    useLayoutEffect(() => {
      mocks.setRetarget(callback);
    }, [callback]);
  },
}));

vi.mock('#graphics/three/scene-overlay.jsx', () => ({
  useOverlayDepthRestore: (callback: () => void) => {
    mocks.setRestoreDepth(callback);
  },
}));

vi.mock('#graphics/three/fxaa.js', () => ({ createViewportFxaa: mocks.fxaa }));
vi.mock('three/addons/tsl/display/GTAONode.js', () => ({ ao: mocks.ao }));
vi.mock('#graphics/three/ao-normal.js', () => ({
  encodeAoNormal: (normal: unknown) => normal,
  sampleAoNormal: (encoded: unknown) => encoded,
}));
vi.mock('#graphics/three/ao-denoise.js', () => ({ createAoDenoise: mocks.denoise }));
vi.mock('#graphics/three/gtao-depth-camera.js', () => ({
  createGtaoCameraAdapter: mocks.createGtaoCameraAdapter,
}));

vi.mock('three/tsl', () => ({
  texture: (value: unknown) => ({ kind: 'frame-texture', value }),
  colorSpaceToWorking: (value: unknown) => value,
  workingToColorSpace: (value: unknown) => value,
  // oxlint-disable-next-line eslint/max-params -- Match the native RTT factory signature.
  rtt: (value: Record<string, unknown>, width: unknown, height: unknown, options: unknown) => {
    mocks.antialiasTargetOptions(width, height, options);
    return Object.assign(value, {
      width,
      height,
      sample: vi.fn(() => ({ r: { kind: 'filtered-ao-r' } })),
      setSize: (nextWidth: number, nextHeight: number) => {
        mocks.denoiseSize(nextWidth, nextHeight);
        Object.assign(value, { width: nextWidth, height: nextHeight });
      },
      dispose: mocks.antialiasDispose,
      renderTarget: { dispose: mocks.antialiasTargetDispose },
      _quadMesh: { material: { dispose: mocks.antialiasMaterialDispose } },
    });
  },
  colorToDirection: vi.fn((value: unknown): unknown => value),
  directionToColor: vi.fn((value: unknown): unknown => value),
  float: vi.fn((value: number) => value),
  mrt: vi.fn((value: unknown): unknown => value),
  mix: mocks.mix,
  normalView: { kind: 'normal-view' },
  output: { kind: 'output' },
  pass: mocks.pass,
  renderOutput: mocks.renderOutput,
  sample: vi.fn((mapper: unknown) => ({ mapper })),
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Three.js TSL export.
  screenUV: { kind: 'screen-uv' },
  vec3: vi.fn((value: unknown): unknown => value),
  vec4: vi.fn((...values: unknown[]): unknown[] => values),
  uniform: vi.fn((value: number) => {
    const node = { value, equal: (other: number) => ({ other }) };
    mocks.displayUniforms.push(node);
    return node;
  }),
  select: vi.fn((condition: unknown, ifTrue: unknown, ifFalse: unknown) => ({ condition, ifTrue, ifFalse })),
}));

vi.mock('three/webgpu', () => {
  class NodeMaterial {
    public colorWrite = true;
    public depthNode: unknown;
    public depthTest = true;
    public depthWrite = false;
    public fragmentNode: unknown;
    public dispose = vi.fn();
  }

  class QuadMesh {
    public readonly camera = { kind: 'quad-camera' };
    public readonly endpointCamera = mocks.takeConstructionCamera();
    // oxlint-disable-next-line typescript/parameter-properties -- erasableSyntaxOnly forbids parameter properties.
    public readonly material: NodeMaterial;
    public readonly render = vi.fn((renderer: typeof mocks.gl): void => {
      // An output graph renders its endpoint's scene pass nested inside its own render.
      if (this.material.fragmentNode !== undefined) {
        const scenePass = mocks.scenePasses.find(({ camera }) => camera === this.endpointCamera);
        (scenePass?.updateBefore as (() => void) | undefined)?.();
      }
      renderer.render(this, this.camera);
    });

    public constructor(material: NodeMaterial) {
      this.material = material;
      // Output quads carry a fragment graph; the depth-restore quad only a depth node.
      if (
        material.fragmentNode !== undefined &&
        (material.fragmentNode as { color?: { kind?: string } }).color?.kind !== 'frame-texture'
      ) {
        material.dispose = mocks.postDispose;
        mocks.outputQuads.push(this);
      }
    }
  }

  return { NodeMaterial, QuadMesh, RenderTarget, UnsignedByteType: 1009 };
});

const endpointProperties = { aoAllowed: true, toneMapping: NeutralToneMapping } as const;

const mount = async (
  properties: { aoAllowed?: boolean; settings?: Partial<PostProcessingSettings>; toneMapping?: ToneMapping } = {},
) => {
  const { PostProcessingWebGPU: PostProcessingWebGpu } = await import('#graphics/three/post-processing-webgpu.jsx');
  return render(<PostProcessingWebGpu {...endpointProperties} {...properties} />);
};

const isBeautyOnly = ({ material }: { material: { fragmentNode?: unknown } }): boolean =>
  (material.fragmentNode as { color?: unknown }).color === mocks.colorNode;

describe('PostProcessingWebGPU active endpoint pipeline', () => {
  beforeEach(() => {
    mocks.ao.mockClear();
    mocks.denoise.mockClear();
    mocks.fxaa.mockReset();
    mocks.mix.mockClear();
    mocks.denoiseSize.mockClear();
    mocks.aoDispose.mockClear();
    mocks.noiseDispose.mockClear();
    mocks.aoNodes.length = 0;
    mocks.aoTexture.sample.mockClear();
    mocks.clearDepth.mockClear();
    mocks.colorNode.mul.mockClear();
    mocks.compileAsync.mockClear();
    mocks.createGtaoCameraAdapter.mockClear();
    mocks.compileSettlers.length = 0;
    mocks.displayUniforms.length = 0;
    mocks.glRender.mockReset();
    mocks.gl.isWebGPURenderer = true;
    mocks.gl.autoClear = true;
    mocks.gl.coordinateSystem = 2001;
    mocks.getCurrentViewport.mockClear();
    mocks.invalidate.mockClear();
    mocks.normalNode.sample.mockClear();
    mocks.normalTexture.type = 0;
    mocks.normalTexture.format = 0;
    mocks.pass.mockClear();
    mocks.outputQuads.length = 0;
    mocks.prewarm.mockReset();
    mocks.updateAoCamera.mockClear();
    mocks.rendererState.mrt = null;
    mocks.renderOutput.mockClear();
    mocks.rendererState.target = { kind: 'prior-target' };
    mocks.postDispose.mockClear();
    mocks.antialiasDispose.mockClear();
    mocks.antialiasTargetDispose.mockClear();
    mocks.antialiasMaterialDispose.mockClear();
    mocks.antialiasTargetOptions.mockClear();
    mocks.rig.activeCamera = mocks.perspectiveCamera;
    mocks.state.camera = mocks.perspectiveCamera;
    mocks.state.size.height = 1000;
    mocks.state.size.width = 1500;
    mocks.state.viewport.dpr = 2;
    mocks.scenePasses.length = 0;
    mocks.setFrame(undefined);
    mocks.setFinalFrame(undefined);
    mocks.setRetarget(undefined);
    mocks.setRestoreDepth(undefined);
    mocks.setRenderTarget.mockClear();
  });

  it('should halve display-frame color storage while retaining depth precision', async () => {
    const mounted = await mount();
    mocks.getFrame()?.(mocks.state, 0);
    const target = mocks.gl.getRenderTarget() as RenderTarget;
    expect(target.texture.type).toBe(UnsignedByteType);
    expect(target.texture.colorSpace).toBe(SRGBColorSpace);
    expect(target.depthTexture?.type).toBe(UnsignedInt248Type);
    expect(target.depthTexture?.format).toBe(DepthStencilFormat);
    expect(target.samples).toBe(0);
    expect(target.width).toBe(3000);
    expect(target.height).toBe(2000);
    mounted.unmount();
  });

  it('should retain HDR frame storage for unbounded output and retire it on tone-map changes', async () => {
    const mounted = await mount({ toneMapping: NoToneMapping });
    mocks.getFrame()?.(mocks.state, 0);
    const previous = mocks.gl.getRenderTarget() as RenderTarget;
    const dispose = vi.spyOn(previous, 'dispose');
    expect(previous.texture.type).toBe(HalfFloatType);
    const { PostProcessingWebGPU: PostProcessingWebGpu } = await import('#graphics/three/post-processing-webgpu.jsx');
    mounted.rerender(<PostProcessingWebGpu {...endpointProperties} />);
    mocks.getFrame()?.(mocks.state, 0);
    const current = mocks.gl.getRenderTarget() as RenderTarget;
    expect(current).not.toBe(previous);
    expect(current.texture.type).toBe(UnsignedByteType);
    expect(dispose).toHaveBeenCalledOnce();
    mounted.unmount();
  });

  it('should budget AO in CSS pixels independently of device pixel ratio', async () => {
    const mounted = await mount();
    expect(mocks.antialiasTargetOptions).toHaveBeenCalledWith(1, 1, {
      type: HalfFloatType,
      format: RedFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    expect(mocks.denoiseSize).toHaveBeenCalledWith(750, 500);
    expect(mocks.aoNodes[0]!.resolutionScale).toBe(0.25);
    mocks.denoiseSize.mockClear();
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.denoiseSize).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('should keep AO active without multisampled scene attachments or a native-resolution AA intermediate', async () => {
    const mounted = await mount();
    expect(mocks.pass).toHaveBeenCalledWith(mocks.scene, mocks.perspectiveCamera, { samples: 0 });
    expect(mocks.antialiasTargetOptions).toHaveBeenCalledTimes(1);
    expect(mocks.fxaa).not.toHaveBeenCalled();
    expect(mocks.denoise.mock.results[0]!.value.upsample).not.toHaveBeenCalled();
    expect(mocks.aoNodes[0]!.scale.value).toBeGreaterThan(0);
    mocks.getFrame()?.(mocks.state, 1 / 60);
    expect(mocks.updateAoCamera).toHaveBeenCalled();
    mounted.unmount();
    expect(mocks.antialiasTargetDispose).toHaveBeenCalledOnce();
  });

  it('should resize the AO budget only for CSS size changes and retain it across DPR changes', async () => {
    mocks.state.size.width = 1501;
    mocks.state.size.height = 1001;
    mocks.state.viewport.dpr = 1;
    const mounted = await mount();
    expect(mocks.denoiseSize).toHaveBeenLastCalledWith(751, 501);
    expect(mocks.aoNodes[0]!.resolutionScale).toBe(0.5);
    mocks.denoiseSize.mockClear();
    mocks.state.viewport.dpr = 2;
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.aoNodes[0]!.resolutionScale).toBe(0.25);
    expect(mocks.denoiseSize).not.toHaveBeenCalled();
    mocks.state.size.width = 2560;
    mocks.state.size.height = 1440;
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.denoiseSize).toHaveBeenCalledOnce();
    expect(mocks.denoiseSize).toHaveBeenLastCalledWith(1280, 720);
    expect(mocks.pass).toHaveBeenCalledOnce();
    expect(mocks.aoNodes).toHaveLength(1);
    mounted.unmount();
  });

  it('should denoise contact visibility before compositing without allocating another noise texture', async () => {
    const mounted = await mount();
    expect(mocks.denoise).toHaveBeenCalledOnce();
    expect(mocks.denoise).toHaveBeenCalledWith({
      texture: mocks.aoTexture,
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
      depth: expect.anything(),
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
      normal: expect.anything(),
      camera: mocks.perspectiveCamera,
    });
    const composed = mocks.outputQuads.find((quad) => !isBeautyOnly(quad));
    expect(composed?.material.fragmentNode).toMatchObject({
      aoOnly: [
        { condition: { intensityAbove: 0 }, ifTrue: { kind: 'filtered-ao-r' }, ifFalse: 1 },
        { kind: 'scene-alpha' },
      ],
    });
    expect(mocks.denoise.mock.results[0]!.value.step.value.set).toHaveBeenCalledWith(3 / 1500, 3 / 1000);
    mounted.unmount();
    expect(mocks.noiseDispose).toHaveBeenCalledOnce();
  });

  it('should prepare only the active beauty endpoint when AO is disabled', async () => {
    await mount({ aoAllowed: false });
    expect(mocks.pass).toHaveBeenCalledTimes(1);
    expect(mocks.pass).toHaveBeenCalledWith(mocks.scene, mocks.perspectiveCamera, { samples: 0 });
    expect(mocks.ao).not.toHaveBeenCalled();
    expect(mocks.denoise).not.toHaveBeenCalled();
    expect(mocks.scenePasses[0]!.setMRT).not.toHaveBeenCalled();
    expect(mocks.compileAsync).not.toHaveBeenCalled();
    expect(mocks.glRender).not.toHaveBeenCalled();
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.outputQuads[0]!.render).toHaveBeenCalledOnce();
    expect(isBeautyOnly(mocks.outputQuads[0]!)).toBe(true);
  });

  it('should retain scene depth for overlays without a final antialias target', async () => {
    await mount();
    expect(mocks.antialiasTargetOptions).not.toHaveBeenCalledWith(null, null, expect.anything());
    mocks.getFrame()?.(mocks.state, 0);
    mocks.glRender.mockClear();
    mocks.getRestoreDepth()?.();
    expect(mocks.glRender).not.toHaveBeenCalled();
  });

  it('should create each projection on demand without retaining the inactive graph', async () => {
    const mounted = await mount();
    mocks.getFrame()?.(mocks.state, 0);
    const firstPass = mocks.scenePasses[0]!;
    act(() => mocks.getRetarget()?.(mocks.orthographicCamera, mocks.snapshot));
    expect(firstPass.dispose).toHaveBeenCalledOnce();
    expect(mocks.antialiasTargetDispose).toHaveBeenCalledTimes(1);
    expect(mocks.noiseDispose).toHaveBeenCalledOnce();
    expect(mocks.pass).toHaveBeenCalledTimes(1);
    mocks.getFrame()?.(mocks.state, 0);
    const secondPass = mocks.scenePasses[1]!;
    act(() => mocks.getRetarget()?.(mocks.orthographicCamera, mocks.snapshot));
    expect(secondPass.dispose).not.toHaveBeenCalled();
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.pass).toHaveBeenCalledTimes(2);
    act(() => mocks.getRetarget()?.(mocks.perspectiveCamera, mocks.snapshot));
    expect(secondPass.dispose).toHaveBeenCalledOnce();
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.pass).toHaveBeenCalledTimes(3);
    expect(mocks.ao).toHaveBeenCalledTimes(3);
    expect(mocks.compileAsync).not.toHaveBeenCalled();
    mounted.unmount();
    for (const pass of mocks.scenePasses) {
      expect(pass.dispose).toHaveBeenCalledOnce();
    }
    expect(mocks.antialiasTargetDispose).toHaveBeenCalledTimes(3);
    expect(mocks.noiseDispose).toHaveBeenCalledTimes(3);
  });

  it('restores the selected scene-pass depth with one direct fullscreen draw', async () => {
    await mount({ aoAllowed: false });
    mocks.glRender.mockClear();
    mocks.glRender.mockImplementationOnce(() => {
      expect(mocks.gl.autoClear).toBe(false);
    });
    mocks.getRestoreDepth()?.();
    expect(mocks.gl.autoClear).toBe(true);
    expect(mocks.glRender).toHaveBeenCalledOnce();
    expect(mocks.clearDepth).not.toHaveBeenCalled();
    expect(mocks.gl.getRenderTarget()).toEqual({ kind: 'prior-target' });
    expect(mocks.gl.getMRT()).toBeNull();
  });

  it.each([true, false])(
    'should restore the target and autoClear=%s when depth submission throws',
    async (autoClear) => {
      await mount({ aoAllowed: false });
      mocks.gl.autoClear = autoClear;
      mocks.glRender.mockImplementationOnce(() => {
        expect(mocks.gl.autoClear).toBe(false);
        throw new Error('draw failed');
      });
      expect(() => mocks.getRestoreDepth()?.()).toThrow('draw failed');
      expect(mocks.gl.autoClear).toBe(autoClear);
      expect(mocks.gl.getRenderTarget()).toEqual({ kind: 'prior-target' });
    },
  );

  it('keeps beauty ahead of AO dependencies and preserves its alpha in the AO visualization', async () => {
    await mount();
    expect(mocks.updateAoCamera).toHaveBeenCalledOnce();
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.aoNodes).toHaveLength(1);
    const composed = mocks.outputQuads.find((quad) => !isBeautyOnly(quad));
    expect(composed?.material.fragmentNode).toMatchObject({
      beauty: { kind: 'display-composed-color', color: { kind: 'composed-color' } },
      aoOnly: [
        { condition: { intensityAbove: 0 }, ifTrue: { kind: 'filtered-ao-r' }, ifFalse: 1 },
        { kind: 'scene-alpha' },
      ],
    });
    expect(mocks.scenePasses[0]!.setMRT).toHaveBeenCalledWith({
      output: { kind: 'output' },
      normal: { kind: 'normal-view' },
    });
    expect(mocks.normalTexture.type).toBe(1009);
    expect(mocks.normalTexture.format).toBe(1030);
    expect(mocks.aoNodes[0]).toMatchObject({
      resolutionScale: 0.25,
      useTemporalFiltering: false,
      samples: { value: 8 },
    });
    expect(mocks.aoNodes[0]!.radius.value).toBeCloseTo(0.3605551275, 9);
    expect(mocks.updateAoCamera).toHaveBeenCalledTimes(2);
  });

  it('uses hardware-filtered RGBA8 normals on the node WebGL2 backend', async () => {
    mocks.gl.coordinateSystem = 2000;
    await mount();
    expect(mocks.normalTexture.type).toBe(1009);
    expect(mocks.normalTexture.format).toBe(1023);
  });

  it('updates AO output and estimator uniforms without rebuilding the production graph', async () => {
    const mounted = await mount();
    const { PostProcessingWebGPU: PostProcessingWebGpu } = await import('#graphics/three/post-processing-webgpu.jsx');
    const invalidationsBeforeSettings = mocks.invalidate.mock.calls.length;
    mounted.rerender(
      <PostProcessingWebGpu
        {...endpointProperties}
        settings={{ gtaoIntensity: 2, gtaoDistanceFalloff: 0.4, displayMode: 'ao', aoCompositeStage: 'display' }}
      />,
    );
    // Demand rendering must receive current uniforms before the next frame is submitted.
    expect(mocks.aoNodes[0]!.scale.value).toBe(2);
    expect(mocks.aoNodes[0]!.distanceFallOff.value).toBe(0.4);
    expect(mocks.displayUniforms.map(({ value }) => value)).toEqual([1, 1]);
    expect(mocks.invalidate.mock.calls.length).toBeGreaterThan(invalidationsBeforeSettings);
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.pass).toHaveBeenCalledTimes(1);
    expect(mocks.aoNodes[0]!.scale.value).toBe(2);
    expect(mocks.aoNodes[0]!.distanceFallOff.value).toBe(0.4);
    expect(mocks.displayUniforms.map(({ value }) => value)).toEqual([1, 1]);
  });

  it('should replace and dispose AO resources on toggles while beauty-only owns no AO graph', async () => {
    const mounted = await mount({ aoAllowed: false });
    const { PostProcessingWebGPU: PostProcessingWebGpu } = await import('#graphics/three/post-processing-webgpu.jsx');
    mounted.rerender(<PostProcessingWebGpu {...endpointProperties} />);
    expect(mocks.scenePasses[0]!.dispose).toHaveBeenCalledOnce();
    expect(mocks.aoNodes).toHaveLength(1);
    mounted.rerender(<PostProcessingWebGpu {...endpointProperties} settings={{ displayMode: 'no-ao' }} />);
    expect(mocks.aoDispose).toHaveBeenCalledOnce();
    expect(mocks.antialiasTargetDispose).toHaveBeenCalledTimes(1);
    expect(mocks.antialiasMaterialDispose).toHaveBeenCalledTimes(1);
    expect(mocks.noiseDispose).toHaveBeenCalledOnce();
    expect(mocks.aoNodes).toHaveLength(1);
    expect(mocks.scenePasses[2]!.setMRT).not.toHaveBeenCalled();
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.outputQuads.at(-1)!.render).toHaveBeenCalledOnce();
  });

  it('should tone-map the scene once in linear light and leave the sRGB encode to the output pass', async () => {
    await mount({ aoAllowed: false });
    expect(mocks.renderOutput).toHaveBeenCalledTimes(2);
    expect(mocks.renderOutput).toHaveBeenCalledWith(mocks.colorNode, NeutralToneMapping, 'srgb-linear');
    expect(mocks.renderOutput).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'frame-texture' }),
      NoToneMapping,
      SRGBColorSpace,
    );
  });

  it('should retain one linear stencil frame through overlays and encode only at frame completion', async () => {
    const mounted = await mount();
    const destination = mocks.gl.getRenderTarget();
    mocks.getFrame()?.(mocks.state, 0);
    const target = mocks.gl.getRenderTarget() as RenderTarget;
    expect(target).toBeInstanceOf(RenderTarget);
    expect([target.width, target.height, target.samples, target.stencilBuffer]).toEqual([3000, 2000, 0, true]);
    expect(target.texture.colorSpace).toBe(SRGBColorSpace);
    const dispose = vi.spyOn(target, 'dispose');
    const { material } = mocks.outputQuads[0]!;
    expect(material).toMatchObject({ depthWrite: true, depthNode: { kind: 'sampled-depth' } });
    mocks.glRender.mockClear();
    mocks.getRestoreDepth()?.();
    expect(mocks.glRender).not.toHaveBeenCalled();
    mocks.glRender.mockImplementationOnce(() => {
      expect(mocks.gl.getRenderTarget()).toBe(destination);
      expect(mocks.gl.outputColorSpace).toBe('srgb-linear');
    });
    mocks.getFinalFrame()?.(mocks.state, 0);
    expect(mocks.glRender).toHaveBeenCalledOnce();
    expect(mocks.gl.outputColorSpace).toBe('srgb');
    expect(mocks.gl.getRenderTarget()).toBe(destination);
    mocks.getFrame()?.(mocks.state, 0);
    expect(mocks.gl.getRenderTarget()).toBe(target);
    mounted.unmount();
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.gl.getRenderTarget()).toBe(destination);
  });

  it('should restore output state when final encoding fails and recover the following frame', async () => {
    const mounted = await mount();
    const destination = mocks.gl.getRenderTarget();
    mocks.getFrame()?.(mocks.state, 0);
    mocks.glRender.mockImplementationOnce(() => {
      throw new Error('encoding failed');
    });
    expect(() => mocks.getFinalFrame()?.(mocks.state, 0)).toThrow('encoding failed');
    expect(mocks.gl.getRenderTarget()).toBe(destination);
    expect(mocks.gl.outputColorSpace).toBe('srgb');
    expect(mocks.gl.autoClear).toBe(true);
    mocks.getFrame()?.(mocks.state, 0);
    mocks.getFinalFrame()?.(mocks.state, 0);
    expect(mocks.gl.getRenderTarget()).toBe(destination);
    mounted.unmount();
  });

  it('should guard the upstream implementations whose owned resources require explicit disposal', () => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve('three/src/nodes/utils/RTTNode.js'), 'utf8');
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      'f87704938524dc419b91d9dd29c89d53272c78819d17537780a1c3b7e42c921b',
    );
    const aoSource = readFileSync(require.resolve('three/addons/tsl/display/GTAONode.js'), 'utf8');
    expect(createHash('sha256').update(aoSource).digest('hex')).toBe(
      '2786bf04e0a166e11d18153f0e26776792701c2294b9b1a9fb93ced6a22f148c',
    );
  });

  it('should dispose every demanded endpoint once on unmount', async () => {
    const mounted = await mount();
    act(() => mocks.getRetarget()?.(mocks.orthographicCamera, mocks.snapshot));
    mocks.getFrame()?.(mocks.state, 0);
    mounted.unmount();
    for (const pass of mocks.scenePasses) {
      expect(pass.dispose).toHaveBeenCalledOnce();
    }
    expect(mocks.aoDispose).toHaveBeenCalledTimes(2);
    expect(mocks.antialiasDispose).toHaveBeenCalledTimes(2);
    expect(mocks.antialiasTargetDispose).toHaveBeenCalledTimes(2);
    expect(mocks.antialiasMaterialDispose).toHaveBeenCalledTimes(2);
    expect(mocks.noiseDispose).toHaveBeenCalledTimes(2);
    expect(mocks.postDispose).toHaveBeenCalledTimes(2);
  });

  it('should release partial resources when graph construction fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.ao.mockImplementationOnce(() => {
      throw new Error('AO failed');
    });
    const mounted = await mount();
    expect(mocks.scenePasses[0]!.dispose).toHaveBeenCalledOnce();
    expect(mocks.postDispose).not.toHaveBeenCalled();
    mounted.unmount();
    expect(mocks.scenePasses[0]!.dispose).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('should release allocated AO and RTT resources when composition construction fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.mix.mockImplementationOnce(() => {
      throw new Error('Composition failed');
    });
    const mounted = await mount();
    expect(mocks.antialiasTargetDispose).toHaveBeenCalledTimes(1);
    expect(mocks.antialiasMaterialDispose).toHaveBeenCalledTimes(1);
    expect(mocks.noiseDispose).toHaveBeenCalledOnce();
    expect(mocks.aoDispose).toHaveBeenCalledOnce();
    expect(mocks.scenePasses[0]!.dispose).toHaveBeenCalledOnce();
    mounted.unmount();
    expect(mocks.antialiasTargetDispose).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('does not construct resources for a non-WebGPU renderer', async () => {
    mocks.gl.isWebGPURenderer = false;
    await mount();
    expect(mocks.pass).not.toHaveBeenCalled();
    mocks.gl.isWebGPURenderer = true;
  });
});
