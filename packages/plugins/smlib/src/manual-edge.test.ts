/* oxlint-disable new-cap -- SMLib exposes capitalized native shape factories. */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { manualEdgeSelectionSchema, manualEdgeGeometrySchema } from '@taucad/smlib/manual-operations';
import type { ManualEdgeGeometry, ManualOperation } from '@taucad/smlib/manual-operations';
import { manualEdgeGeometry, resolveManualEdges } from '#manual-edge.js';
import { applyManualOperations, manualBodySignature, manualFaceGeometry } from '#manual-evaluator.js';
import { normalizeRenderShapes, render } from '#utils/render-output.js';
import type { NamedInputShape } from '#utils/render-output.js';

let library: typeof Smlib;
beforeAll(async () => {
  library = await import('@classcad/smlibwasm');
});
const source = (): NamedInputShape[] =>
  normalizeRenderShapes(library, { name: 'piece', shape: library.Box(20, 12, 6) });
const replay = async (operations: ManualOperation[], replaySource = 'edge-test-source') =>
  applyManualOperations({ library, entries: source(), document: { version: 1, operations }, replaySource });
const partOf = (entries: NamedInputShape[]): Smlib.Part => {
  const { shape } = entries[0]!;
  if (!(shape instanceof library.Part)) {
    throw new Error('Expected native solid');
  }
  return shape;
};
const describeEdge = (edge: Smlib.Edge): ManualEdgeGeometry => {
  const descriptor = manualEdgeGeometry(edge);
  if (!descriptor) {
    throw new Error('Expected a supported native edge');
  }
  return descriptor;
};

describe('picked native edges with replay provenance', () => {
  it('fillets and chamfers the chosen edge after face editing and transforms, despite reordered snapshot indices', async () => {
    const initial = await replay([]);
    const topIndex = partOf(initial)
      .faces()
      .findIndex((face) => face.isPlanar && face.normalAt().z > 0.9);
    const top = partOf(initial).faces()[topIndex]!;
    const point = top.interiorPoint();
    const prefix: ManualOperation[] = [
      {
        id: 'face',
        type: 'faceExtrude',
        target: { name: 'piece' },
        distance: 3,
        face: {
          index: topIndex,
          point: [point.x, point.y, point.z],
          bodySignature: initial[0]!.manual!.bodySignature,
          replayWitness: initial[0]!.manual!.replayWitness,
          geometry: manualFaceGeometry(top),
        },
      },
      { id: 'move', type: 'translate', target: { name: 'piece' }, delta: [10, 2, 3] },
      { id: 'rotate', type: 'rotate', target: { name: 'piece' }, axis: [0, 0, 1], origin: [0, 0, 0], angle: 30 },
      { id: 'scale', type: 'scale', target: { name: 'piece' }, factor: 1.2, origin: [0, 0, 0] },
    ];
    const edited = await replay(prefix);
    const restored = library.fromSmb(library.toSmb(partOf(edited)));
    if (!(restored instanceof library.Part)) {
      throw new Error('Expected native snapshot');
    }
    const edge = restored
      .edges()
      .find((candidate) => candidate.geomType === 'line' && Math.abs(candidate.end.z - candidate.start.z) > 1)!;
    const geometry = describeEdge(edge);
    await Promise.all(
      (['fillet', 'chamfer'] as const).map(async (type) => {
        const operation: ManualOperation = {
          id: `picked-${type}`,
          type,
          target: { name: 'piece' },
          size: 0.5,
          edges: {
            kind: 'indices',
            indices: [999],
            bodySignature: '0'.repeat(64),
            replayWitness: edited[0]!.manual!.replayWitness,
            geometries: [geometry],
          },
        };
        const expected = type === 'fillet' ? restored.fillet([edge], 0.5) : restored.chamfer([edge], 0.5);
        const result = partOf(await replay([...prefix, operation]));
        expect(result.isValid()).toBe(true);
        expect(result.volume).toBeCloseTo(expected.volume, 5);
        expect(result.center().x).toBeCloseTo(expected.center().x, 5);
        expect(result.center().y).toBeCloseTo(expected.center().y, 5);
        const fromStep = library.fromStep(library.toStep([result]));
        if (!(fromStep instanceof library.Part)) {
          throw new Error('Expected exact STEP solid');
        }
        expect(fromStep.volume).toBeCloseTo(result.volume, 4);
        expect(partOf(await replay([...prefix, operation])).volume).toBeCloseTo(result.volume, 5);
        await expect(replay([...prefix, operation], 'changed-source')).rejects.toThrow('older source');
        await expect(replay([{ ...prefix[0]!, enabled: false }, ...prefix.slice(1), operation])).rejects.toThrow(
          'older source',
        );
      }),
    );
  });

  it('refuses altered curves, ambiguous matches, duplicate selections and stale legacy indices', async () => {
    const entries = await replay([]);
    const part = partOf(entries);
    const edge = part.edges()[0]!;
    const geometry = describeEdge(edge);
    const changed = { ...geometry, length: geometry.length + 0.1 };
    expect(() => resolveManualEdges(part, [changed])).toThrow('matched uniquely');
    expect(() => resolveManualEdges(part, [geometry, geometry])).toThrow('distinct native curve');
    const originalEdges = part.edges();
    const duplicate = vi.spyOn(part, 'edges').mockReturnValue(new library.ShapeList(...originalEdges, edge));
    try {
      expect(() => resolveManualEdges(part, [geometry])).toThrow('matched uniquely');
    } finally {
      duplicate.mockRestore();
    }
    const operation: ManualOperation = {
      id: 'legacy',
      type: 'fillet',
      target: { name: 'piece' },
      size: 0.5,
      edges: { kind: 'indices', indices: [0], bodySignature: '0'.repeat(64) },
    };
    await expect(replay([operation])).rejects.toThrow('older geometry');
    expect(() =>
      manualEdgeSelectionSchema.parse({
        kind: 'indices',
        indices: [0],
        bodySignature: 'raw',
        replayWitness: 'a'.repeat(64),
      }),
    ).toThrow('both replay provenance');
    expect(() =>
      manualEdgeSelectionSchema.parse({
        kind: 'indices',
        indices: [0, 1],
        bodySignature: 'raw',
        replayWitness: 'a'.repeat(64),
        geometries: [geometry],
      }),
    ).toThrow('exactly one');
    expect(() =>
      manualEdgeSelectionSchema.parse({
        kind: 'indices',
        indices: [0, 0],
        bodySignature: 'raw',
        replayWitness: 'a'.repeat(64),
        geometries: [geometry, geometry],
      }),
    ).toThrow('unique picked edge');
  });

  it('matches line and circle orientation independently and retains whole NURBS geometry', () => {
    const box = library.Box(20, 12, 6);
    const line = describeEdge(box.edges()[0]!);
    if (line.kind !== 'line') {
      throw new Error('Expected line');
    }
    expect(resolveManualEdges(box, [{ ...line, start: line.end, end: line.start }])).toHaveLength(1);
    const cylinder = library.Cylinder(5, 10);
    const circle = describeEdge(cylinder.edges()[0]!);
    if (circle.kind !== 'circle') {
      throw new Error('Expected circle');
    }
    expect(
      resolveManualEdges(cylinder, [{ ...circle, normal: [-circle.normal[0], -circle.normal[1], -circle.normal[2]] }]),
    ).toHaveLength(1);
    const curved = library
      .makeFace(
        library.Spline(
          [
            [-5, -5, 0],
            [5, -5, 0],
            [5, 5, 0],
            [-5, 5, 0],
          ],
          { closed: true },
        ),
      )
      .extrude(3);
    const spline = curved
      .edges()
      .map((edge) => manualEdgeGeometry(edge))
      .find((geometry) => geometry?.kind === 'nurbs');
    expect(spline).toBeDefined();
    if (!spline) {
      throw new Error('Expected complete NURBS descriptor');
    }
    expect(resolveManualEdges(curved, [spline])).toHaveLength(1);
    const spanSum = spline.knots[0]! + spline.knots.at(-1)!;
    const reversed = {
      ...spline,
      points: spline.points.toReversed(),
      knots: spline.knots.toReversed().map((value) => spanSum - value),
      weights: spline.weights?.toReversed() ?? null,
    };
    expect(resolveManualEdges(curved, [reversed])).toHaveLength(1);
    expect(() => manualEdgeGeometrySchema.parse({ ...spline, knots: spline.knots.toReversed() })).toThrow(
      'knots must be ordered',
    );

    expect(() =>
      resolveManualEdges(curved, [
        {
          ...spline,
          points: spline.points.map((point, index) => (index === 0 ? [point[0] + 0.1, point[1], point[2]] : point)),
        },
      ]),
    ).toThrow('matched uniquely');
  });

  it('publishes exact body bounds and native edge mapping only for representable solid curves', async () => {
    const entries = await replay([]);
    const geometry = render(entries, {
      library,
      tessellation: { linearTolerance: 0.1, angularTolerance: 10 },
      collectBrepEdges: true,
    })[0]!;
    expect(geometry.manualBounds).toEqual({ min: [-10, -6, -3], max: [10, 6, 3] });
    expect(geometry.manualEdges).toHaveLength(12);
    for (const descriptor of geometry.manualEdges ?? []) {
      expect(descriptor.geometry).toEqual(describeEdge(partOf(entries).edges()[descriptor.index]!));
      expect(geometry.edges.edgeGroups.some(({ edgeId }) => edgeId === descriptor.index)).toBe(true);
    }
    const shell = normalizeRenderShapes(library, { name: 'surface', shape: partOf(entries).faces()[0]!.toShell() });
    const shellEntries = await applyManualOperations({
      library,
      entries: shell,
      document: { version: 1, operations: [] },
      replaySource: 'surface-source',
    });
    const surface = render(shellEntries, {
      library,
      tessellation: { linearTolerance: 0.1, angularTolerance: 10 },
      collectBrepEdges: true,
    })[0]!;
    expect(surface.manualEdges).toBeUndefined();
    expect(surface.manualBounds).toBeUndefined();
    expect(await manualBodySignature(library, partOf(entries))).toBe(entries[0]!.manual!.bodySignature);
  });
});
