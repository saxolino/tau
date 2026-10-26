/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';

/**
 * Real-geometry checks of the smlibwasm 0.5 functions SinopiaCAD's footwear blocks (heels, soles, lasts,
 * drawings for the factory) will build on. Each test makes a simple solid and measures it.
 */
let library: typeof Smlib;
beforeAll(async () => {
  library = await import('@classcad/smlibwasm');
});

describe('smlibwasm 0.5 building blocks', () => {
  it('should report version 0.5.x', () => {
    expect(library.version).toMatch(/^0\.5\./);
  });

  it('should draft side faces of a box and see the angle with draftAnalysis', () => {
    const box = library.Box(20, 20, 20);
    const sides = box.faces().filter((face) => Math.abs(face.normalAt(face.interiorPoint()).z) < 0.1);
    const bottom = [...box.faces()].find((face) => face.normalAt(face.interiorPoint()).z < -0.9)!;
    const pull = [0, 0, -1] as const;
    expect(sides).toHaveLength(4);
    // Before: the four walls are vertical (no draft).
    expect(box.draftAnalysis(pull, { minAngle: 1 }).vertical).toHaveLength(4);

    const drafted = box.draft(sides, 5, bottom);
    expect(drafted.isValid()).toBe(true);
    const analysis = drafted.draftAnalysis(pull, { minAngle: 4.9 });
    expect(analysis.insufficient).toHaveLength(0);
    expect(analysis.vertical).toHaveLength(0);
    // Four walls at +5 degrees (the bottom face lies on the neutral plane and faces the pull, the top releases).
    const wallAngles = analysis.faces.filter(({ kind, maxAngle }) => kind === 'positive' && maxAngle < 10);
    expect(wallAngles).toHaveLength(4);
    for (const wall of wallAngles) {
      expect(wall.minAngle).toBeCloseTo(5, 3);
      expect(wall.maxAngle).toBeCloseTo(5, 3);
    }
    // The walls lean outwards above the neutral plane, so the part grows.
    expect(drafted.volume).toBeGreaterThan(box.volume);
  });

  it('should round one edge with a radius that varies along it (variable fillet)', () => {
    const box = library.Box(20, 20, 20);
    const edge = [...box.edges().parallelTo(library.Z)][0]!;
    const variable = box.fillet(edge, { start: 1, end: 4 });
    expect(variable.isValid()).toBe(true);
    const small = box.fillet(edge, 1).volume;
    const large = box.fillet(edge, 4).volume;
    // More material is removed than by a constant 1 mm round, less than by a constant 4 mm round.
    expect(variable.volume).toBeLessThan(small);
    expect(variable.volume).toBeGreaterThan(large);
    // A round removes (1 - pi/4) r^2 per mm of edge; with r running linearly from 1 to 4 over 20 mm the
    // integral of r^2 is 20 * (1 + 4 + 16) / 3.
    const removed = box.volume - variable.volume;
    expect(removed).toBeCloseTo((1 - Math.PI / 4) * 20 * 7, 2);
  });

  it('should pull a loft through a curved guide rail', () => {
    const { ThreePointArc, Line, loft } = library;
    const bottom = ThreePointArc([-10, 0, 0], [0, 4, 0], [10, 0, 0]);
    const top = ThreePointArc([-5, 0, 20], [0, 2, 20], [5, 0, 20]);
    const bulgedRail = ThreePointArc([-10, 0, 0], [-9, 0, 10], [-5, 0, 20]);
    const straightRail = Line([10, 0, 0], [5, 0, 20]);
    const guided = loft([bottom, top], { rails: [bulgedRail, straightRail] });
    const free = loft([bottom, top]);
    const distanceTo = (shape: Smlib.Shell, point: [number, number, number]) =>
      Math.min(...[...shape.faces()].map((face) => face.distanceTo(point)));
    // The guided surface passes through the middle of the bulged rail; the free loft misses it.
    expect(guided).toBeInstanceOf(library.Shell);
    expect(distanceTo(guided as Smlib.Shell, [-9, 0, 10])).toBeLessThan(1e-4);
    expect(distanceTo(free as Smlib.Shell, [-9, 0, 10])).toBeGreaterThan(1);
    expect((guided as Smlib.Shell).area).toBeGreaterThan((free as Smlib.Shell).area);
  });

  it('should push and pull faces exactly (offsetFaces, moveFaces)', () => {
    const box = library.Box(20, 20, 20);
    const top = box.faces().filter((face) => face.normalAt(face.interiorPoint()).z > 0.9);
    expect(box.offsetFaces(top, 5).volume).toBeCloseTo(20 * 20 * 25, 6);
    expect(box.offsetFaces(top, -5).volume).toBeCloseTo(20 * 20 * 15, 6);
    expect(box.moveFaces(top, [0, 0, 3]).volume).toBeCloseTo(20 * 20 * 23, 6);
  });

  it('should read IGES files in inches as millimetres and recover the solid', () => {
    const iges = readFileSync(new URL('fixtures/block-faces-inch.igs', import.meta.url), 'utf8');
    const part = library.fromIges(iges);
    expect(part).toBeInstanceOf(library.Part);
    const solid = part as Smlib.Part;
    expect(solid.isValid()).toBe(true);
    expect(solid.faces()).toHaveLength(7);
    // A 20 x 20 x 10 mm block with a hole (file written in inches, 0.787 x 0.787 x 0.394 in).
    const { size } = solid.bbox();
    expect(size.x).toBeCloseTo(20, 3);
    expect(size.y).toBeCloseTo(20, 3);
    expect(size.z).toBeCloseTo(10, 3);
    expect(solid.volume).toBeCloseTo(3497.345, 1);
  });

  it('should lay out a 2D drawing of a part and write it as DXF', () => {
    const box = library.Box(20, 10, 5);
    const views = library.drawingViews(box, ['front', 'top', 'right']);
    const size = (name: string) => views.find((view) => view.name === name)!.bbox().size;
    expect(size('front').x).toBeCloseTo(20, 6);
    expect(size('front').y).toBeCloseTo(5, 6);
    expect(size('top').y).toBeCloseTo(10, 6);
    expect(size('right').x).toBeCloseTo(10, 6);
    const dxf = library.toDxf(views.flatMap((view) => [...view.visible]));
    expect(dxf).toContain('LINE');
    // Reading it back gives the three outlines: 20x5 + 20x10 + 10x5 mm.
    expect(library.fromDxf(dxf).area).toBeCloseTo(350, 6);
  });
});
