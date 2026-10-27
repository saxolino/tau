import { describe, expect, it } from 'vitest';
import {
  circleThroughThreePoints,
  fromSketchPoint,
  projectModelEdges,
  sketchAxesForNormal,
  sketchEndTangent,
  sketchLoopPolygon,
  sketchLoops,
  sketchPolygonArea,
  sketchRectangle,
  sketchSnapPoints,
  snapSketchPoint,
  tangentArcThrough,
  toSketchPoint,
} from '#graphics/three/react/sketch-geometry.js';
import type { SketchEntity, SketchFrame } from '#graphics/three/react/sketch-geometry.js';

const ids = (): (() => string) => {
  let next = 0;
  return () => `e${next++}`;
};
const close = (value: number, expected: number): void => {
  expect(value).toBeCloseTo(expected, 9);
};

/** The +X face of a 10 mm cube centred on the origin: local X along world Y, local Y up. */
const side: SketchFrame = { origin: [5, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] };

describe('snapping', () => {
  const line: SketchEntity = { kind: 'line', id: 'a', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
  const circle: SketchEntity = { kind: 'circle', id: 'c', center: { x: 20, y: 5 }, radius: 3 };
  const points = sketchSnapPoints([line, circle]);

  it('lands on a drawn end before a middle or a center, within the tolerance only', () => {
    expect(snapSketchPoint({ raw: { x: 10.3, y: 0.2 }, tolerance: 0.5, points })).toEqual({
      point: { x: 10, y: 0 },
      kind: 'endpoint',
    });
    expect(snapSketchPoint({ raw: { x: 5.2, y: -0.1 }, tolerance: 0.5, points }).kind).toBe('midpoint');
    expect(snapSketchPoint({ raw: { x: 19.8, y: 5.3 }, tolerance: 0.5, points })).toEqual({
      point: { x: 20, y: 5 },
      kind: 'center',
    });
    expect(snapSketchPoint({ raw: { x: 7.3, y: 2.6 }, tolerance: 0.5, points })).toEqual({
      point: { x: 7.3, y: 2.6 },
      kind: 'free',
    });
  });

  it('prefers an end to a nearer middle when both are within reach', () => {
    const short: SketchEntity = { kind: 'line', id: 's', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
    const snapped = snapSketchPoint({ raw: { x: 0.45, y: 0 }, tolerance: 0.6, points: sketchSnapPoints([short]) });
    expect(snapped).toEqual({ point: { x: 0, y: 0 }, kind: 'endpoint' });
  });

  it('follows the horizontal and the vertical of the previous point, on the grid, with a guide', () => {
    const reference = { x: 2, y: 3 };
    const horizontal = snapSketchPoint({ raw: { x: 8.26, y: 3.2 }, tolerance: 0.4, reference, grid: 0.5 });
    expect(horizontal).toEqual({
      point: { x: 8.5, y: 3 },
      kind: 'horizontal',
      guide: { from: reference, to: { x: 8.5, y: 3 } },
    });
    expect(snapSketchPoint({ raw: { x: 1.8, y: -4.1 }, tolerance: 0.4, reference, grid: 1 }).point).toEqual({
      x: 2,
      y: -4,
    });
    expect(snapSketchPoint({ raw: { x: 6.26, y: 7.74 }, tolerance: 0.1, reference, grid: 0.5 })).toEqual({
      point: { x: 6.5, y: 7.5 },
      kind: 'grid',
    });
  });

  it('lands on the model’s edges laid onto the sketch plane', () => {
    // A cube edge parallel to the face projects as a segment; an edge along the normal as a point.
    const projected = projectModelEdges(
      [
        [
          [5, -5, 5],
          [5, 5, 5],
        ],
        [
          [-5, 5, 5],
          [5, 5, 5],
        ],
      ],
      side,
    );
    expect(projected.segments).toEqual([{ a: { x: -5, y: 5 }, b: { x: 5, y: 5 } }]);
    expect(projected.points.map(({ point }) => point)).toEqual([
      { x: -5, y: 5 },
      { x: 5, y: 5 },
    ]);
    const onEdge = snapSketchPoint({ raw: { x: 1.2, y: 5.3 }, tolerance: 0.5, segments: projected.segments });
    expect(onEdge.kind).toBe('modelEdge');
    close(onEdge.point.x, 1.2);
    close(onEdge.point.y, 5);
    expect(snapSketchPoint({ raw: { x: 4.8, y: 4.9 }, tolerance: 0.5, points: projected.points }).kind).toBe(
      'modelVertex',
    );
  });

  it('keeps corners of a tessellated model curve but not its samples', () => {
    const quarter = Array.from({ length: 17 }, (_, index) => {
      const angle = (index / 16) * (Math.PI / 2);
      return [5, 3 * Math.cos(angle), 3 * Math.sin(angle)] as const;
    });
    const segments = quarter.slice(0, -1).map((point, index) => [point, quarter[index + 1]!] as const);
    const { points } = projectModelEdges(segments, side);
    expect(points.map(({ point }) => [Number(point.x.toFixed(6)), Number(point.y.toFixed(6))])).toEqual([
      [3, 0],
      [0, 3],
    ]);
  });
});

describe('plane frames', () => {
  it('round-trips a model point through the sketch plane, with its height above it', () => {
    const local = toSketchPoint([7, 2, -1], side);
    expect(local).toEqual({ x: 2, y: -1, height: 2 });
    expect(fromSketchPoint(local, side)).toEqual([5, 2, -1]);
  });

  it('keeps a vertical face upright and takes world X on any other face', () => {
    expect(sketchAxesForNormal([1, 0, 0])).toEqual({ xDir: [0, 1, 0], yDir: [0, 0, 1] });
    const front = sketchAxesForNormal([0, -1, 0]);
    expect(front.xDir.map((value) => value + 0)).toEqual([1, 0, 0]);
    expect(front.yDir).toEqual([0, 0, 1]);
    expect(sketchAxesForNormal([0, 0, 1])).toEqual({ xDir: [1, 0, 0], yDir: [0, 1, 0] });
  });
});

describe('arcs', () => {
  it('finds the circle through three points, and none on a line', () => {
    const circle = circleThroughThreePoints({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 0 })!;
    close(circle.center.x, 2);
    close(circle.center.y, 0);
    close(circle.radius, 2);
    expect(circleThroughThreePoints({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeUndefined();
  });

  it('continues a line with a tangent arc: the arc leaves along the line’s direction', () => {
    const through = tangentArcThrough({ x: 4, y: 0 }, { x: 1, y: 0 }, { x: 4, y: 4 })!;
    // Center (4, 2), radius 2: a half turn to the left passes through (6, 2).
    close(through.x, 6);
    close(through.y, 2);
    const arc: SketchEntity = { kind: 'arc', id: 'a', start: { x: 4, y: 0 }, through, end: { x: 4, y: 4 } };
    const tangent = sketchEndTangent(arc, 'start')!;
    close(tangent.x, 1);
    close(tangent.y, 0);
    const exit = sketchEndTangent(arc, 'end')!;
    close(exit.x, -1);
    expect(tangentArcThrough({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 })).toBeUndefined();
  });
});

describe('closing a profile', () => {
  it('finds a closed loop whatever the drawing direction, and leaves out an open axis line', () => {
    const entities: SketchEntity[] = [
      { kind: 'line', id: 'bottom', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
      // Drawn backwards: its end meets the bottom's end.
      { kind: 'line', id: 'right', start: { x: 4, y: 3 }, end: { x: 4, y: 0 } },
      { kind: 'arc', id: 'top', start: { x: 4, y: 3 }, through: { x: 2, y: 4 }, end: { x: 0, y: 3 } },
      { kind: 'line', id: 'left', start: { x: 0, y: 3 }, end: { x: 0, y: 0 } },
      { kind: 'line', id: 'axis', start: { x: -2, y: -1 }, end: { x: -2, y: 5 } },
    ];
    const loops = sketchLoops(entities);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.parts.map(({ entity, reversed }) => `${entity.id}${reversed ? '↺' : ''}`)).toEqual([
      'bottom',
      'right↺',
      'top',
      'left',
    ]);
    const area = sketchPolygonArea(sketchLoopPolygon(loops[0]!, 256));
    // The 4 × 3 rectangle plus the circular segment over its top edge.
    const segment = (radius: number, chord: number): number => {
      const half = Math.asin(chord / 2 / radius);
      return radius ** 2 * half - (chord / 2) * radius * Math.cos(half);
    };
    expect(area).toBeCloseTo(12 + segment(2.5, 4), 2);
  });

  it('reports an open chain as no loop until its last point meets the first', () => {
    const open: SketchEntity[] = [
      { kind: 'line', id: 'a', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
      { kind: 'line', id: 'b', start: { x: 4, y: 0 }, end: { x: 4, y: 3 } },
    ];
    expect(sketchLoops(open)).toEqual([]);
    const closed = [...open, { kind: 'line', id: 'c', start: { x: 4, y: 3 }, end: { x: 0, y: 0 } } as const];
    expect(sketchLoops(closed)).toHaveLength(1);
    expect(sketchLoops([{ kind: 'circle', id: 'o', center: { x: 0, y: 0 }, radius: 1 }])).toHaveLength(1);
  });

  it('draws a rectangle with rounded corners as one closed loop of the exact area', () => {
    const entities = sketchRectangle({ first: { x: 0, y: 0 }, second: { x: 10, y: 6 }, radius: 2, id: ids() });
    expect(entities.map(({ kind }) => kind)).toEqual(['line', 'arc', 'line', 'arc', 'line', 'arc', 'line', 'arc']);
    const loops = sketchLoops(entities);
    expect(loops).toHaveLength(1);
    expect(sketchPolygonArea(sketchLoopPolygon(loops[0]!, 1024))).toBeCloseTo(60 - (4 - Math.PI) * 4, 3);
    expect(sketchRectangle({ first: { x: 0, y: 0 }, second: { x: 3, y: 3 }, id: ids() })).toHaveLength(4);
    expect(sketchRectangle({ first: { x: 0, y: 0 }, second: { x: 3, y: 0 }, id: ids() })).toEqual([]);
  });
});
