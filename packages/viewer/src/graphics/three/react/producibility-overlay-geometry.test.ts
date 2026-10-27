import { describe, expect, it } from 'vitest';
import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import {
  componentFaceSurfaces,
  draftTint,
  producibilityPieceGeometry,
} from '#graphics/three/react/producibility-overlay-geometry.js';

const tints = { block: new Color(1, 0, 0), warning: new Color(1, 0.5, 0), ok: new Color(0, 1, 0) };

/** A piece of two faces: a floor looking up (+Z) and a wall looking along +X. */
function piece(): Group {
  const floor = [0, 0, 0, 1, 0, 0, 1, 1, 0];
  const wall = [1, 0, 0, 1, 1, 0, 1, 1, 1];
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute([...floor, ...wall], 3))
    .setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.userData['measurementFeatures'] = {
    componentId: 'telaio',
    kind: 'surface',
    faces: [
      { id: 'face:0', start: 0, count: 3 },
      { id: 'face:4', start: 3, count: 3 },
    ],
  };
  const scene = new Group();
  scene.position.set(0, 0, 2);
  scene.add(mesh);
  return scene;
}

const colorsOf = (geometry: BufferGeometry | undefined): number[][] => {
  const colors = geometry?.getAttribute('color');
  return colors
    ? Array.from({ length: colors.count }, (_, index) => [colors.getX(index), colors.getY(index), colors.getZ(index)])
    : [];
};

describe('producibility overlay geometry', () => {
  it('should read every face of a component with its normals, in world space', () => {
    const surfaces = componentFaceSurfaces(piece(), 'telaio');
    expect([...surfaces.keys()]).toEqual([0, 4]);
    expect([...surfaces.get(0)!.positions].slice(0, 3)).toEqual([0, 0, 2]);
    expect([...surfaces.get(4)!.normals].slice(0, 3)).toEqual([1, 0, 0]);
    expect(componentFaceSurfaces(piece(), 'ardiglione').size).toBe(0);
  });

  it('should tint only the faces a check lists, in their level', () => {
    const geometry = producibilityPieceGeometry(
      componentFaceSurfaces(piece(), 'telaio'),
      { componentId: 'telaio', faces: [{ faceId: 4, level: 'block' }] },
      tints,
    );
    expect(geometry!.getAttribute('position').count).toBe(3);
    expect(colorsOf(geometry)).toEqual([
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ]);
    expect(
      producibilityPieceGeometry(componentFaceSurfaces(piece(), 'telaio'), { componentId: 'telaio', faces: [] }, tints),
    ).toBeUndefined();
  });

  it('should map the draft of every face: warning on a wall parallel to the pull, ok on a face across it', () => {
    const geometry = producibilityPieceGeometry(
      componentFaceSurfaces(piece(), 'telaio'),
      { componentId: 'telaio', faces: [], draft: { direction: [0, 0, 1], minimum: 1 } },
      tints,
    );
    const colors = colorsOf(geometry);
    expect(colors).toHaveLength(6);
    expect(colors[0]).toEqual([0, 1, 0]);
    expect(colors[5]).toEqual([1, 0.5, 0]);
    // Half the minimum draft sits half way from warning to ok.
    const tilted = new Vector3(Math.cos((0.5 * Math.PI) / 180), 0, Math.sin((0.5 * Math.PI) / 180));
    const half = draftTint({ normal: tilted, direction: new Vector3(0, 0, 1), minimum: 1, tints }, new Color());
    expect(half.r).toBeCloseTo(0.5, 2);
    expect(half.g).toBeCloseTo(0.75, 2);
  });

  it('should tint a whole open piece in the block colour', () => {
    const geometry = producibilityPieceGeometry(
      componentFaceSurfaces(piece(), 'telaio'),
      { componentId: 'telaio', faces: [], whole: true },
      tints,
    );
    expect(colorsOf(geometry).every(([r, g, b]) => r === 1 && g === 0 && b === 0)).toBe(true);
    expect(colorsOf(geometry)).toHaveLength(6);
  });
});
