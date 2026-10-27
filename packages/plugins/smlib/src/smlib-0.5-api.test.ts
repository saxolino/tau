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

/**
 * T-D1-02: the API cases the parametric families (heel, buckle, plate, ring) rely on that no earlier test covered.
 * Each test states what the kernel does; where it refuses, the test pins the refusal and the family recipe uses the
 * fallback recorded in the specification («Esiti T-D1-02»).
 */
describe('smlibwasm 0.5 cases of the parametric families (T-D1-02)', () => {
  const elapsed = <T>(build: () => T): { value: T; time: number } => {
    const start = performance.now();
    const value = build();
    return { value, time: performance.now() - start };
  };

  it('should scale a sketch by a vector of per-axis factors', () => {
    const scaled = library.Ellipse(10, 5).scale([0.5, 2, 1]);
    expect(scaled).toBeInstanceOf(library.Sketch);
    expect(scaled.bbox().size.x).toBeCloseTo(10, 6);
    expect(scaled.bbox().size.y).toBeCloseTo(20, 6);
    // Area scales by sx * sy = 1: pi * 10 * 5.
    expect(scaled.area).toBeCloseTo(Math.PI * 50, 4);
    const rounded = library.Rectangle(20, 10, { fillet: 3 }).scale([0.5, 2, 1]);
    expect(rounded.bbox().size.x).toBeCloseTo(10, 6);
    expect(rounded.bbox().size.y).toBeCloseTo(20, 6);
  });

  it('should loft seven closed scaled sections into a valid solid quickly', () => {
    const sections = Array.from({ length: 7 }, (_, index) => {
      const t = index / 6;
      const scale = 0.45 + 0.55 * t;
      return library.Pos(0, -5 * (1 - t), 5 + 80 * t).mul(library.Ellipse(24 * scale, 27.5 * scale));
    });
    library.loft(sections, { smooth: true });
    const { value: body, time } = elapsed(() => library.loft(sections, { smooth: true }));
    expect(body.isValid()).toBe(true);
    // One side face and two planar caps: the caps are the sections themselves.
    expect(body.faces()).toHaveLength(3);
    expect(body.faces().planar()).toHaveLength(2);
    expect(body.bbox().size.z).toBeCloseTo(80, 6);
    expect(time).toBeLessThan(150);
    // An ellipse and rounded rectangles of other edge counts loft together too.
    const mixed = library.loft(
      [
        library.Ellipse(5, 5),
        ...[1, 2, 3].map((k) =>
          library.Pos(0, 0, 10 * k).mul(library.Rectangle(10 + 6 * k, 12 + 7 * k, { fillet: 2 + k })),
        ),
      ],
      { smooth: true },
    );
    expect(mixed.isValid()).toBe(true);
  });

  it('should refuse rails along closed loft sections (rails guide open sections only)', () => {
    const rail = library.Spline([0, -8, 0], [0, -10, 15], [0, -5, 30]);
    expect(() =>
      library.loft([library.Ellipse(10, 8), library.Pos(0, 0, 30).mul(library.Ellipse(6, 5))], { rails: [rail] }),
    ).toThrow(/closed sections along rails are not supported/);
  });

  it('should sweep with a scale law along a spline and around a whole circle, slowly', () => {
    const path = library.Spline([0, -5, 5], [0, -1, 45], [0, 0, 85]);
    const plain = library.sweep(library.Circle(5), path);
    const { value: horn, time } = elapsed(() =>
      library.sweep(library.Circle(5), path, {
        scale: [
          [0, 1],
          [0.5, 0.5],
          [1, 2],
        ],
      }),
    );
    expect(horn.isValid()).toBe(true);
    expect(horn.volume).toBeLessThan(plain.volume);
    // Hundreds of milliseconds where a loft of seven sections takes tens: the heel recipe lofts.
    expect(time).toBeGreaterThan(50);
    const ring = library.sweep(library.Circle(1), library.CenterArc([0, 0], 10, 90, 360, library.Plane.XZ), {
      scale: [
        [0, 1],
        [0.5, 0.6],
        [1, 1],
      ],
    });
    expect(ring.isValid()).toBe(true);
    // The scale is honoured on a closed arc (not swept as a plain revolve): less than the full torus.
    expect(ring.volume).toBeLessThan(2 * Math.PI ** 2 * 10 * 0.95);
    expect(ring.volume).toBeGreaterThan(2 * Math.PI ** 2 * 10 * 0.36);
  });

  it('should split a part with the face of a surface fitted through a grid', () => {
    const grid = Array.from({ length: 9 }, (_, i) =>
      Array.from({ length: 5 }, (_, j) => {
        const x = -30 + (60 * i) / 8;
        return [x, -30 + (60 * j) / 4, 2 + 3 * Math.sin(x / 10)] as const;
      }),
    );
    const sheet = library.surface(grid);
    expect(sheet.faces()).toHaveLength(1);
    const box = library.Box(40, 40, 20);
    const below = box.split(sheet.faces()[0]!, 'below');
    const above = box.split(sheet.faces()[0]!, 'above');
    expect(below.isValid() && above.isValid()).toBe(true);
    expect(below.volume + above.volume).toBeCloseTo(box.volume, 3);
    expect(below.volume).toBeGreaterThan(box.volume / 2);
  });

  it('should refuse to draft the B-spline faces of a loft (planes, cylinders and cones only)', () => {
    const body = library.loft([library.Ellipse(20, 15), library.Pos(0, 0, 30).mul(library.Ellipse(20, 15))], {
      ruled: true,
    });
    const sides = body.faces().filter((face) => Math.abs(face.normalAt(face.interiorPoint()).z) < 0.3);
    expect(sides.every((face) => face.geomType === 'bspline')).toBe(true);
    expect(() => body.draft(sides, 2, library.Plane.XY)).toThrow(/cannot be drafted/);
    // A taper in the extrusion drafts an elliptic wall: the heel cavity is built drafted in its sections instead.
    expect(library.Ellipse(20, 15).extrude(30, { taper: 2 }).isValid()).toBe(true);
  });

  it('should render a 256 px silhouette with a pinned frame and a camera direction', () => {
    const cube = library.Box(10, 10, 10);
    library.render(cube, { size: [64, 64], supersample: 1 });
    const { value: picture, time } = elapsed(() =>
      library.render(cube, {
        view: { direction: [0, 1, 0], up: [0, 0, 1] },
        size: [256, 256],
        frame: { scale: 4, midX: 0, midY: 0 },
        background: 'white',
        supersample: 1,
      }),
    );
    expect(picture.frame).toEqual({ scale: 4, midX: 0, midY: 0 });
    let minX = 256;
    let maxX = -1;
    let minY = 256;
    let maxY = -1;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const index = (y * 256 + x) * 3;
        if (picture.pixels[index]! < 250 || picture.pixels[index + 1]! < 250 || picture.pixels[index + 2]! < 250) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    // 10 mm at 4 px/mm, centred: midX/midY is the projected point at the middle of the picture.
    expect(maxX - minX + 1).toBeGreaterThanOrEqual(40);
    expect(maxX - minX + 1).toBeLessThanOrEqual(41);
    expect(maxY - minY + 1).toBeGreaterThanOrEqual(40);
    expect(maxY - minY + 1).toBeLessThanOrEqual(41);
    expect(Math.abs((minX + maxX) / 2 - 127.5)).toBeLessThanOrEqual(1);
    expect(time).toBeLessThan(150);
  });

  it('should not taper Lato letters whose outline has collinear edges, nor faces wound clockwise', () => {
    const letter = library.Text('H', 5);
    const face = letter.faces()[0]!;
    // Text gives faces wound clockwise (normal -Z) except some letters; extruding them with a taper fails.
    expect(face.normalAt(face.interiorPoint()).z).toBeLessThan(0);
    const rewound = library.makeFace(face.outerWire().reversed());
    expect(rewound.faces()[0]!.normalAt(rewound.faces()[0]!.interiorPoint()).z).toBeGreaterThan(0);
    // Rewound, an I tapers; an H (two collinear inner edges per side) still does not.
    const i = library.Text('I', 5).faces()[0]!;
    expect(library.makeFace(i.outerWire().reversed()).extrude(0.45, { taper: 1 }).isValid()).toBe(true);
    expect(() => rewound.extrude(0.45, { taper: 1 })).toThrow(/closes the profile/);
    // The stroke of Lato Regular: stems 0.135 of the cap height, the H crossbar 0.099 (the thinnest).
    expect(library.Text('I', 10).bbox().size.x).toBeCloseTo(1.354, 2);
    expect(library.Text('H', 10).intersect(library.Rectangle(0.01, 20)).area / 0.01).toBeCloseTo(0.991, 2);
  });

  it('should read STEP contents with fromStep and keep the product names', () => {
    const step = library.toStep([library.Box(10, 10, 2).named('Telaio'), library.Cylinder(1, 12).named('Ardiglione')], {
      assembly: true,
    });
    const bodies = library.fromStep(step);
    expect(bodies).toBeInstanceOf(library.ShapeList);
    expect(
      [...(bodies as Smlib.ShapeList<Smlib.Part>)]
        .map((body) => body.name)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['Ardiglione', 'Telaio']);
  });
});
