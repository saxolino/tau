/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import {
  isManualProfileClosed,
  manualDocumentSchema,
  manualProfileSchema,
  manualProfileSegments,
  offsetManualProfile,
  parseManualDocument,
  serializeManualDocument,
} from '@taucad/smlib/manual-operations';
import type { ManualPointProfile, ManualProfile } from '@taucad/smlib/manual-operations';
import { applyManualOperations, buildManualProfile, buildManualProfileWire } from '#manual-evaluator.js';
import { isDrawingShape, normalizeRenderShapes, renderDrawing, sampleDrawing } from '#utils/render-output.js';

let library: typeof Smlib;
beforeAll(async () => {
  library = await import('@classcad/smlibwasm');
});

const rectangle: ManualPointProfile = {
  kind: 'polygon',
  plane: 'xy',
  origin: [0, 0, 0],
  points: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 0 },
    { id: 'c', x: 10, y: 5 },
    { id: 'd', x: 0, y: 5 },
  ],
};
const circle: ManualProfile = { kind: 'circle', center: { x: 3, y: 4 }, radius: 5, plane: 'xy', origin: [0, 0, 2] };

describe('editable native profile geometry', () => {
  it('should preserve legacy storage fields and exact polygon body signatures', async () => {
    const legacy = {
      version: 1,
      operations: [{ id: 'old', type: 'extrude', mode: 'new', name: 'legacy', profile: rectangle, distance: 2 }],
    };
    const reopened = parseManualDocument(serializeManualDocument(manualDocumentSchema.parse(legacy)));
    expect(reopened).toEqual(legacy);
    expect(reopened.operations[0]).not.toHaveProperty('profile.closed');
    const original = library.Plane.XY.at(rectangle.origin)
      .mul(library.Polygon(rectangle.points.map(({ x, y }) => [x, y, 0])))
      .extrude(2);
    // SMLib 0.5 serializes B-rep bytes in an order that depends on allocation history, so two identical
    // builds hash differently; compare the geometry itself instead of the SMB digest.
    const rebuilt = buildManualProfile(library, rectangle).extrude(2);
    expect(rebuilt.volume).toBeCloseTo(original.volume, 9);
    expect(rebuilt.area).toBeCloseTo(original.area, 9);
    expect(rebuilt.faces().length).toBe(original.faces().length);
    expect(rebuilt.edges().length).toBe(original.edges().length);
  });

  it('should retain an open sketch as a native drawing through save and fresh replay', async () => {
    const open = { ...rectangle, closed: false, points: rectangle.points.slice(0, 3) };
    const document = parseManualDocument(
      serializeManualDocument(
        manualDocumentSchema.parse({
          version: 1,
          operations: [{ id: 'outline', type: 'sketch', name: 'outline', profile: open }],
        }),
      ),
    );
    const replay = async () => applyManualOperations({ library, entries: [], document });
    const first = await replay();
    const { shape } = first[0]!;
    expect(shape).toBeInstanceOf(library.Wire);
    if (!(shape instanceof library.Wire)) {
      throw new Error('Expected native wire');
    }
    expect(shape.isClosed).toBe(false);
    expect(shape.length).toBeCloseTo(15, 8);
    expect(isDrawingShape(library, shape)).toBe(true);
    const drawing = sampleDrawing(library, first[0]!);
    expect(drawing.polylines).toHaveLength(2);
    expect(renderDrawing([drawing]).content).toContain('<svg');
    const repeated = await replay();
    expect(sampleDrawing(library, repeated[0]!).polylines).toEqual(drawing.polylines);
    expect(() => buildManualProfile(library, open)).toThrow('requires a closed profile');
    expect(() =>
      manualDocumentSchema.parse({
        version: 1,
        operations: [{ id: 'bad', type: 'extrude', mode: 'new', name: 'bad', profile: open, distance: 2 }],
      }),
    ).toThrow('requires a closed profile');
  });

  it('should create analytic circles and signed arcs on placed planes', () => {
    const wire = buildManualProfileWire(library, circle);
    expect(wire.isClosed).toBe(true);
    expect(wire.edges()).toHaveLength(1);
    expect(wire.edges()[0]!.geomType).toBe('circle');
    expect(wire.bbox().min.z).toBeCloseTo(2, 8);
    const arc: ManualProfile = {
      kind: 'arc',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      sweepAngle: -90,
      plane: 'yz',
      origin: [7, 0, 0],
    };
    const nativeArc = buildManualProfileWire(library, arc);
    expect(nativeArc.isClosed).toBe(false);
    expect(nativeArc.edges()[0]!.geomType).toBe('circle');
    expect(nativeArc.length).toBeCloseTo((5 * Math.PI) / 2, 8);
    expect(nativeArc.bbox().min.x).toBeCloseTo(7, 8);
    expect(isManualProfileClosed(arc)).toBe(false);
    expect(() => buildManualProfile(library, arc)).toThrow('requires a closed profile');
    expect(() => manualProfileSchema.parse({ ...arc, sweepAngle: 360 })).toThrow('smaller than 360');
  });

  it.each(['xz', 'yz'] as const)('should project a saved %s sketch onto its authored drawing plane', async (plane) => {
    const document = manualDocumentSchema.parse({
      version: 1,
      operations: [{ id: 'placed', type: 'sketch', name: 'placed', profile: { ...rectangle, plane } }],
    });
    const entries = await applyManualOperations({ library, entries: [], document });
    const drawing = sampleDrawing(library, entries[0]!);
    expect(drawing.manualDrawingPlane).toBe(plane);
    const svg = renderDrawing([structuredClone(drawing)]).content;
    expect(svg).toContain('viewBox="-0.2 -5.2 10.4 5.4"');
    const points = drawing.polylines.flat();
    expect(points.every((point) => Math.abs(point[plane === 'xz' ? 1 : 0]!) < 1e-8)).toBe(true);
    expect(Math.max(...points.map((point) => point[2]!))).toBeCloseTo(5, 8);
  });

  it('should replay circle and offset polygon solids into exact STEP geometry', async () => {
    const offset = offsetManualProfile(rectangle, 1);
    const operations = [
      { id: 'disk', type: 'extrude', mode: 'new', name: 'disk', profile: circle, distance: 2 },
      {
        id: 'offset',
        type: 'extrude',
        mode: 'new',
        name: 'offset',
        profile: { ...offset, origin: [20, 0, 0] },
        distance: 2,
      },
    ];
    const document = parseManualDocument(
      serializeManualDocument(manualDocumentSchema.parse({ version: 1, operations })),
    );
    const first = await applyManualOperations({ library, entries: [], document, replaySource: 'fixed-profile-source' });
    const repeated = await applyManualOperations({
      library,
      entries: [],
      document,
      replaySource: 'fixed-profile-source',
    });
    expect(repeated.map(({ manual }) => manual?.replayWitness)).toEqual(
      first.map(({ manual }) => manual?.replayWitness),
    );
    const parts = first.map(({ shape }) => {
      if (!(shape instanceof library.Part)) {
        throw new Error('Expected native solid');
      }
      return shape;
    });
    expect(parts[0]!.volume).toBeCloseTo(Math.PI * 25 * 2, 8);
    expect(parts[0]!.edges().some((edge) => edge.geomType === 'circle')).toBe(true);
    expect(parts[1]!.volume).toBeCloseTo(168, 8);
    for (const [index, entry] of repeated.entries()) {
      if (!(entry.shape instanceof library.Part)) {
        throw new Error('Expected replayed native solid');
      }
      expect(entry.shape.isValid()).toBe(true);
      expect(entry.shape.volume).toBeCloseTo(parts[index]!.volume, 8);
    }
    const restored = library.fromStep(library.toStep(parts));
    const restoredParts = (Array.isArray(restored) ? restored : [restored]).map((shape) => {
      if (!(shape instanceof library.Part)) {
        throw new Error('Expected STEP solid');
      }
      expect(shape.isValid()).toBe(true);
      return shape;
    });
    expect(restoredParts).toHaveLength(2);
    expect(restoredParts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(Math.PI * 50 + 168, 5);
    expect(normalizeRenderShapes(library, restored)).toHaveLength(2);
  });

  it('should keep open spline endpoint segments open and legacy spline closure exact', () => {
    const closed = manualProfileSegments({ ...rectangle, kind: 'spline' });
    const open = manualProfileSegments({ ...rectangle, kind: 'spline', closed: false });
    expect(closed).toHaveLength(4);
    expect(closed.at(-1)!.end).toEqual(closed[0]!.start);
    expect(open).toHaveLength(3);
    expect(open.at(-1)!.end).toEqual({ x: 0, y: 5 });
    expect(buildManualProfileWire(library, { ...rectangle, kind: 'spline', closed: false }).isClosed).toBe(false);
  });
});

describe('canonical profile offsets', () => {
  it('should offset polygons outward independently of winding and preserve point identities', () => {
    for (const points of [rectangle.points, [...rectangle.points].reverse()]) {
      const result = offsetManualProfile({ ...rectangle, points }, 1);
      if (result.kind !== 'polygon') {
        throw new Error('Expected polygon');
      }
      expect(result.points.map(({ id }) => id)).toEqual(points.map(({ id }) => id));
      expect(buildManualProfile(library, result).area).toBeCloseTo(84, 8);
      expect(buildManualProfile(library, offsetManualProfile({ ...rectangle, points }, -1)).area).toBeCloseTo(24, 8);
    }
  });

  it('should offset open lines to the left and analytic arcs without polygon approximation', () => {
    const open = { ...rectangle, closed: false, points: rectangle.points.slice(0, 3) };
    const result = offsetManualProfile(open, 1);
    expect(result.kind).toBe('polygon');
    if (result.kind !== 'polygon') {
      throw new Error('Expected polyline');
    }
    expect(result.points).toEqual([
      { id: 'a', x: 0, y: 1 },
      { id: 'b', x: 9, y: 1 },
      { id: 'c', x: 9, y: 5 },
    ]);
    expect(offsetManualProfile(circle, 2)).toEqual({ ...circle, radius: 7 });
    const arc: ManualProfile = {
      kind: 'arc',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 20,
      sweepAngle: 100,
      plane: 'xy',
      origin: [0, 0, 0],
    };
    expect(offsetManualProfile(arc, 1)).toEqual({ ...arc, radius: 4 });
    expect(offsetManualProfile({ ...arc, sweepAngle: -100 }, 1)).toEqual({ ...arc, sweepAngle: -100, radius: 6 });
  });

  it('should reject intersections, collapsed offsets, excessive mitres and unsupported splines', () => {
    expect(() => offsetManualProfile(rectangle, -3)).toThrow('collapses or reverses');
    expect(() => offsetManualProfile(circle, -5)).toThrow('collapses');
    expect(() => offsetManualProfile({ ...rectangle, kind: 'spline' }, 1)).toThrow('Spline offset is unsupported');
    expect(() => offsetManualProfile(rectangle, Number.NaN)).toThrow('finite, nonzero');
    const crossed = {
      ...rectangle,
      points: [rectangle.points[0]!, rectangle.points[2]!, rectangle.points[1]!, rectangle.points[3]!],
    };
    expect(() => offsetManualProfile(crossed, 1)).toThrow('intersects or overlaps');
    const sharp = {
      ...rectangle,
      closed: false,
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 0, y: 0.01 },
      ],
    };
    expect(() => offsetManualProfile(sharp, 1)).toThrow('excessive mitre');
  });
});
