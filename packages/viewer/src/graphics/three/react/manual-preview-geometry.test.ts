import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import {
  edgeTubeGeometry,
  faceOutlinePositions,
  facePrismGeometry,
  holeGeometry,
  planarFaceTriangles,
  prismScaleMatrix,
} from '#graphics/three/react/manual-preview-geometry.js';

/** A unit square in the XY plane at z = 0, as two triangles. */
const square = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);

describe('manual preview geometry', () => {
  it('should read one topology face’s triangles from the mesh that carries its span, in world space', () => {
    const geometry = new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute([...square, 5, 5, 5, 6, 5, 5, 6, 6, 5], 3),
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.userData['measurementFeatures'] = {
      componentId: 'frame',
      kind: 'surface',
      faces: [
        { id: 'face:0', start: 0, count: 6 },
        { id: 'face:1', start: 6, count: 3 },
      ],
    };
    const scene = new Group();
    scene.position.set(0, 0, 10);
    scene.add(mesh);
    expect([...planarFaceTriangles(scene, 'frame', 1)!]).toEqual([5, 5, 15, 6, 5, 15, 6, 6, 15]);
    expect(planarFaceTriangles(scene, 'frame', 0)).toHaveLength(18);
    expect(planarFaceTriangles(scene, 'other', 0)).toBeUndefined();
    expect(planarFaceTriangles(scene, 'frame', 7)).toBeUndefined();
  });

  it('should outline a face by the edges only one triangle uses', () => {
    // Four outer edges of the square; the shared diagonal is not outline.
    expect(faceOutlinePositions(square)).toHaveLength(4 * 6);
  });

  it('should build a closed prism over the face whose height follows the previewed distance', () => {
    const prism = facePrismGeometry(square, new Vector3(0, 0, 1));
    // Two caps (2 triangles each) and four walls (2 triangles each).
    expect(prism.getAttribute('position').count).toBe((2 + 2 + 4 * 2) * 3);
    const origin = new Vector3(0, 0, 0);
    const top = new Vector3(1, 1, 1).applyMatrix4(prismScaleMatrix(origin, new Vector3(0, 0, 1), 2.5));
    expect(top.toArray()).toEqual([1, 1, 2.5]);
    // A negative distance reaches into the solid; the face plane never moves.
    const base = new Vector3(0.3, 0.7, 0).applyMatrix4(prismScaleMatrix(origin, new Vector3(0, 0, 1), -1));
    expect(base.toArray()).toEqual([0.3, 0.7, 0]);
    expect(new Vector3(0, 0, 1).applyMatrix4(prismScaleMatrix(origin, new Vector3(0, 0, 1), -1)).z).toBeCloseTo(-1);
  });

  it('should drill the hole preview from the face into the solid', () => {
    const hole = holeGeometry({ start: new Vector3(0, 0, 0), axis: new Vector3(0, 0, -1), radius: 0.5, depth: 4 });
    hole.computeBoundingBox();
    expect(hole.boundingBox!.min.z).toBeCloseTo(-4);
    expect(hole.boundingBox!.max.z).toBeCloseTo(0);
    expect(hole.boundingBox!.max.x).toBeCloseTo(0.5);
  });

  it('should wrap each selected edge segment in a tube of the fillet size', () => {
    const tube = edgeTubeGeometry([0, 0, 0, 10, 0, 0], 1);
    tube!.computeBoundingBox();
    expect(tube!.boundingBox!.min.toArray().map((value) => Math.round(value * 100) / 100)).toEqual([0, -1, -1]);
    expect(tube!.boundingBox!.max.x).toBeCloseTo(10);
    expect(edgeTubeGeometry([], 1)).toBeUndefined();
  });
});
