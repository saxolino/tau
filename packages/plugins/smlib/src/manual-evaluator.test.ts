/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import {
  manualDocumentSchema,
  manualEntryPath,
  manualProfileSegments,
  parseManualDocument,
  serializeManualDocument,
} from '@taucad/smlib/manual-operations';
import type { ManualOperation, ManualProfile } from '@taucad/smlib/manual-operations';
import {
  applyManualOperations,
  buildManualProfile,
  manualBodySignature,
  manualFaceGeometry,
} from '#manual-evaluator.js';
import { normalizeRenderShapes, render } from '#utils/render-output.js';
import type { NamedInputShape } from '#utils/render-output.js';

let library: typeof Smlib;
beforeAll(async () => {
  library = await import('@classcad/smlibwasm');
});

const profile: ManualProfile = {
  kind: 'polygon',
  plane: 'xy',
  origin: [0, 0, 0],
  points: [
    { id: 'a', x: -2, y: -2 },
    { id: 'b', x: 2, y: -2 },
    { id: 'c', x: 2, y: 2 },
    { id: 'd', x: -2, y: 2 },
  ],
};
const source = (size = 10): NamedInputShape[] =>
  normalizeRenderShapes(library, [{ name: 'piece', shape: library.Box(size, size, size) }]);
const replay = async (operations: ManualOperation[], entries = source()) =>
  applyManualOperations({ library, entries, document: manualDocumentSchema.parse({ version: 1, operations }) });
const body = (entries: NamedInputShape[], index = 0): Smlib.Part => {
  const { shape } = entries[index]!;
  if (!(shape instanceof library.Part)) {
    throw new Error('Expected a native solid');
  }
  return shape;
};

describe('manual native history', () => {
  it('preserves exact authored names through storage and modifies only the selected piece', async () => {
    const entries = normalizeRenderShapes(library, [
      { name: 'piece', shape: library.Box(10, 10, 10) },
      { name: ' piece ', shape: library.Box(8, 8, 8) },
    ]);
    const document = parseManualDocument(
      serializeManualDocument({
        version: 1,
        operations: [
          { id: 'move-padded', type: 'translate', target: { name: ' piece ' }, delta: [20, 0, 0] },
          { id: 'new-padded', type: 'extrude', mode: 'new', name: ' tab ', profile, distance: 2 },
          { id: 'move-new', type: 'translate', target: { name: ' tab ' }, delta: [30, 0, 0] },
        ],
      }),
    );
    const result = await applyManualOperations({ library, entries, document });
    expect(body(result).bbox().min.x).toBeCloseTo(-5, 5);
    expect(body(result, 1).bbox().min.x).toBeCloseTo(16, 5);
    expect(result[1]!.manual?.targetName).toBe(' piece ');
    expect(result[0]!.manual?.operationIds).toEqual([]);
    expect(result[1]!.manual?.operationIds).toEqual(['move-padded']);
    expect(result[2]!.manualTargetName).toBe(' tab ');
    expect(body(result, 2).bbox().min.x).toBeCloseTo(28, 5);
    expect(() =>
      manualDocumentSchema.parse({
        version: 1,
        operations: [{ id: 'blank', type: 'translate', target: { name: '   ' }, delta: [1, 0, 0] }],
      }),
    ).toThrow('must not be blank');
  });

  it('replays transforms on fresh source, retaining exact STEP geometry and stable signatures', async () => {
    const operations: ManualOperation[] = [
      { id: 'move', type: 'translate', target: { name: 'piece' }, delta: [20, 0, 0] },
      { id: 'turn', type: 'rotate', target: { name: 'piece' }, origin: [0, 0, 0], axis: [0, 0, 1], angle: 90 },
      { id: 'size', type: 'scale', target: { name: 'piece' }, origin: [0, 0, 0], factor: 2 },
      { id: 'mirror', type: 'mirror', target: { name: 'piece' }, origin: [0, 0, 0], plane: 'xz' },
    ];
    const first = await replay(operations);
    expect(body(first).volume).toBeCloseTo(8000, 5);
    expect(first[0]!.manual?.operationIds).toEqual(['move', 'turn', 'size', 'mirror']);
    expect(first[0]!.manual?.bodySignature).toMatch(/^[\da-f]{64}$/);
    const repeated = await replay(operations);
    expect(repeated[0]!.manual?.bodySignature).toBe(first[0]!.manual?.bodySignature);
    const restored = library.fromStep(library.toStep([body(first)]));
    expect(restored).toBeInstanceOf(library.Part);
    if (!(restored instanceof library.Part)) {
      throw new Error('Expected a reimported STEP solid');
    }
    expect(restored.volume).toBeCloseTo(8000, 3);
    expect(body(await replay(operations, source(12))).volume).toBeCloseTo(13_824, 4);
  });

  it('uses the exact preview Bezier segments for native spline bounds and area', () => {
    const curve: ManualProfile = {
      ...profile,
      kind: 'spline',
      points: profile.points.map((point) => ({ ...point, x: point.x * 5, y: point.y * 5 })),
    };
    const segments = manualProfileSegments(curve);
    const sampled = segments.flatMap(({ start, control1, control2, end }) =>
      Array.from({ length: 1000 }, (_, index) => {
        const t = index / 1000;
        const u = 1 - t;
        return {
          x: u ** 3 * start.x + 3 * u ** 2 * t * control1.x + 3 * u * t ** 2 * control2.x + t ** 3 * end.x,
          y: u ** 3 * start.y + 3 * u ** 2 * t * control1.y + 3 * u * t ** 2 * control2.y + t ** 3 * end.y,
        };
      }),
    );
    const native = buildManualProfile(library, curve);
    const bounds = native.bbox();
    expect(bounds.min.x).toBeCloseTo(-12.5, 5);
    expect(bounds.max.x).toBeCloseTo(12.5, 5);
    expect(bounds.min.x).toBeCloseTo(Math.min(...sampled.map(({ x }) => x)), 5);
    expect(bounds.max.x).toBeCloseTo(Math.max(...sampled.map(({ x }) => x)), 5);
    expect(bounds.min.y).toBeCloseTo(Math.min(...sampled.map(({ y }) => y)), 5);
    expect(bounds.max.y).toBeCloseTo(Math.max(...sampled.map(({ y }) => y)), 5);
    let twiceArea = 0;
    for (const [index, point] of sampled.entries()) {
      const next = sampled[(index + 1) % sampled.length]!;
      twiceArea += point.x * next.y - next.x * point.y;
    }
    const area = Math.abs(twiceArea) / 2;
    expect(native.area).toBeCloseTo(area, 3);
    expect(segments.at(-1)?.end).toEqual(segments[0]?.start);
  });

  it('extrudes editable polygon and spline points into native solids on placed planes', async () => {
    const entries = await replay([
      {
        id: 'new',
        type: 'extrude',
        mode: 'new',
        name: 'tab',
        profile: { ...profile, plane: 'yz', origin: [20, 0, 0] },
        distance: 5,
      },
    ]);
    expect(body(entries, 1).volume).toBeCloseTo(80, 5);
    expect(entries[1]!.manualTargetName).toBe('tab');
    const curved = buildManualProfile(library, { ...profile, kind: 'spline' }).extrude(3);
    expect(curved.isValid()).toBe(true);
    expect(curved.volume).toBeGreaterThan(0);
    const movedPoint = {
      ...profile,
      points: profile.points.map((point) => (point.id === 'b' ? { ...point, x: 4 } : point)),
    };
    expect(buildManualProfile(library, movedPoint).extrude(5).volume).toBeCloseTo(100, 5);
  });

  it('performs profile union/cut, directed holes, fillets and chamfers as exact geometry', async () => {
    const cut = await replay([
      {
        id: 'cut',
        type: 'extrude',
        mode: 'cut',
        target: { name: 'piece' },
        profile: { ...profile, origin: [0, 0, -10] },
        distance: 20,
      },
    ]);
    expect(body(cut).volume).toBeCloseTo(840, 4);
    const add = await replay([
      { id: 'add', type: 'extrude', mode: 'add', target: { name: 'piece' }, profile, distance: 10 },
    ]);
    expect(body(add).volume).toBeCloseTo(1080, 4);
    const hole = await replay([
      {
        id: 'hole',
        type: 'hole',
        target: { name: 'piece' },
        center: [0, 0, -10],
        axis: [0, 0, 1],
        diameter: 2,
        depth: 20,
      },
    ]);
    expect(body(hole).volume).toBeCloseTo(1000 - Math.PI * 10, 3);
    await Promise.all(
      (['fillet', 'chamfer'] as const).map(async (type) => {
        const result = await replay([
          { id: type, type, target: { name: 'piece' }, edges: { kind: 'parallel', axis: [0, 0, 1] }, size: 1 },
        ]);
        expect(body(result).isValid()).toBe(true);
        expect(body(result).volume).toBeLessThan(1000);
      }),
    );
  });

  it('requires an unchanged body witness for index selections', async () => {
    const entries = source();
    const signature = await manualBodySignature(library, body(entries));
    const operation: ManualOperation = {
      id: 'edge',
      type: 'fillet',
      target: { name: 'piece' },
      edges: { kind: 'indices', indices: [0], bodySignature: signature },
      size: 0.5,
    };
    expect(body(await replay([operation], entries)).volume).toBeLessThan(1000);
    await expect(replay([operation], source(12))).rejects.toThrow('older geometry');
    await expect(
      replay([{ ...operation, edges: { kind: 'indices', indices: [999], bodySignature: signature } }], source()),
    ).rejects.toThrow('no longer exists');
  });

  it('fails closed on renamed, unnamed or ambiguous targets and ineffective booleans', async () => {
    const move: ManualOperation = { id: 'move', type: 'translate', target: { name: 'piece' }, delta: [1, 0, 0] };
    await expect(
      replay([move], normalizeRenderShapes(library, [{ name: 'renamed', shape: library.Box(10, 10, 10) }])),
    ).rejects.toThrow('missing');
    await expect(replay([move], normalizeRenderShapes(library, library.Box(10, 10, 10)))).rejects.toThrow('missing');
    await expect(replay([move], [...source(), ...source()])).rejects.toThrow('ambiguous');
    await expect(
      replay([
        {
          id: 'away',
          type: 'extrude',
          mode: 'cut',
          target: { name: 'piece' },
          profile: { ...profile, origin: [100, 0, 0] },
          distance: 10,
        },
      ]),
    ).rejects.toThrow('does not change');
    expect(body(await replay([{ ...move, enabled: false }])).volume).toBeCloseTo(1000);
  });
});

describe('manual sidecar validation', () => {
  it('round trips canonical history and rejects invalid data', () => {
    expect(manualEntryPath('parts/main.ts')).toBe('parts/main.ts.manual.json');
    expect(() => manualEntryPath('../main.ts')).toThrow('canonical');
    const document = { version: 1, operations: [] } as const;
    expect(parseManualDocument(serializeManualDocument({ ...document, operations: [] }))).toEqual(document);
    expect(() => parseManualDocument('{')).toThrow();
    expect(() =>
      parseManualDocument(
        JSON.stringify({
          version: 1,
          operations: [{ id: 'invalid', type: 'translate', target: { name: 'piece' }, delta: [Infinity, 0, 0] }],
        }),
      ),
    ).toThrow();
    expect(() =>
      manualDocumentSchema.parse({
        version: 1,
        operations: [{ id: 'invalid', type: 'extrude', mode: 'new', profile, distance: 2 }],
      }),
    ).toThrow();
  });
});

describe('native planar face extrusion', () => {
  const operationFor = async (
    entries: NamedInputShape[],
    index: number,
    distance: number,
  ): Promise<Extract<ManualOperation, { type: 'faceExtrude' }>> => {
    const part = body(entries);
    const point = part.faces()[index]!.interiorPoint();
    return {
      id: 'face',
      type: 'faceExtrude',
      target: { name: 'piece' },
      distance,
      face: { index, bodySignature: await manualBodySignature(library, part), point: [point.x, point.y, point.z] },
    };
  };
  const named = (part: Smlib.Part | Smlib.Shell): NamedInputShape[] =>
    normalizeRenderShapes(library, { name: 'piece', shape: part });

  it('extrudes and cuts top, bottom and rotated faces with exact STEP results', async () => {
    await Promise.all(
      ['top', 'bottom', 'rotated'].flatMap((kind) =>
        [2, -2].map(async (distance) => {
          const part =
            kind === 'rotated' ? library.Box(10, 10, 10).rotate(library.Axis.Y, 30) : library.Box(10, 10, 10);
          const index = part
            .faces()
            .findIndex((face) => (kind === 'bottom' ? face.normalAt().z < -0.9 : face.normalAt().z > 0.8));
          const entries = named(part);
          const operation = await operationFor(entries, index, distance);
          const result = body(await replay([operation], entries));
          expect(result.isValid()).toBe(true);
          expect(result.solids()).toHaveLength(1);
          expect(result.volume).toBeCloseTo(1000 + 100 * distance, 4);
          const restored = library.fromStep(library.toStep([result]));
          if (!(restored instanceof library.Part)) {
            throw new Error('Expected exact STEP solid');
          }
          expect(restored.volume).toBeCloseTo(result.volume, 4);
        }),
      ),
    );
  });

  it('publishes native planar descriptors only for trusted solid face mappings', async () => {
    const entries = await replay([], source());
    const geometry = render(entries, { library, tessellation: { linearTolerance: 0.1, angularTolerance: 10 } })[0]!;
    expect(geometry.manualFaces).toHaveLength(6);
    for (const descriptor of geometry.manualFaces ?? []) {
      const face = body(entries).faces()[descriptor.index]!;
      expect(face.isPlanar).toBe(true);
      expect(descriptor.normal).toEqual(face.normalAt().toArray());
      expect(descriptor.center).toEqual(face.center().toArray());
      expect(geometry.faces.faceGroups.some(({ faceId }) => faceId === descriptor.index)).toBe(true);
    }
    const part = body(entries);
    const unavailableFaces = vi.spyOn(part, 'faces').mockImplementation(() => {
      throw new Error('Classification unavailable');
    });
    try {
      const fallback = render(entries, { library, tessellation: { linearTolerance: 0.1, angularTolerance: 10 } })[0]!;
      expect(fallback.faces.faceGroups).toHaveLength(1);
      expect(fallback.manualFaces).toBeUndefined();
    } finally {
      unavailableFaces.mockRestore();
    }
    const shell = normalizeRenderShapes(library, { name: 'sheet', shape: part.faces()[0]!.toShell() });
    const guardedShell = await replay([], shell);
    expect(guardedShell[0]!.manual?.bodySignature).toMatch(/^[\da-f]{64}$/);
    expect(
      render(guardedShell, { library, tessellation: { linearTolerance: 0.1, angularTolerance: 10 } })[0]!.manualFaces,
    ).toBeUndefined();
  });

  it('retains inner wires when the selected planar face contains a hole', async () => {
    const part = library.Box(10, 10, 10).cut(library.Cylinder(2, 20));
    const index = part.faces().findIndex((face) => face.isPlanar && face.normalAt().z > 0.9);
    const face = part.faces()[index]!;
    expect(face.innerWires()).toHaveLength(1);
    const entries = named(part);
    await Promise.all(
      [2, -2].map(async (distance) => {
        const operation = await operationFor(entries, index, distance);
        const result = body(await replay([operation], entries));
        expect(result.volume).toBeCloseTo(part.volume + face.area * distance, 4);
        expect(
          result
            .faces()
            .find((candidate) => candidate.isPlanar && candidate.normalAt().z > 0.9)
            ?.innerWires(),
        ).toHaveLength(1);
      }),
    );
  });

  it('rejects stale, missing, nonplanar, wrong-point and boundary selections', async () => {
    const entries = source();
    const index = body(entries)
      .faces()
      .findIndex((face) => face.normalAt().z > 0.9);
    const operation = await operationFor(entries, index, 2);
    await expect(replay([operation], source(12))).rejects.toThrow('older geometry');
    await expect(replay([{ ...operation, face: { ...operation.face, index: 999 } }], entries)).rejects.toThrow(
      'no longer exists',
    );
    await expect(replay([{ ...operation, face: { ...operation.face, point: [100, 0, 5] } }], entries)).rejects.toThrow(
      'outside',
    );
    await expect(replay([{ ...operation, face: { ...operation.face, point: [5, 0, 5] } }], entries)).rejects.toThrow(
      'boundary',
    );
    const cylinder = named(library.Cylinder(5, 10));
    const curvedIndex = body(cylinder)
      .faces()
      .findIndex((face) => !face.isPlanar);
    const curved = await operationFor(cylinder, curvedIndex, 2);
    await expect(replay([curved], cylinder)).rejects.toThrow('planar face');
    const shell = normalizeRenderShapes(library, { name: 'piece', shape: body(entries).faces()[0]!.toShell() });
    await expect(replay([operation], shell)).rejects.toThrow('must be a solid');
  });

  it('rejects empty solids and changes to connected pieces', async () => {
    const entries = source();
    const index = body(entries)
      .faces()
      .findIndex((face) => face.normalAt().z > 0.9);
    await expect(replay([await operationFor(entries, index, -20)], entries)).rejects.toThrow('nonempty solid');
    const block = library.Box(10, 10, 10);
    const compound = block.fuse(block.translate([30, 0, 0]));
    const multiple = named(compound);
    const bridgeIndex = compound
      .faces()
      .findIndex((face) => face.normalAt().x > 0.9 && Math.abs(face.center().x - 5) < 1e-6);
    await expect(replay([await operationFor(multiple, bridgeIndex, 30)], multiple)).rejects.toThrow('disconnected');
  });
});

describe('face replay provenance', () => {
  it('re-resolves chained face operations across native snapshot reordering while retaining exact-state legacy guards', async () => {
    const replaySource = 'source-closure-and-resolved-parameters';
    const evaluate = async (operations: ManualOperation[]) =>
      applyManualOperations({ library, entries: source(), document: { version: 1, operations }, replaySource });
    const initial = await evaluate([]);
    const select = async (entries: NamedInputShape[], distance: number, id: string): Promise<ManualOperation> => {
      const restored = library.fromSmb(library.toSmb(body(entries)));
      if (!(restored instanceof library.Part)) {
        throw new Error('Expected restored solid');
      }
      const index = restored.faces().findIndex((face) => face.isPlanar && face.normalAt().z > 0.9);
      const face = restored.faces()[index]!;
      const point = face.interiorPoint();
      return {
        id,
        type: 'faceExtrude',
        target: { name: 'piece' },
        distance,
        face: {
          index,
          point: [point.x, point.y, point.z],
          bodySignature: await manualBodySignature(library, restored),
          replayWitness: entries[0]!.manual!.replayWitness,
          geometry: manualFaceGeometry(face),
        },
      };
    };
    const first = await select(initial, 3, 'outward');
    const grown = await evaluate([first]);
    const second = await select(grown, -1, 'inward');
    for (let iteration = 0; iteration < 3; iteration++) {
      // oxlint-disable-next-line no-await-in-loop -- each fresh replay tests repeated native Boolean reconstruction.
      const final = await evaluate([first, second]);
      expect(body(final).volume).toBeCloseTo(1200, 4);
      expect(body(final).bbox().max.z).toBeCloseTo(7, 4);
    }
    await expect(
      applyManualOperations({
        library,
        entries: source(),
        document: { version: 1, operations: [first] },
        replaySource: 'changed-source-or-parameters',
      }),
    ).rejects.toThrow('older source');
    const changedGeometry =
      first.type === 'faceExtrude'
        ? { ...first, face: { ...first.face, geometry: { ...first.face.geometry!, area: 99 } } }
        : first;
    await expect(evaluate([changedGeometry])).rejects.toThrow('matched uniquely');
    const wrongIndex = first.type === 'faceExtrude' ? { ...first, face: { ...first.face, index: 999 } } : first;
    expect(body(await evaluate([wrongIndex])).volume).toBeCloseTo(1300, 4);
    if (second.type !== 'faceExtrude') {
      throw new Error('Expected a face operation');
    }
    const legacy = {
      ...second,
      face: { index: second.face.index, point: second.face.point, bodySignature: '0'.repeat(64) },
    };
    await expect(evaluate([first, legacy])).rejects.toThrow('older geometry');
    await expect(evaluate([{ ...first, enabled: false }, second])).rejects.toThrow('older source');
  });
});
