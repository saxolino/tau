import { describe, expect, it } from 'vitest';
import { sketchLoops } from '@taucad/viewer/cad/sketch-geometry';
import type { SketchEntity, SketchSnap, SketchVec2 } from '@taucad/viewer/cad/sketch-geometry';
import type { ManualDocument, ManualEdgeGeometry } from '@taucad/smlib/manual-operations';
import {
  defaultSketchOperation,
  edgeAxisOnPlane,
  emptySketchDrawing,
  parseSketchQuota,
  reduceSketchDrawing,
  reopenSketchOperation,
  sketchAxisLines,
  sketchBasePlane,
  sketchCommit,
  sketchFacePlane,
  sketchLiveQuota,
  sketchOperationGhost,
  sketchPathProfile,
  sketchPendingEntities,
} from '#services/manual-sketch.js';
import type { SketchDrawEvent, SketchDrawing } from '#services/manual-sketch.js';

const ids = (): (() => string) => {
  let next = 0;
  return () => `e${next++}`;
};
const at = (x: number, y: number, kind: SketchSnap['kind'] = 'free'): SketchSnap => ({ point: { x, y }, kind });
const run = (events: readonly SketchDrawEvent[], start: SketchDrawing = emptySketchDrawing()): SketchDrawing => {
  const id = ids();
  let state = start;
  for (const event of events) {
    state = reduceSketchDrawing(state, event, id);
  }
  return state;
};
const click = (x: number, y: number): SketchDrawEvent => ({ type: 'click', snap: at(x, y) });
const move = (x: number, y: number): SketchDrawEvent => ({ type: 'move', snap: at(x, y) });
const empty: ManualDocument = { version: 1, operations: [] };

/** The top face of a 10 mm cube centred on the origin. */
const top = sketchFacePlane(
  { center: [0, 0, 5], normal: [0, 0, 1], bounds: { min: [-5, -5, 5], max: [5, 5, 5] } },
  'top',
  'piece',
);

describe('drawing on the plane', () => {
  it('closes a polyline when the last click returns to the first point', () => {
    const drawing = run([click(0, 0), click(4, 0), click(4, 3), click(0, 3), click(0, 0)]);
    expect(drawing.entities.map(({ kind }) => kind)).toEqual(['line', 'line', 'line', 'line']);
    expect(drawing.clicks).toEqual([]);
    expect(sketchLoops(drawing.entities)).toHaveLength(1);
  });

  it('keeps the chain open after a double click, and Enter ends it', () => {
    const doubled = run([click(0, 0), click(4, 0), { type: 'doubleClick', snap: at(4, 0) }]);
    expect(doubled.entities).toHaveLength(1);
    expect(doubled.clicks).toEqual([]);
    const entered = run([click(0, 0), click(4, 0), click(4, 2), { type: 'finish' }]);
    expect(entered.entities).toHaveLength(2);
    expect(sketchLoops(entered.entities)).toEqual([]);
  });

  it('takes a typed length along the pointer, and shows the live one meanwhile', () => {
    const drawing = run([click(1, 1), move(1, 9)]);
    expect(sketchLiveQuota(drawing)).toEqual({ kind: 'length', values: [8] });
    const typed = reduceSketchDrawing(drawing, { type: 'quota', values: [12.5] }, ids());
    expect(typed.entities[0]).toMatchObject({ kind: 'line', start: { x: 1, y: 1 }, end: { x: 1, y: 13.5 } });
    // The chain continues from the typed point.
    expect(typed.clicks).toEqual([{ x: 1, y: 13.5 }]);
  });

  it('draws a circle by its center and a typed radius', () => {
    const drawing = run([{ type: 'tool', tool: 'circle' }, click(2, 2), move(5, 2)]);
    expect(sketchPendingEntities(drawing)).toEqual([
      { kind: 'circle', id: 'pending', center: { x: 2, y: 2 }, radius: 3 },
    ]);
    const typed = reduceSketchDrawing(drawing, { type: 'quota', values: [1.5] }, ids());
    expect(typed.entities).toEqual([{ kind: 'circle', id: 'e0', center: { x: 2, y: 2 }, radius: 1.5 }]);
  });

  it('draws a rectangle with rounded corners from a typed width × height, toward the pointer', () => {
    const drawing = run([
      { type: 'tool', tool: 'rectangle' },
      { type: 'cornerRadius', radius: 1 },
      click(0, 0),
      move(-3, 2),
      { type: 'quota', values: parseSketchQuota('8 x 4')! },
    ]);
    expect(drawing.entities.map(({ kind }) => kind).join(' ')).toBe('line arc line arc line arc line arc');
    const xs = drawing.entities.flatMap((entity) => (entity.kind === 'line' ? [entity.start.x, entity.end.x] : []));
    expect(Math.min(...xs)).toBeCloseTo(-8, 9);
    expect(Math.max(...xs)).toBeCloseTo(0, 9);
  });

  it('continues a line with a tangent arc and back, from the chain’s tip', () => {
    const drawing = run([
      click(0, 0),
      click(4, 0),
      { type: 'tool', tool: 'tangentArc' },
      click(4, 4),
      { type: 'tool', tool: 'line' },
      click(0, 4),
      click(0, 0),
    ]);
    expect(drawing.entities.map(({ kind }) => kind)).toEqual(['line', 'arc', 'line', 'line']);
    const arc = drawing.entities[1] as Extract<SketchEntity, { kind: 'arc' }>;
    expect(arc.through.x).toBeCloseTo(6, 9);
    expect(arc.through.y).toBeCloseTo(2, 9);
    expect(sketchLoops(drawing.entities)).toHaveLength(1);
  });

  it('starts a tangent arc only from the end of a line or arc, and says so', () => {
    const refused = run([{ type: 'tool', tool: 'tangentArc' }, click(3, 3)]);
    expect(refused.notice).toBe('tangentStart');
    const started = run([
      click(0, 0),
      click(4, 0),
      { type: 'finish' },
      { type: 'tool', tool: 'tangentArc' },
      click(0, 0),
    ]);
    // From the line's start the arc leaves backwards along it.
    expect(started.tangent).toEqual({ x: -1, y: 0 });
  });

  it('draws a three-point arc and a spline through points, closing the spline on its first point', () => {
    const arc = run([{ type: 'tool', tool: 'arc' }, click(0, 0), click(4, 0), click(2, 2)]);
    expect(arc.entities).toEqual([
      { kind: 'arc', id: 'e0', start: { x: 0, y: 0 }, through: { x: 2, y: 2 }, end: { x: 4, y: 0 } },
    ]);
    const spline = run([
      { type: 'tool', tool: 'spline' },
      click(0, 0),
      click(3, 2),
      click(6, 0),
      click(3, -2),
      click(0, 0),
    ]);
    expect(spline.entities).toHaveLength(1);
    expect(sketchLoops(spline.entities)).toHaveLength(1);
  });

  it('takes back the last entity and drops the gesture on Esc', () => {
    const drawing = run([click(0, 0), click(4, 0), click(4, 3)]);
    expect(run([{ type: 'undo' }], drawing).entities).toHaveLength(1);
    expect(run([{ type: 'cancel' }], drawing).clicks).toEqual([]);
  });

  it('reads typed quotas with a comma or a point, and «w x h»', () => {
    expect(parseSketchQuota('12,5')).toEqual([12.5]);
    expect(parseSketchQuota(' 20 x 10 ')).toEqual([20, 10]);
    expect(parseSketchQuota('0')).toBeUndefined();
    expect(parseSketchQuota('abc')).toBeUndefined();
  });
});

const rectangle = (...[x0, y0, x1, y1]: readonly [number, number, number, number]): SketchEntity[] => {
  const corners: SketchVec2[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return corners.map((start, index) => ({ kind: 'line', id: `r${index}`, start, end: corners[(index + 1) % 4]! }));
};

describe('the sketch as native operations', () => {
  it('cuts the closed outline into the face: a negative extrusion on the face frame, with its draft', () => {
    const result = sketchCommit({
      document: empty,
      frame: top.frame,
      entities: rectangle(-2, -1, 2, 1),
      draft: { ...defaultSketchOperation('cut'), distance: 3, taper: 5 },
      target: 'piece',
      name: 'unused',
      id: () => 'cut',
    });
    if (!('document' in result)) {
      throw new Error(result.error);
    }
    expect(result.operation).toEqual({
      id: 'cut',
      type: 'extrude',
      mode: 'cut',
      target: { name: 'piece' },
      distance: -3,
      taper: 5,
      profile: {
        kind: 'path',
        plane: 'xy',
        origin: [0, 0, 5],
        frame: { xDir: [1, 0, 0], normal: [0, 0, 1] },
        start: { x: -2, y: -1 },
        segments: [
          { kind: 'line', to: { x: 2, y: -1 } },
          { kind: 'line', to: { x: 2, y: 1 } },
          { kind: 'line', to: { x: -2, y: 1 } },
          { kind: 'line', to: { x: -2, y: -1 } },
        ],
        closed: true,
      },
    });
  });

  it('refuses until there is a closed profile, an axis, a path or a piece', () => {
    const base = { document: empty, frame: top.frame, name: 'Nuovo', target: 'piece' } as const;
    const open = rectangle(0, 0, 2, 2).slice(0, 3);
    expect(sketchCommit({ ...base, entities: open, draft: defaultSketchOperation('add') })).toEqual({
      error: 'noProfile',
    });
    const closed = rectangle(0, 0, 2, 2);
    expect(
      sketchCommit({ ...base, entities: closed, draft: { ...defaultSketchOperation('add'), kind: 'revolve' } }),
    ).toEqual({ error: 'noAxis' });
    expect(
      sketchCommit({ ...base, entities: closed, draft: { ...defaultSketchOperation('add'), kind: 'sweep' } }),
    ).toEqual({ error: 'noPath' });
    expect(
      sketchCommit({ ...base, target: undefined, entities: closed, draft: defaultSketchOperation('cut') }),
    ).toEqual({ error: 'noTarget' });
  });

  it('revolves about a line of the sketch that closes no loop', () => {
    const front = sketchBasePlane('xz', 20);
    const axisLine: SketchEntity = { kind: 'line', id: 'axis', start: { x: 0, y: 0 }, end: { x: 0, y: 5 } };
    const entities = [...rectangle(2, 0, 4, 3), axisLine];
    const [candidate] = sketchAxisLines(entities);
    expect(candidate?.id).toBe('axis');
    const result = sketchCommit({
      document: empty,
      frame: front.frame,
      entities,
      draft: {
        ...defaultSketchOperation('new'),
        kind: 'revolve',
        angle: 360,
        axis: { start: candidate!.start, end: candidate!.end, source: 'line' },
      },
      name: 'Anello',
      id: () => 'ring',
    });
    if (!('document' in result)) {
      throw new Error(result.error);
    }
    expect(result.operation).toMatchObject({
      type: 'revolve',
      mode: 'new',
      name: 'Anello',
      angle: 360,
      axis: { start: { x: 0, y: 0 }, end: { x: 0, y: 5 } },
      profile: { plane: 'xz', origin: [0, 0, 0], frame: { xDir: [1, 0, 0], normal: [0, -1, 0] } },
    });
  });

  it('lays a straight model edge on the plane as the axis, and refuses one off the plane', () => {
    const edge = (start: [number, number, number], end: [number, number, number]): ManualEdgeGeometry => ({
      kind: 'line',
      start,
      end,
      length: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
      bounds: { min: start, max: end },
      adjacentFaceCount: 2,
      seam: false,
      closed: false,
    });
    expect(edgeAxisOnPlane(edge([-5, 5, 5], [5, 5, 5]), top.frame)).toEqual({
      start: { x: -5, y: 5 },
      end: { x: 5, y: 5 },
    });
    expect(edgeAxisOnPlane(edge([-5, 5, -5], [5, 5, -5]), top.frame)).toBeUndefined();
  });

  it('sweeps along a path drawn in a second sketch, open or closed', () => {
    const side = sketchFacePlane({ center: [5, 0, 0], normal: [1, 0, 0] }, 'right', 'piece');
    const pathEntities: SketchEntity[] = [
      { kind: 'line', id: 'p0', start: { x: 0, y: 6 }, end: { x: 0, y: 16 } },
      { kind: 'arc', id: 'p1', start: { x: 0, y: 16 }, through: { x: 2, y: 18 }, end: { x: 4, y: 16 } },
    ];
    expect(sketchPathProfile(pathEntities, side.frame)).toMatchObject({
      kind: 'path',
      closed: false,
      start: { x: 0, y: 6 },
      segments: [{ kind: 'line' }, { kind: 'arc' }],
    });
    const result = sketchCommit({
      document: empty,
      frame: top.frame,
      entities: [{ kind: 'circle', id: 'c', center: { x: 0, y: 0 }, radius: 1 }],
      draft: {
        ...defaultSketchOperation('new'),
        kind: 'sweep',
        path: { kind: 'sketch', frame: side.frame, entities: pathEntities },
      },
      name: 'Filo',
      id: () => 'wire',
    });
    if (!('document' in result)) {
      throw new Error(result.error);
    }
    expect(result.operation).toMatchObject({
      type: 'sweep',
      profile: { kind: 'circle', radius: 1 },
      path: { kind: 'sketch', profile: { kind: 'path', frame: { normal: [1, 0, 0] } } },
    });
  });

  it('reopens an operation as its sketch and applies it again in place, unchanged', () => {
    const first = sketchCommit({
      document: {
        version: 1,
        operations: [{ id: 'move', type: 'translate', target: { name: 'piece' }, delta: [1, 0, 0] }],
      },
      frame: top.frame,
      entities: rectangle(-2, -1, 2, 1),
      draft: { ...defaultSketchOperation('add'), distance: 2, reverse: true },
      target: 'piece',
      name: 'unused',
      id: () => 'boss',
    });
    if (!('document' in first)) {
      throw new Error(first.error);
    }
    const reopened = reopenSketchOperation(first.operation, ids())!;
    expect(reopened.draft).toMatchObject({ kind: 'extrude', mode: 'add', distance: 2, reverse: true });
    expect(reopened.target).toBe('piece');
    const again = sketchCommit({
      document: first.document,
      frame: reopened.frame,
      entities: reopened.entities,
      draft: reopened.draft,
      target: reopened.target,
      name: 'unused',
      editingId: first.operation.id,
    });
    if (!('document' in again)) {
      throw new Error(again.error);
    }
    expect(again.document).toEqual(first.document);
    expect(again.document.operations.map(({ id }) => id)).toEqual(['move', 'boss']);
  });

  it('previews the operation as a ghost on the chosen loop', () => {
    const [loop] = sketchLoops(rectangle(0, 0, 2, 1));
    const ghost = sketchOperationGhost({ loop, draft: { ...defaultSketchOperation('cut'), distance: 3 } });
    expect(ghost).toMatchObject({ kind: 'extrude', distance: -3, cut: true });
    expect(
      sketchOperationGhost({ loop, draft: { ...defaultSketchOperation('add'), kind: 'revolve' } }),
    ).toBeUndefined();
  });
});
