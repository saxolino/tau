import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { toRenderPoint } from '@taucad/spatial';
import type { RenderFrame } from '@taucad/spatial';
import type { DirectEditTool } from '@taucad/viewer/cad/direct-edit-tool';
import {
  createDirectEditGhost,
  directEditEdgeGeometry,
  directEditEdges,
  directEditPreviewMatrix,
  pickDirectEditEdge,
} from '#graphics/three/react/direct-edit-geometry.js';
import { setModelComponentOwner } from '#graphics/three/utils/model-component-owner.js';
import { ensureBvh } from '#graphics/three/utils/bvh-cache.js';

const allocated: Array<{ dispose: () => void }> = [];
afterEach(() => {
  for (const item of allocated.splice(0)) {
    item.dispose();
  }
  vi.restoreAllMocks();
});
const own = <T extends { dispose: () => void }>(item: T): T => {
  allocated.push(item);
  return item;
};
const frame: RenderFrame = { anchorFrameId: 'tau:root', originMeters: [1000, -2000, 3000], metersPerRenderUnit: 0.001 };
const tool: DirectEditTool = {
  mode: 'translate',
  onPick: () => undefined,
  onPreview: () => undefined,
  onCommit: () => undefined,
  onCancel: () => undefined,
};

function fixture() {
  const scene = new Group();
  const geometry = own(
    new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3),
    ),
  );
  const line = new LineSegments(geometry, own(new LineBasicMaterial()));
  setModelComponentOwner(line, { componentId: 'body', unitId: 'unit' });
  line.userData['measurementFeatures'] = {
    kind: 'line',
    componentId: 'body',
    edges: [
      { id: 'edge:93', start: 0, count: 2 },
      { id: 'edge:104', start: 2, count: 2 },
    ],
  };
  scene.add(line);
  return { scene, line };
}

describe('native direct editing geometry', () => {
  it('should consume the explicit public contract and translate model metres in a floating frame', () => {
    expect(tool.mode).toBe('translate');
    const matrix = directEditPreviewMatrix({ type: 'translate', delta: [0.003, -0.002, 0.001] }, frame);
    expect(new Vector3(10, 20, 30).applyMatrix4(matrix).toArray()).toEqual([13, 18, 31]);
  });
  it('should rotate and uniformly scale around the unposed native model pivot', () => {
    const origin = [1000.005, -2000, 3000] as const;
    const pivot = new Vector3(...toRenderPoint({ renderFrame: frame, point: origin }));
    const rotated = pivot
      .clone()
      .add(new Vector3(2, 0, 0))
      .applyMatrix4(
        directEditPreviewMatrix({ type: 'rotate', axis: [0, 0, 1], origin, angleRadians: Math.PI / 2 }, frame),
      );
    expect(rotated.x).toBeCloseTo(pivot.x);
    expect(rotated.y).toBeCloseTo(2);
    expect(rotated.z).toBeCloseTo(pivot.z);
    expect(
      pivot
        .clone()
        .add(new Vector3(1, 2, 3))
        .applyMatrix4(directEditPreviewMatrix({ type: 'scale', origin, factor: 2 }, frame))
        .sub(pivot)
        .toArray(),
    ).toEqual([2, 4, 6]);
  });
  it('should preserve occurrence edge IDs and highlight only the chosen edge without mutating source geometry', () => {
    const { scene, line } = fixture();
    line.position.set(3, 4, 5);
    const edges = directEditEdges(scene);
    expect(edges.map(({ edgeId, a, b }) => ({ edgeId, a: a.toArray(), b: b.toArray() }))).toEqual([
      { edgeId: 93, a: [2, 4, 5], b: [4, 4, 5] },
      { edgeId: 104, a: [2, 5, 5], b: [4, 5, 5] },
    ]);
    const highlight = own(directEditEdgeGeometry(edges, 'body', [104]));
    expect([...highlight.getAttribute('position').array]).toEqual([2, 5, 5, 4, 5, 5]);
    expect([...line.geometry.getAttribute('position').array]).toEqual([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]);
  });
  it('should reject an occluded native edge and leave visible occurrence picking intact', async () => {
    const { scene } = fixture();
    const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    const edges = directEditEdges(scene);
    const options = { edges, raycaster, camera, height: 200, meshes: [] as Mesh[], clipping: undefined };
    expect(pickDirectEditEdge(options)).toMatchObject({ componentId: 'body', edgeId: 93 });
    const blocker = new Mesh(own(new BoxGeometry(3, 3, 1)), own(new MeshBasicMaterial()));
    blocker.position.z = 2;
    blocker.updateMatrixWorld();
    await ensureBvh(blocker.geometry);
    expect(pickDirectEditEdge({ ...options, meshes: [blocker] })).toBeUndefined();
    blocker.visible = false;
    expect(pickDirectEditEdge({ ...options, meshes: [blocker] })).toMatchObject({ edgeId: 93 });
  });
  it('should dispose only allocated ghost resources and retain original mesh transforms and material', () => {
    const scene = new Group();
    const material = own(new MeshBasicMaterial());
    const geometry = own(new BoxGeometry());
    const mesh = new Mesh(geometry, material);
    mesh.position.set(1, 2, 3);
    setModelComponentOwner(mesh, { componentId: 'body', unitId: 'unit' });
    scene.add(mesh);
    const sourceGeometryDisposed = vi.spyOn(geometry, 'dispose');
    const sourceMaterialDisposed = vi.spyOn(material, 'dispose');
    const ghost = createDirectEditGhost(scene, 'body');
    const cloned = ghost.group.children[0] as Mesh;
    expect(cloned.geometry).toBe(geometry);
    expect(cloned.material).not.toBe(material);
    expect(cloned.matrix.elements[12]).toBe(1);
    ghost.group.matrix.makeTranslation(5, 0, 0);
    ghost.dispose();
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh.material).toBe(material);
    expect(sourceGeometryDisposed).not.toHaveBeenCalled();
    expect(sourceMaterialDisposed).not.toHaveBeenCalled();
  });
});
