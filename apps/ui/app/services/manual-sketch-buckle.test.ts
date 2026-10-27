// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { smlibKernel } from '@taucad/smlib';
import type { ManualDocument, ManualEdgeGeometry } from '@taucad/smlib/manual-operations';
import { esbuildBundler } from '@taucad/esbuild';
import { asKnownArtifact } from '@taucad/runtime';
import { defineRuntime } from '@taucad/runtime/worker';
import { createTestRuntimeClient } from '@taucad/runtime-testing';
import type { GeometryComponentManifest } from '@taucad/types';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import type { SketchSnap } from '@taucad/viewer/cad/sketch-geometry';
import {
  defaultSketchOperation,
  emptySketchDrawing,
  reduceSketchDrawing,
  sketchBasePlane,
  sketchCommit,
  sketchFacePlane,
} from '#services/manual-sketch.js';
import type { SketchDrawEvent, SketchDrawing } from '#services/manual-sketch.js';

vi.setConfig({ testTimeout: 120_000 });

type Face = {
  center: [number, number, number];
  normal: [number, number, number];
  geometry?: { area: number; bounds: { min: [number, number, number]; max: [number, number, number] } };
};
type Piece = {
  volumeMm3?: number;
  manualTargetName?: string;
  manualFaces?: Face[];
  manualEdges?: Array<{ geometry: ManualEdgeGeometry }>;
};

const evaluate = async (document: ManualDocument): Promise<Map<string, Piece>> => {
  const code = await readFile(
    new URL('../../../../libs/tau-examples/src/kernels/smlib/manual-buckle-fixture/main.ts', import.meta.url),
    'utf8',
  );
  const client = createTestRuntimeClient({
    runtime: defineRuntime({ kernels: [smlibKernel()], bundlers: [esbuildBundler()] }),
    files: { 'main.ts': code, 'main.ts.manual.json': JSON.stringify(document) },
  });
  const runtimeDocument = client.open({ source: { path: 'main.ts' }, watch: false });
  const view = runtimeDocument.view('model');
  try {
    const rendered = await view.rendering();
    if (rendered.superseded || !rendered.rendering.success) {
      throw new Error(`Expected a buckle rendering: ${JSON.stringify(rendered)}`);
    }
    const artifact = asKnownArtifact(rendered.rendering.artifact);
    if (artifact?.mimeType !== 'model/gltf-binary') {
      throw new Error('Expected a buckle GLB');
    }
    const manifest: GeometryComponentManifest = buildGltfComponentManifest(artifact.content);
    const pieces = new Map<string, Piece>();
    for (const node of Object.values(manifest.nodesById)) {
      const extras = node.extras as Piece | undefined;
      if (extras?.manualTargetName) {
        pieces.set(extras.manualTargetName, extras);
      }
    }
    return pieces;
  } finally {
    view.close();
    runtimeDocument.close();
    await client.shutdown();
  }
};

const draw = (events: readonly SketchDrawEvent[], start: SketchDrawing = emptySketchDrawing()): SketchDrawing => {
  let state = start;
  for (const event of events) {
    state = reduceSketchDrawing(state, event);
  }
  return state;
};
const click = (x: number, y: number): SketchDrawEvent => ({
  type: 'click',
  snap: { point: { x, y }, kind: 'free' } satisfies SketchSnap,
});

describe('a sketch on the test buckle, through the manual history and the kernel', () => {
  it('cuts a pocket from a face, revolves a ring and sweeps a wire along an edge, by their exact volumes', async () => {
    const before = await evaluate({ version: 1, operations: [] });
    const frame = before.get('Telaio fibbia')!;
    const volume = frame.volumeMm3!;
    // The frame's top face: the planar face looking up (+Z) with the largest area.
    const topFace = frame
      .manualFaces!.filter((face) => face.normal[2] > 0.99)
      .toSorted((a, b) => (b.geometry?.area ?? 0) - (a.geometry?.area ?? 0))[0]!;
    const plane = sketchFacePlane(
      { center: topFace.center, normal: topFace.normal, bounds: topFace.geometry?.bounds },
      'top',
      'Telaio fibbia',
    );
    // A 2 × 2 mm square in the middle of the +X rail: the rail is 4 mm wide.
    const railX = topFace.geometry!.bounds.max[0] - plane.frame.origin[0] - 2;
    const pocket = draw([{ type: 'tool', tool: 'rectangle' }, click(railX - 1, -1), click(railX + 1, 1)]);
    let document: ManualDocument = { version: 1, operations: [] };
    const cut = sketchCommit({
      document,
      frame: plane.frame,
      entities: pocket.entities,
      draft: { ...defaultSketchOperation('cut'), distance: 1 },
      target: 'Telaio fibbia',
      name: 'unused',
    });
    if (!('document' in cut)) {
      throw new Error(cut.error);
    }
    document = cut.document;

    // A ring on the front plane: 2 × 2 mm at 30 mm from the axis line drawn in the same sketch.
    const front = sketchBasePlane('xz', 40);
    const ringSketch = draw([
      { type: 'tool', tool: 'rectangle' },
      click(30, 10),
      click(32, 12),
      { type: 'tool', tool: 'line' },
      click(0, 0),
      click(0, 20),
      { type: 'finish' },
    ]);
    const ring = sketchCommit({
      document,
      frame: front.frame,
      entities: ringSketch.entities,
      draft: {
        ...defaultSketchOperation('new'),
        kind: 'revolve',
        angle: 360,
        axis: { start: { x: 0, y: 0 }, end: { x: 0, y: 20 }, source: 'line' },
      },
      name: 'Anello',
    });
    if (!('document' in ring)) {
      throw new Error(ring.error);
    }
    document = ring.document;

    // A wire of radius 0.3 mm along the frame's longest straight edge.
    const edge = frame
      .manualEdges!.map(({ geometry }) => geometry)
      .filter((geometry) => geometry.kind === 'line')
      .toSorted((a, b) => b.length - a.length)[0]!;
    const wireProfile = draw([{ type: 'tool', tool: 'circle' }, click(0, 0), { type: 'quota', values: [0.3] }]);
    const wire = sketchCommit({
      document,
      frame: sketchBasePlane('xy', 40).frame,
      entities: wireProfile.entities,
      draft: {
        ...defaultSketchOperation('new'),
        kind: 'sweep',
        path: { kind: 'edge', piece: 'Telaio fibbia', geometry: edge },
      },
      name: 'Filo',
    });
    if (!('document' in wire)) {
      throw new Error(wire.error);
    }

    const after = await evaluate(wire.document);
    expect(after.get('Telaio fibbia')!.volumeMm3).toBeCloseTo(volume - 2 * 2 * 1, 5);
    expect(after.get('Anello')!.volumeMm3).toBeCloseTo(Math.PI * (32 ** 2 - 30 ** 2) * 2, 4);
    expect(after.get('Filo')!.volumeMm3).toBeCloseTo(Math.PI * 0.3 ** 2 * edge.length, 4);
    expect(after.get('Ardiglione')!.volumeMm3).toBeCloseTo(before.get('Ardiglione')!.volumeMm3!, 6);
  });
});
