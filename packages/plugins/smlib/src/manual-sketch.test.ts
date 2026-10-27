/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { manualDocumentSchema, manualProfileSchema } from '@taucad/smlib/manual-operations';
import type { ManualOperation, ManualProfile } from '@taucad/smlib/manual-operations';
import { applyManualOperations, buildManualProfile, buildManualProfileWire } from '#manual-evaluator.js';
import { manualEdgeGeometry } from '#manual-edge.js';
import { normalizeRenderShapes } from '#utils/render-output.js';
import type { NamedInputShape } from '#utils/render-output.js';

let library: typeof Smlib;
beforeAll(async () => {
  library = await import('@classcad/smlibwasm');
});

/** A centred 10 mm cube named «piece»: its top face is z = 5, its +X face x = 5. */
const source = (): NamedInputShape[] =>
  normalizeRenderShapes(library, [{ name: 'piece', shape: library.Box(10, 10, 10) }]);
const replay = async (operations: ManualOperation[], entries = source()) =>
  applyManualOperations({ library, entries, document: manualDocumentSchema.parse({ version: 1, operations }) });
const solid = (entries: NamedInputShape[], index = 0): Smlib.Part => {
  const { shape } = entries[index]!;
  if (!(shape instanceof library.Part)) {
    throw new Error('Expected a native solid');
  }
  return shape;
};

/** The top face of the cube as a sketch frame. */
type Placement = Pick<ManualProfile, 'plane' | 'origin' | 'frame'>;
const top: Placement = { plane: 'xy', origin: [0, 0, 5], frame: { xDir: [1, 0, 0], normal: [0, 0, 1] } };
/** The +X face: local X runs along world Y, local Y up along world Z. */
const side: Placement = { plane: 'yz', origin: [5, 0, 0], frame: { xDir: [0, 1, 0], normal: [1, 0, 0] } };

const rectangle = (placement: Placement, [x0, y0, x1, y1]: [number, number, number, number]): ManualProfile => ({
  ...placement,
  kind: 'path',
  start: { x: x0, y: y0 },
  segments: [
    { kind: 'line', to: { x: x1, y: y0 } },
    { kind: 'line', to: { x: x1, y: y1 } },
    { kind: 'line', to: { x: x0, y: y1 } },
    { kind: 'line', to: { x: x0, y: y0 } },
  ],
  closed: true,
});

describe('sketched outlines', () => {
  it('admits a closed outline only when it ends where it starts, and arcs only when they bend', () => {
    expect(manualProfileSchema.safeParse(rectangle(top, [-2, -1, 2, 1])).success).toBe(true);
    const open = {
      ...top,
      kind: 'path',
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 4, y: 0 } },
        { kind: 'line', to: { x: 4, y: 3 } },
      ],
    };
    expect(manualProfileSchema.safeParse({ ...open, closed: false }).success).toBe(true);
    expect(() => manualProfileSchema.parse({ ...open, closed: true })).toThrow('must end where it starts');
    const straightArc = {
      ...top,
      kind: 'path',
      start: { x: 0, y: 0 },
      segments: [{ kind: 'arc', through: { x: 1, y: 0 }, to: { x: 2, y: 0 } }],
      closed: false,
    };
    expect(() => manualProfileSchema.parse(straightArc)).toThrow('not on one line');
  });

  it('refuses a frame whose X direction leaves its plane', () => {
    const tilted = { ...rectangle(top, [-2, -1, 2, 1]), frame: { xDir: [1, 0, 1], normal: [0, 0, 1] } };
    expect(() => manualProfileSchema.parse(tilted)).toThrow('X direction lying in its plane');
  });

  it('places a frame sketch on its face: local X and Y follow the frame, not a principal plane', () => {
    const disc: ManualProfile = { ...side, kind: 'circle', center: { x: 1, y: 2 }, radius: 1 };
    const center = buildManualProfile(library, disc).center();
    expect([center.x, center.y, center.z].map((value) => Number(value.toFixed(6)))).toEqual([5, 1, 2]);
  });

  it('builds lines, three-point arcs and splines as one exact outline', () => {
    // A half disc of radius 2: the diameter, then the arc back through its top.
    const halfDisc: ManualProfile = {
      ...top,
      kind: 'path',
      start: { x: -2, y: 0 },
      segments: [
        { kind: 'line', to: { x: 2, y: 0 } },
        { kind: 'arc', through: { x: 0, y: 2 }, to: { x: -2, y: 0 } },
      ],
      closed: true,
    };
    expect(buildManualProfile(library, halfDisc).area).toBeCloseTo(2 * Math.PI, 6);
    const wave: ManualProfile = {
      ...top,
      kind: 'path',
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'spline',
          through: [
            { x: 2, y: 1 },
            { x: 4, y: -1 },
          ],
          to: { x: 6, y: 0 },
        },
      ],
      closed: false,
    };
    const wire = buildManualProfileWire(library, wave);
    expect(wire.isClosed).toBe(false);
    expect(wire.length).toBeGreaterThan(6);
  });
});

describe('extrusion from a sketch on the model', () => {
  it('cuts a rectangle from the top face into the piece by the exact volume', async () => {
    const result = await replay([
      {
        id: 'pocket',
        type: 'extrude',
        mode: 'cut',
        target: { name: 'piece' },
        profile: rectangle(top, [-2, -1, 2, 1]),
        distance: -3,
      },
    ]);
    expect(solid(result).volume).toBeCloseTo(1000 - 4 * 2 * 3, 6);
  });

  it('adds a tapered boss: the volume of the frustum, narrowing away from the face', async () => {
    const result = await replay([
      {
        id: 'boss',
        type: 'extrude',
        mode: 'add',
        target: { name: 'piece' },
        profile: rectangle(top, [-3, -3, 3, 3]),
        distance: 2,
        taper: 10,
      },
    ]);
    const shrink = 2 * 2 * Math.tan((10 * Math.PI) / 180);
    const [bottom, upper] = [36, (6 - shrink) ** 2];
    expect(solid(result).volume).toBeCloseTo(1000 + (2 / 3) * (bottom + upper + Math.sqrt(bottom * upper)), 5);
    expect(solid(result).bbox().max.z).toBeCloseTo(7, 6);
  });
});

describe('revolution', () => {
  it('turns a rectangle about a sketch line into a ring of the exact volume', async () => {
    // On the front plane (local Y up along world Z), x from 2 to 4, 3 high, about the local Y axis.
    const front: Placement = { plane: 'xz', origin: [0, 0, 0], frame: { xDir: [1, 0, 0], normal: [0, -1, 0] } };
    const result = await replay([
      {
        id: 'ring',
        type: 'revolve',
        mode: 'new',
        name: 'Anello',
        profile: rectangle(front, [2, 0, 4, 3]),
        axis: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
        angle: 360,
      },
    ]);
    expect(solid(result, 1).volume).toBeCloseTo(Math.PI * (16 - 4) * 3, 5);
    expect(result[1]!.manualTargetName).toBe('Anello');
  });

  it('adds half a turn about a model edge laid on the sketch plane', async () => {
    // The top face's edge at y = 5 runs along X; a 2 × 1 rectangle beside it turns 180° over the top.
    const result = await replay([
      {
        id: 'hinge',
        type: 'revolve',
        mode: 'add',
        target: { name: 'piece' },
        profile: rectangle(top, [-1, 3, 1, 5]),
        axis: { start: { x: -5, y: 5 }, end: { x: 5, y: 5 } },
        angle: 180,
      },
    ]);
    // Half a cylinder of radius 2 and length 2 under the top plane: its quarter beyond y = 5 is new material.
    expect(solid(result).volume).toBeCloseTo(1000 + (Math.PI * 2 ** 2 * 2) / 4, 6);
    expect(solid(result).bbox().max.y).toBeCloseTo(7, 6);
  });
});

describe('sweep', () => {
  it('sweeps a circle along a path drawn in a second sketch: a tube of the exact volume', async () => {
    const path: ManualProfile = {
      ...side,
      kind: 'path',
      start: { x: 0, y: 6 },
      segments: [{ kind: 'line', to: { x: 0, y: 16 } }],
      closed: false,
    };
    const result = await replay([
      {
        id: 'wire',
        type: 'sweep',
        mode: 'new',
        name: 'Filo',
        profile: { ...top, kind: 'circle', center: { x: 0, y: 0 }, radius: 1 },
        path: { kind: 'sketch', profile: path },
      },
    ]);
    expect(solid(result, 1).volume).toBeCloseTo(Math.PI * 10, 5);
  });

  it('sweeps a circle round a closed circular path: a torus, the shape of a ring', async () => {
    const result = await replay([
      {
        id: 'band',
        type: 'sweep',
        mode: 'new',
        name: 'Fascia',
        profile: { ...side, kind: 'circle', center: { x: 0, y: 0 }, radius: 1 },
        path: {
          kind: 'sketch',
          profile: { plane: 'xy', origin: [0, 0, 20], kind: 'circle', center: { x: 0, y: 0 }, radius: 5 },
        },
      },
    ]);
    expect(solid(result, 1).volume).toBeCloseTo(2 * Math.PI ** 2 * 5, 4);
  });

  it('sweeps along an exact edge of a piece and refuses an edge that is gone', async () => {
    const edge = [...solid(source()).edges()].find(
      (candidate) =>
        candidate.geomType === 'line' &&
        Math.abs(candidate.direction.x) > 0.99 &&
        candidate.start.y > 4 &&
        candidate.start.z > 4,
    )!;
    const geometry = manualEdgeGeometry(edge)!;
    const operation: Extract<ManualOperation, { type: 'sweep' }> = {
      id: 'rail',
      type: 'sweep',
      mode: 'new',
      name: 'Bordo',
      profile: { ...side, kind: 'circle', center: { x: 0, y: 0 }, radius: 0.5 },
      path: { kind: 'edge', piece: { name: 'piece' }, geometry },
    };
    const result = await replay([operation]);
    expect(solid(result, 1).volume).toBeCloseTo(Math.PI * 0.25 * 10, 5);
    const moved = { ...geometry, start: [9, 9, 9] as [number, number, number] };
    await expect(
      replay([{ ...operation, path: { kind: 'edge', piece: { name: 'piece' }, geometry: moved } }]),
    ).rejects.toThrow('cannot be matched uniquely');
  });
});
