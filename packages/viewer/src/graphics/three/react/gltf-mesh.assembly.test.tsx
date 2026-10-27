import { useLayoutEffect } from 'react';
import type { RenderFrame } from '@taucad/spatial';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeGlb } from '@taucad/geometry-core';
import type { GlbMaterial } from '@taucad/geometry-core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { PerspectiveCamera } from 'three';
import type { Mesh, Object3D } from 'three';
import { createModelAssembly } from '#graphics/three/react/model-assembly.js';

const mocks = vi.hoisted(() => {
  const sceneBounds = { min: [-20, -10, -5], max: [20, 10, 5] };
  return {
    noHoveredComponentIds: [] as readonly string[],
    camera: { name: 'perspective' },
    cameraRig: {
      actorRef: {
        getSnapshot: () => ({ context: { view: { bounds: sceneBounds } } }),
        send: vi.fn(),
      },
      perspectiveCamera: { name: 'perspective', coordinateSystem: undefined, updateProjectionMatrix: vi.fn() },
      orthographicCamera: { name: 'orthographic', coordinateSystem: undefined, updateProjectionMatrix: vi.fn() },
    },
    graphicsActor: {
      send: vi.fn(),
      getSnapshot: () => ({
        context: {
          modelPointerClickSuppressionReasons: [],
          suppressNextModelPointerClick: false,
          viewerHoverSuppressionReasons: [] as string[],
        },
      }),
    },
    gl: Object.create(null) as { compileAsync?: ReturnType<typeof vi.fn>; coordinateSystem?: number },
    frameCallbacks: [] as Array<(state: unknown) => void>,
    invalidate: vi.fn(),
    size: { height: 600, width: 800 },
    rootScene: { name: 'viewport-lighting-scene' },
    modelUnit: {
      focusedComponentId: undefined as string | undefined,
      hiddenComponentIds: [] as readonly string[],
      hoveredComponentId: undefined,
      isolatedComponentIds: [] as readonly string[],
      manifest: undefined,
      opacityByComponentId: {},
      selectedComponentIds: [] as readonly string[],
    },
    renderFrame: {
      anchorFrameId: 'tau:root',
      originMeters: [0, 0, 0] as [number, number, number],
      metersPerRenderUnit: 1,
    },
    sectionView: { isActive: false },
  };
});

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown) => void) => {
    mocks.frameCallbacks.push(callback);
  },
  useThree: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      camera: mocks.camera,
      controls: undefined,
      gl: mocks.gl,
      invalidate: mocks.invalidate,
      scene: mocks.rootScene,
      size: mocks.size,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('#graphics/three/three-graphics-backend-context.jsx', () => ({
  useThreeGraphicsBackend: () => 'webgl',
}));

vi.mock('#hooks/use-graphics.jsx', () => ({
  useCameraRig: () => mocks.cameraRig,
  useGraphics: () => mocks.graphicsActor,
  useGraphicsSelector: () => false,
  useRenderFrame: () => mocks.renderFrame,
  useRenderFrameRetarget: (handler: (frame: RenderFrame) => void) => {
    useLayoutEffect(() => {
      handler(mocks.renderFrame);
    }, [handler]);
  },
  useModelInteractionRef: () => mocks.graphicsActor,
  useModelInteractionSelector: (selector: (state: { context: Record<string, unknown> }) => unknown) =>
    selector({ context: {} }),
  useKinematicsSelector: () => mocks.noHoveredComponentIds,
}));

vi.mock('#machines/model-interaction.machine.js', () => ({
  deriveModelInteractionUnitId: ({ geometryHash }: { geometryHash?: string }) => `unit:${geometryHash ?? ''}`,
  getModelInteractionUnitState: () => mocks.modelUnit,
}));

vi.mock('#graphics/three/use-section-view.js', () => ({
  resolveSectionViewRaycastClip: () => undefined,
  useSectionViewFlags: () => mocks.sectionView,
}));

vi.mock('#graphics/three/react/kinematics-viewer.js', () => ({
  useKinematicsViewer: () => () => undefined,
}));

const { GltfMesh } = await import('#graphics/three/react/gltf-mesh.jsx');

const surfaceMaterial: GlbMaterial = {
  doubleSided: false,
  alphaMode: 'OPAQUE',
  pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1], metallicFactor: 0.1, roughnessFactor: 0.8 },
};

/** Three pieces side by side along X, as a buckle's frame, bar and pin. */
function buildGlb(): Uint8Array<ArrayBuffer> {
  return writeGlb({
    nodes: ['Telaio', 'Traversa', 'Ardiglione'].map((name, index) => ({
      name,
      primitives: [
        {
          mode: 4,
          positions: Float32Array.from([index * 4, 0, 0, index * 4 + 1, 0, 0, index * 4, 1, 0]),
          normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          indices: Uint32Array.from([0, 1, 2]),
          material: surfaceMaterial,
        },
      ],
    })),
  });
}

function surfaceOf(scene: Object3D, name: string): Mesh {
  let found: Mesh | undefined;
  scene.getObjectByName(name)?.traverse((object) => {
    if (!found && object.type === 'Mesh') {
      found = object as Mesh;
    }
  });
  if (!found) {
    throw new Error(`Expected a surface mesh under ${name}.`);
  }
  return found;
}

const committed = (): number =>
  mocks.graphicsActor.send.mock.calls.filter(
    (call) => (call[0] as { type: string }).type === 'gltfPresentationCommitted',
  ).length;

async function presentedScene(parseAsync: { mock: { results: Array<{ value: unknown }> } }): Promise<Object3D> {
  await waitFor(() => {
    expect(committed()).toBe(1);
  });
  await act(async () => undefined);
  const gltf = (await parseAsync.mock.results[0]?.value) as GLTF | undefined;
  if (!gltf) {
    throw new Error('Expected a parsed glTF.');
  }
  return gltf.scene;
}

const visibility = (scene: Object3D): boolean[] =>
  ['Telaio', 'Traversa', 'Ardiglione'].map((name) => surfaceOf(scene, name).visible);

describe('GltfMesh assembly', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.graphicsActor.send.mockClear();
    mocks.invalidate.mockClear();
    mocks.frameCallbacks = [];
    mocks.modelUnit = { ...mocks.modelUnit, selectedComponentIds: [] };
  });

  it('should draw only the first piece of an armed first model before its first frame', async () => {
    const parseAsync = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    const assembly = createModelAssembly();
    assembly.arm({ key: 'turn', stepMilliseconds: 60_000, holdMilliseconds: 60_000 });

    render(<GltfMesh gltfFile={buildGlb()} geometryHash='a' enableMatcap={false} assembly={assembly} />);
    const scene = await presentedScene(parseAsync);

    expect(visibility(scene)).toEqual([true, false, false]);
    act(() => {
      assembly.finish();
    });
    expect(visibility(scene)).toEqual([true, true, true]);
    assembly.dispose();
  });

  it('should draw the whole model when the assembly is not armed', async () => {
    const parseAsync = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    const assembly = createModelAssembly();

    render(<GltfMesh gltfFile={buildGlb()} geometryHash='a' enableMatcap={false} assembly={assembly} />);
    const scene = await presentedScene(parseAsync);

    expect(visibility(scene)).toEqual([true, true, true]);
    expect(assembly.getSnapshot().run).toBeUndefined();
  });

  it('should measure where each entered piece sits on the canvas', async () => {
    const parseAsync = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    const assembly = createModelAssembly();
    assembly.arm({ key: 'turn', stepMilliseconds: 0, holdMilliseconds: 60_000 });
    render(<GltfMesh gltfFile={buildGlb()} geometryHash='a' enableMatcap={false} assembly={assembly} />);
    await presentedScene(parseAsync);
    const camera = new PerspectiveCamera(50, 800 / 600, 0.1, 100);
    camera.position.set(4.5, 0.5, 20);
    camera.lookAt(4.5, 0.5, 0);
    camera.updateMatrixWorld();

    for (const frame of mocks.frameCallbacks) {
      frame({ camera, size: { width: 800, height: 600 } });
    }

    const { run } = assembly.getSnapshot();
    const [telaio, traversa, ardiglione] = run?.componentIds ?? [];
    const anchors = run?.anchors ?? {};
    expect(run?.canvas).toEqual({ width: 800, height: 600 });
    expect(anchors[telaio ?? '']?.x).toBeLessThan(anchors[traversa ?? '']?.x ?? 0);
    expect(anchors[traversa ?? '']?.x).toBeLessThan(anchors[ardiglione ?? '']?.x ?? 0);
    expect(anchors[traversa ?? '']?.y).toBeCloseTo(300, 0);
    assembly.dispose();
  });

  it('should draw a hidden piece at once when it is selected', async () => {
    const parseAsync = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    const assembly = createModelAssembly();
    assembly.arm({ key: 'turn', stepMilliseconds: 60_000, holdMilliseconds: 60_000 });
    const view = render(<GltfMesh gltfFile={buildGlb()} geometryHash='a' enableMatcap={false} assembly={assembly} />);
    const scene = await presentedScene(parseAsync);
    const hidden = assembly.hiddenComponentIds();

    mocks.modelUnit = { ...mocks.modelUnit, selectedComponentIds: [hidden[1] ?? ''] };
    view.rerender(<GltfMesh gltfFile={buildGlb()} geometryHash='a' enableMatcap={false} assembly={assembly} />);

    expect(visibility(scene)).toEqual([true, true, true]);
    expect(assembly.getSnapshot().run).toBeUndefined();
  });
});
