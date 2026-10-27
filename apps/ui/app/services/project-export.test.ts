// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { manualFaceGeometrySchema } from '@taucad/smlib/manual-operations';
import type { ManualOperation } from '@taucad/smlib/manual-operations';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import initialize from 'libcascade/single/init';
import type { OpenCascadeInstance } from 'libcascade/init';
import { replicadKernel } from '@taucad/replicad';
import { smlibKernel } from '@taucad/smlib';
import { esbuildBundler } from '@taucad/esbuild';
import { asKnownArtifact } from '@taucad/runtime';
import { defineRuntime } from '@taucad/runtime/worker';
import type { RuntimeDefinition } from '@taucad/runtime/worker';
import { createTestRuntimeClient } from '@taucad/runtime-testing';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import { createExportFile } from '@taucad/types/constants';
import type { ExportFile } from '@taucad/types';
import { createOcScope } from '@taucad/occt-core';
import { WebIO } from '@gltf-transform/core';
import { allExtensions } from '@taucad/geometry-core';
import { PDFDocument } from 'pdf-lib';
import { funzioniConsegna } from '@taucad/smlib/consegna';
import { pieceVolumeMm3 } from '#lib/piece-weight.js';
import { checkStepExport, inspectStep } from './project-export-step.js';
import { convertStepToIges } from './project-export-iges.js';
import { exportPieces, isClosedStl, prepareStl } from './project-export-mesh.js';
import {
  captureProjectPhoto,
  photoCaptureTimeout,
  prepareProjectExport,
  prepareSinopiaFiles,
  projectExportSketches,
} from './project-export.js';
import type { ProjectDelivery, ProjectExportSource } from './project-export.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const runtime: RuntimeDefinition = defineRuntime({ kernels: [replicadKernel()], bundlers: [esbuildBundler()] });
const client = createTestRuntimeClient({
  runtime,
  files: {
    'main.ts': `
  import { makeBox } from 'replicad';
  export default function main() {
    return [
      { name: 'Anello', shape: makeBox([0,0,0], [10,10,10]) },
      { name: 'Pendente', shape: makeBox([30,0,0], [40,10,10]) },
    ];
  }
`,
  },
});
let source: ProjectExportSource;
let oc: OpenCascadeInstance;
let step: Uint8Array<ArrayBuffer>;

/** Render the fixture, as the hook does, and keep its STEP bytes. */
const openSource = async (
  runtimeClient: typeof client,
  kernelId: string,
  path = 'main.ts',
): Promise<{ source: ProjectExportSource; step: Uint8Array<ArrayBuffer> }> => {
  await runtimeClient.connect();
  const document = runtimeClient.open({ source: { path }, watch: false });
  const view = document.view('model');
  const rendered = await view.rendering();
  if (rendered.superseded || !rendered.rendering.success) {
    throw new Error('FIXTURE_RENDER_FAILED');
  }
  const artifact = asKnownArtifact(rendered.rendering.artifact);
  if (artifact?.mimeType !== 'model/gltf-binary') {
    throw new Error('FIXTURE_GLB_MISSING');
  }
  const exported = await document.export('step');
  if (!exported.success) {
    throw new Error('FIXTURE_STEP_FAILED');
  }
  return {
    source: {
      document,
      client: runtimeClient,
      kernelId,
      rendering: rendered.rendering,
      pieces: exportPieces(buildGltfComponentManifest(artifact.content)),
      isCurrent: () => true,
      canCapture: () => true,
      capture: async () => [createExportFile('png', 'view', new Uint8Array([137, 80, 78, 71]))],
      verifyStep: async (request) => checkStepExport(oc, request),
    },
    step: exported.files[0].bytes,
  };
};

beforeAll(async () => {
  oc = await initialize({ print: () => undefined, printErr: () => undefined });
  ({ source, step } = await openSource(client, 'replicad'));
});
afterAll(() => {
  client.terminate();
});

const prepare = async (format: 'step' | 'stl' | 'glb', selectedNames?: string[]) =>
  prepareProjectExport({ source, format, selectedNames, signal: new AbortController().signal });

describe('project file preparation with two real engines', () => {
  it('should verify STEP solids and names after importing the Replicad export into OpenCascade', async () => {
    expect(source.pieces.map(({ name }) => name)).toEqual(['Anello', 'Pendente']);
    expect(inspectStep(oc, step)).toEqual([
      { name: 'Anello', solids: 1, valid: true },
      { name: 'Pendente', solids: 1, valid: true },
    ]);
    expect(await prepare('step')).toMatchObject({ status: 'verified' });
  });
  it('should refuse a deliberately corrupt STEP instead of showing verified', () => {
    expect(
      checkStepExport(oc, { bytes: new TextEncoder().encode('ISO-10303-21;\nBROKEN;'), expectedNames: ['Anello'] }),
    ).toEqual({ status: 'needsFix', problem: 'read' });
  });
  it('should reject missing, duplicate and wrong piece names', () => {
    for (const names of [['Anello'], ['Anello', 'Anello'], ['Anello', 'Wrong']]) {
      expect(checkStepExport(oc, { bytes: step, expectedNames: names })).toMatchObject({
        status: 'needsFix',
        problem: 'names',
      });
    }
  });
  it('should export only the chosen solid and verify the final selected STEP bytes', async () => {
    const result = await prepare('step', ['Pendente']);
    expect(result.status).toBe('verified');
    expect(inspectStep(oc, result.files![0]!.bytes)).toEqual([{ name: 'Pendente', solids: 1, valid: true }]);
  });
  it('should verify every delivered STL and retain only the selected piece', async () => {
    const result = await prepare('stl', ['Pendente']);
    expect(result).toMatchObject({ status: 'verified', files: [{ name: 'Pendente.stl' }] });
    expect(isClosedStl(result.files![0]!.bytes)).toBe(true);
  });
  it('should produce a GLB containing only the selected piece at its original position', async () => {
    const result = await prepare('glb', ['Pendente']);
    expect(result.status).toBe('ready');
    const selected = exportPieces(buildGltfComponentManifest(result.files![0]!.bytes));
    expect(selected.map(({ name }) => name)).toEqual(['Pendente']);
    expect(selected[0]!.bounds?.min[0]).toBeCloseTo(0.03, 6);
    expect(selected[0]!.bounds?.max[0]).toBeCloseTo(0.04, 6);
  });
  it('should expose reusable preparation of STEP, GLB and current-view photo', async () => {
    const files = await prepareSinopiaFiles({ source, signal: new AbortController().signal });
    expect(files.step.status).toBe('verified');
    expect(files.glb.status).toBe('ready');
    expect(files.photo).toMatchObject({ status: 'ready', files: [{ mimeType: 'image/png' }] });
  });
  it('should refuse verification from the producing engine and stale model snapshots', async () => {
    expect(
      await prepareProjectExport({
        source: { ...source, kernelId: 'opencascade' },
        format: 'step',
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'needsFix', problem: 'independent' });
    expect(
      await prepareProjectExport({
        source: { ...source, isCurrent: () => false },
        format: 'step',
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'needsFix', problem: 'changed' });
    const verify = vi.fn(source.verifyStep);
    const staleAfterExport = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    expect(
      await prepareProjectExport({
        source: { ...source, isCurrent: staleAfterExport, verifyStep: verify },
        format: 'step',
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'needsFix', problem: 'changed' });
    expect(verify).not.toHaveBeenCalled();
  });
});

/* oxlint-disable new-cap -- OpenCascade exposes C++ method names. */
/** OCCT's own analyzer on every solid of a STEP, on the file's tolerances: default and exact. */
const occtChecks = (bytes: Uint8Array<ArrayBuffer>): Array<{ standard: boolean; exact: boolean }> => {
  const scope = createOcScope();
  oc.FS.writeFile('/tmp/occt-checks.step', bytes);
  try {
    const reader = scope.track(new oc.STEPControl_Reader());
    reader.ReadFile('/tmp/occt-checks.step');
    reader.TransferRoots(scope.track(new oc.Message_ProgressRange()));
    const explorer = scope.track(
      new oc.TopExp_Explorer(scope.track(reader.OneShape()), oc.TopAbs_ShapeEnum.TopAbs_SOLID),
    );
    const checks: Array<{ standard: boolean; exact: boolean }> = [];
    while (explorer.More()) {
      const solid = scope.track(explorer.Current());
      checks.push({
        standard: scope.track(new oc.BRepCheck_Analyzer(solid, true, false, false)).IsValid(),
        exact: scope.track(new oc.BRepCheck_Analyzer(solid, true, false, true)).IsValid(),
      });
      explorer.Next();
    }
    return checks;
  } finally {
    scope.dispose();
    oc.FS.unlink('/tmp/occt-checks.step');
  }
};
/* oxlint-enable new-cap */

describe('STEP from a kernel that names each solid inside one product', () => {
  // SMLib writes one PRODUCT and names each MANIFOLD_SOLID_BREP after its piece.
  const smlibRuntime: RuntimeDefinition = defineRuntime({ kernels: [smlibKernel()], bundlers: [esbuildBundler()] });
  const smlibClient = createTestRuntimeClient({
    runtime: smlibRuntime,
    files: {
      'main.ts': `
  import { Box, Pos } from '@classcad/smlibwasm';
  export default function main() {
    return [
      { name: 'Castone marquise', shape: Box(4, 4, 4), color: '#d99a85' },
      { name: 'Pietrina più', shape: Pos(10, 0, 0).mul(Box(2, 2, 2)), color: '#e3edf2' },
      { name: "Rametto d'oro", shape: Pos(20, 0, 0).mul(Box(2, 2, 2)), color: '#d99a85' },
    ];
  }
`,
      // The marquise stone of «Collana col ramo»: its lofts leave edges about 0.56 µm from their faces.
      'marquise.ts': `
  import { Pos, Cylinder, Wire, ThreePointArc, makeFace, extrude, loft, fromSmb, toSmb } from '@classcad/smlibwasm';
  function marquise(L, W, z = 0) {
    const a = [0, L / 2, z], b = [W / 2, 0, z], c = [0, -L / 2, z], d = [-W / 2, 0, z];
    return makeFace(new Wire([ThreePointArc(a, b, c), ThreePointArc(c, d, a)]));
  }
  function pietraMarquise(L, W) {
    const g = 0.05;
    const cintura = Pos(0, 0, -g).mul(extrude(marquise(L, W), 2 * g));
    const corona = loft([marquise(L, W, g), marquise(L * 0.55, W * 0.55, g + W * 0.15)], { ruled: true });
    const padiglione = loft([marquise(L, W, -g), marquise(L * 0.03, W * 0.03, -g - W * 0.43)], { ruled: true });
    return cintura.fuse(corona).fuse(padiglione);
  }
  export default function main() {
    return [
      { name: 'Marquise', shape: fromSmb(toSmb(Pos(0, -4.6, 0).mul(pietraMarquise(8, 4)))), color: '#e3edf2' },
      { name: 'Stelo', shape: Pos(0, 2, 0).mul(Cylinder(0.7, 15)), color: '#d99a85' },
    ];
  }
`,
    },
  });
  const names = ['Castone marquise', 'Pietrina più', "Rametto d'oro"];
  let smlib: Awaited<ReturnType<typeof openSource>>;
  let marquise: Awaited<ReturnType<typeof openSource>>;
  beforeAll(async () => {
    smlib = await openSource(smlibClient, 'smlib');
    marquise = await openSource(smlibClient, 'smlib', 'marquise.ts');
  });
  afterAll(() => {
    smlibClient.terminate();
  });

  it('should read every named piece, with accents and apostrophes, and verify the STEP', async () => {
    expect(smlib.source.pieces.map(({ name }) => name)).toEqual(names);
    // The browser checks each file in a new worker, so the first read of a new engine must already see the names.
    const fresh = await initialize({ print: () => undefined, printErr: () => undefined });
    expect(inspectStep(fresh, smlib.step)).toEqual(names.map((name) => ({ name, solids: 1, valid: true })));
    expect(
      await prepareProjectExport({ source: smlib.source, format: 'step', signal: new AbortController().signal }),
    ).toMatchObject({ status: 'verified' });
  });
  it('should verify a single selected piece after writing it on its own', async () => {
    const result = await prepareProjectExport({
      source: smlib.source,
      format: 'step',
      selectedNames: ['Pietrina più'],
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('verified');
    expect(inspectStep(oc, result.files![0]!.bytes)).toEqual([{ name: 'Pietrina più', solids: 1, valid: true }]);
  });
  it('should name the pieces that really differ between the file and the model', () => {
    expect(
      checkStepExport(oc, { bytes: smlib.step, expectedNames: ['Castone marquise', 'Pietrina più', 'Anellino'] }),
    ).toEqual({ status: 'needsFix', problem: 'names', pieces: ['Anellino', "Rametto d'oro"] });
  });
  it('should verify a sub-micron gap that only the exact check reports', () => {
    expect(occtChecks(marquise.step)).toEqual([
      { standard: true, exact: false },
      { standard: true, exact: true },
    ]);
    expect(checkStepExport(oc, { bytes: marquise.step, expectedNames: ['Marquise', 'Stelo'] })).toMatchObject({
      status: 'verified',
      pieces: [
        { name: 'Marquise', solids: 1, valid: true },
        { name: 'Stelo', solids: 1, valid: true },
      ],
    });
  });
  it('should name a piece whose edges are more than 1 µm from its faces', () => {
    // The same file in centimetres: the stone is ten times larger, and so is its gap (about 5.6 µm).
    const text = new TextDecoder().decode(marquise.step);
    expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
    const larger = new TextEncoder().encode(text.replace('SI_UNIT(.MILLI.,.METRE.)', 'SI_UNIT(.CENTI.,.METRE.)'));
    expect(occtChecks(larger)).toEqual([
      { standard: true, exact: false },
      { standard: true, exact: true },
    ]);
    expect(checkStepExport(oc, { bytes: larger, expectedNames: ['Marquise', 'Stelo'] })).toEqual({
      status: 'needsFix',
      problem: 'invalid',
      pieces: ['Marquise'],
    });
  });
  it('should never verify a gap the reader covered by widening a tolerance', () => {
    // Moving one corner of a box by 0.05 mm still passes OCCT's checks once the reader has widened its tolerance.
    const text = new TextDecoder().decode(smlib.step);
    const vertex = /VERTEX_POINT\('[^']*',#(\d+)\)/u.exec(text)?.[1];
    const point = new RegExp(String.raw`#${vertex}=CARTESIAN_POINT\('[^']*',\(([^,]+),`, 'u').exec(text);
    expect(point).not.toBeNull();
    const moved = text.replace(point![0], point![0].replace(`(${point![1]},`, `(${Number(point![1]) + 0.05},`));
    expect(occtChecks(new TextEncoder().encode(moved))[0]).toEqual({ standard: true, exact: true });
    expect(checkStepExport(oc, { bytes: new TextEncoder().encode(moved), expectedNames: names })).toEqual({
      status: 'needsFix',
      problem: 'invalid',
      pieces: ['Castone marquise'],
    });
  });
  it('should keep two solids under one name as one piece for the solids check', () => {
    const text = new TextDecoder()
      .decode(smlib.step)
      .replace("'Rametto d''oro'", String.raw`'Pietrina pi\X2\00F9\X0\'`);
    expect(
      checkStepExport(oc, {
        bytes: new TextEncoder().encode(text),
        expectedNames: ['Castone marquise', 'Pietrina più'],
      }),
    ).toEqual({ status: 'needsFix', problem: 'solids' });
  });
});

describe('saved sketches and solid exports', () => {
  const sketch = {
    id: 'saved-outline',
    type: 'sketch',
    name: 'Profilo aperto',
    profile: {
      kind: 'polygon',
      plane: 'xy',
      origin: [0, 0, 0],
      closed: false,
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 10, y: 5 },
      ],
    },
  } satisfies ManualOperation;

  const withSketch = async (mixed: boolean, run: (input: ProjectExportSource) => Promise<void>): Promise<void> => {
    const sketchRuntime: RuntimeDefinition = defineRuntime({ kernels: [smlibKernel()], bundlers: [esbuildBundler()] });
    const runtimeClient = createTestRuntimeClient({
      runtime: sketchRuntime,
      files: {
        'main.ts': `import { Box } from '@classcad/smlibwasm'; export default function main() { return ${mixed ? "[{ name: 'Corpo', shape: Box(10, 10, 10) }]" : '[]'}; }`,
        'main.ts.manual.json': JSON.stringify({ version: 1, operations: [sketch] }),
      },
    });
    await runtimeClient.connect();
    const document = runtimeClient.open({ source: { path: 'main.ts' }, watch: false });
    const view = document.view(mixed ? 'model' : 'drawing');
    try {
      const rendered = await view.rendering();
      const evaluated = await document.evaluation();
      if (rendered.superseded || !rendered.rendering.success || evaluated.superseded || !evaluated.evaluation.success) {
        throw new Error('Expected saved sketch evaluation and render');
      }
      const { rendering } = rendered;
      const { evaluation } = evaluated;
      expect(evaluation.views.find((offered) => offered.id === 'drawing')?.instances).toEqual([
        { id: 'Profilo aperto', title: 'Profilo aperto' },
      ]);
      const sketches = projectExportSketches({ kernelId: 'smlib', evaluation, rendering });
      expect(sketches).toBe(mixed ? 'mixed' : 'only');
      expect(
        projectExportSketches({ kernelId: 'smlib', evaluation: { ...evaluation, id: 'newer' }, rendering }),
      ).toBeUndefined();
      expect(
        projectExportSketches({ kernelId: 'smlib', evaluation: { ...evaluation, transient: true }, rendering }),
      ).toBeUndefined();
      expect(
        projectExportSketches({ kernelId: 'smlib', evaluation: { ...evaluation, success: false }, rendering }),
      ).toBeUndefined();
      expect(
        projectExportSketches({
          kernelId: 'smlib',
          evaluation: { ...evaluation, sourceRevision: { entry: 'other.ts', files: {} } },
          rendering,
        }),
      ).toBeUndefined();
      expect(
        projectExportSketches({
          kernelId: 'smlib',
          evaluation: { ...evaluation, views: evaluation.views.filter((offered) => offered.id !== 'drawing') },
          rendering,
        }),
      ).toBeUndefined();
      const artifact = asKnownArtifact(rendering.artifact);
      await run({
        ...source,
        document,
        client: runtimeClient,
        kernelId: 'smlib',
        rendering,
        sketches,
        pieces:
          artifact?.mimeType === 'model/gltf-binary' ? exportPieces(buildGltfComponentManifest(artifact.content)) : [],
      });
    } finally {
      view.close();
      document.close();
      await runtimeClient.shutdown();
    }
  };

  it('should refuse every 3D file before invoking export for a saved open sketch and keep photo available', async () => {
    await withSketch(false, async (drawing) => {
      const nativeExport = vi.spyOn(drawing.document, 'export');
      const verifyStep = vi.fn(drawing.verifyStep);
      const prepared = await Promise.all(
        (['step', 'stl', 'glb'] as const).map(async (format) =>
          prepareProjectExport({ source: { ...drawing, verifyStep }, format, signal: new AbortController().signal }),
        ),
      );
      expect(prepared).toEqual(Array.from({ length: 3 }, () => ({ status: 'needsFix', problem: 'sketchOnly' })));
      expect(nativeExport).not.toHaveBeenCalled();
      expect(verifyStep).not.toHaveBeenCalled();
      expect(
        await prepareProjectExport({ source: drawing, format: 'png', signal: new AbortController().signal }),
      ).toEqual({ status: 'ready', files: [] });
      expect(await captureProjectPhoto({ source: drawing, signal: new AbortController().signal })).toMatchObject({
        status: 'ready',
        files: [{ mimeType: 'image/png' }],
      });
    });
  });

  it('should exclude a saved sketch while independently verifying the actual mixed-model solids', async () => {
    await withSketch(true, async (mixed) => {
      expect(mixed.pieces.map((piece) => piece.name)).toEqual(['Corpo']);
      const step = await prepareProjectExport({ source: mixed, format: 'step', signal: new AbortController().signal });
      expect(step.status).toBe('verified');
      expect(inspectStep(oc, step.files![0]!.bytes)).toEqual([{ name: 'Corpo', solids: 1, valid: true }]);
      const glb = await prepareProjectExport({ source: mixed, format: 'glb', signal: new AbortController().signal });
      expect(glb.status).toBe('ready');
      expect(exportPieces(buildGltfComponentManifest(glb.files![0]!.bytes)).map((piece) => piece.name)).toEqual([
        'Corpo',
      ]);
      const stl = await prepareProjectExport({ source: mixed, format: 'stl', signal: new AbortController().signal });
      expect(stl).toMatchObject({ status: 'verified', files: [{ name: 'Corpo.stl' }] });
    });
  });
});

describe('current-view photo', () => {
  it('should be ready as soon as a snapshot can be taken, without waiting for a render', async () => {
    // A headless render that never comes back must not keep the row checking.
    const capture = vi.fn(
      async (): Promise<ExportFile[]> =>
        new Promise(() => {
          // Intentionally unresolved, like a render that never comes back.
        }),
    );
    const checked = prepareProjectExport({
      source: { ...source, capture },
      format: 'png',
      signal: new AbortController().signal,
    });
    const stillChecking = new Promise((resolve) => {
      setTimeout(resolve, 1000, 'still checking');
    });
    expect(await Promise.race([checked, stillChecking])).toEqual({ status: 'ready', files: [] });
    expect(capture).not.toHaveBeenCalled();
  });
  it('should not offer a photo while the view cannot be captured', async () => {
    expect(
      await prepareProjectExport({
        source: { ...source, canCapture: () => false },
        format: 'png',
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'needsFix', problem: 'capture' });
  });
  it('should give up a capture that never returns and cancel its render', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let captureSignal: AbortSignal | undefined;
      const pending = captureProjectPhoto({
        source: {
          ...source,
          capture: async (signal): Promise<ExportFile[]> => {
            captureSignal = signal;
            return new Promise(() => {
              // Intentionally unresolved, like a render that never comes back.
            });
          },
        },
        signal: new AbortController().signal,
      });
      await vi.advanceTimersByTimeAsync(photoCaptureTimeout);
      expect(await pending).toEqual({ status: 'needsFix', problem: 'capture' });
      expect(captureSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

const openStl = new TextEncoder().encode(`solid Open
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid Open`);

describe('STL closure', () => {
  it('should name open pieces and preserve their bytes for download anyway', () => {
    const file = createExportFile('stl', 'Anellino', openStl);
    expect(prepareStl([file], ['Anellino'], ['Anellino'])).toEqual({
      status: 'needsFix',
      problem: 'invalid',
      pieces: ['Anellino'],
      files: [file],
    });
  });
  it('should reject empty, invalid and non-manifold mesh bytes', () => {
    expect(isClosedStl(new Uint8Array())).toBe(false);
    expect(isClosedStl(new TextEncoder().encode('not an STL'))).toBe(false);
    const facet = new TextDecoder().decode(openStl).split('solid Open\n')[1]!.split('endsolid')[0]!;
    expect(isClosedStl(new TextEncoder().encode(`solid Open\n${facet.repeat(3)}endsolid Open`))).toBe(false);
  });
});

describe('independent STEP qualification of manual plate edits', () => {
  it('preserves the existing fillet refusal while verifying hole and fractional face edits without that fillet', async () => {
    const code = await readFile(
      new URL('../../../../libs/tau-examples/src/kernels/smlib/parametric-plate/main.ts', import.meta.url),
      'utf8',
    );
    const metadataSchema = z.object({
      manualBodySignature: z.string(),
      manualReplayWitness: z.string(),
      manualFaces: z.array(z.object({ index: z.number(), geometry: manualFaceGeometrySchema })),
    });
    const productionRuntime = defineRuntime({ kernels: [smlibKernel()], bundlers: [esbuildBundler()] });
    const evaluate = async (edgeRadius: number, operations: ManualOperation[]) => {
      const runtimeClient = createTestRuntimeClient({
        runtime: productionRuntime,
        files: {
          'main.ts': code,
          'main.ts.manual.json': JSON.stringify({ version: 1, operations }),
        },
      });
      const document = runtimeClient.open({
        source: { path: 'main.ts' },
        parameters: { width: 64, edgeRadius },
        watch: false,
      });
      const view = document.view('model', { content: { includeTopology: true } });
      try {
        const rendered = await view.rendering();
        if (rendered.superseded || !rendered.rendering.success) {
          throw new Error('Expected production plate rendering');
        }
        const artifact = asKnownArtifact(rendered.rendering.artifact);
        if (artifact?.mimeType !== 'model/gltf-binary') {
          throw new Error('Expected production plate GLB');
        }
        const pieces = exportPieces(buildGltfComponentManifest(artifact.content));
        const metadata = metadataSchema.parse(pieces[0]?.extras);
        const exported = await document.export('step');
        if (!exported.success) {
          throw new Error('Expected exact plate STEP export');
        }
        return { bytes: exported.files[0].bytes, metadata };
      } finally {
        view.close();
        document.close();
        await runtimeClient.shutdown();
      }
    };
    const names = ['Mounting plate'];
    const existingFillet = await evaluate(1, []);
    expect(occtChecks(existingFillet.bytes)).toEqual([{ standard: true, exact: false }]);
    expect(checkStepExport(oc, { bytes: existingFillet.bytes, expectedNames: names })).toEqual({
      status: 'needsFix',
      problem: 'invalid',
      pieces: names,
    });
    const hole: ManualOperation = {
      id: 'hole-seven',
      type: 'hole',
      target: { name: names[0]! },
      center: [0, 0, -10],
      axis: [0, 0, 1],
      diameter: 7,
      depth: 20,
    };
    const drilled = await evaluate(0, [hole]);
    const faceOperation = (metadata: z.infer<typeof metadataSchema>, distance: number, id: string): ManualOperation => {
      const face = metadata.manualFaces.find(({ geometry }) => geometry.normal[2] > 0.9);
      if (!face) {
        throw new Error('Expected native top face');
      }
      return {
        id,
        type: 'faceExtrude',
        target: { name: names[0]! },
        distance,
        face: {
          index: face.index,
          bodySignature: metadata.manualBodySignature,
          replayWitness: metadata.manualReplayWitness,
          geometry: face.geometry,
          point: [6, 5, face.geometry.center[2]],
        },
      };
    };
    const push = faceOperation(drilled.metadata, 2.656510805040839, 'fractional-push');
    const grown = await evaluate(0, [hole, push]);
    const pull = faceOperation(grown.metadata, -1.2553900877316408, 'fractional-pull');
    const final = await evaluate(0, [hole, push, pull]);
    expect(inspectStep(oc, final.bytes)).toEqual([{ name: names[0], solids: 1, valid: true }]);
    expect(checkStepExport(oc, { bytes: final.bytes, expectedNames: names })).toMatchObject({ status: 'verified' });
  });
});

describe('SinopiaCAD delivery of an SMLib model (E3a): SMLib writes and checks, OpenCASCADE only converts IGES', () => {
  const deliveryRuntime: RuntimeDefinition = defineRuntime({ kernels: [smlibKernel()], bundlers: [esbuildBundler()] });
  const deliveryClient = createTestRuntimeClient({
    runtime: deliveryRuntime,
    files: {
      'main.ts': `
  import { Box, Cylinder, Pos } from '@classcad/smlibwasm';
  export default function main() {
    return [
      { name: 'Telaio', shape: Box(40, 20, 3).cut(Pos(0, 0, -2).mul(Cylinder(3, 10))), color: '#9aa0a6' },
      { name: 'Ardiglione', shape: Pos(0, 0, 3).mul(Box(2, 18, 2)), color: '#9aa0a6' },
    ];
  }
`,
    },
  });
  let opened: Awaited<ReturnType<typeof openSource>>;
  let delivery: ProjectDelivery;
  let lib: typeof import('@classcad/smlibwasm');
  beforeAll(async () => {
    opened = await openSource(deliveryClient, 'smlib');
    lib = await import('@classcad/smlibwasm');
    const funzioni = funzioniConsegna(lib);
    delivery = {
      consegna: {
        step: async (richiesta) => funzioni.step(richiesta),
        rileggi: async (richiesta) => funzioni.rileggi(richiesta),
        dxf: async (richiesta) => funzioni.dxf(richiesta),
        tavola: async (richiesta) => funzioni.tavola(richiesta),
      },
      convertIges: async (bytes) => convertStepToIges(oc, bytes),
      projectName: 'Fibbia prova',
      pieces: opened.source.pieces.map((node) => ({
        nome: node.name,
        volumeMm3: pieceVolumeMm3(node)!,
        ...(node.name === 'Telaio' ? { materiale: { chiave: 'ottone', nome: 'Ottone', colore: '#b8995a' } } : {}),
      })),
      glbMaterials: new Map([
        [
          'Telaio',
          {
            chiave: 'ottone',
            nome: 'Ottone',
            colore: '#b8995a',
            metalness: 1,
            roughness: 0.3,
            processo: 'tranciatura_lamiera',
          },
        ],
      ]),
      sheet: (drawings, selectedNames, versionLabel) => ({
        progetto: 'Fibbia prova',
        selezione: selectedNames?.join(', ') ?? 'Tutti i pezzi',
        versione: versionLabel ?? 'Bozza',
        data: new Date('2026-10-27T10:00:00Z'),
        lingua: 'it',
        viste: drawings.viste,
        ingombro: drawings.ingombro,
        pezzi: [{ nome: 'Telaio', materiale: 'Ottone' }],
        misure: [],
        controlli: [],
        testi: {
          titolo: 'Tavola tecnica',
          progetto: 'Progetto',
          pezzi: 'Pezzi',
          versione: 'Versione',
          data: 'Data',
          scala: 'Scala',
          unita: 'mm',
          proiezione: 'primo diedro (ISO)',
          foglio: 'Foglio',
          fronte: 'Fronte',
          lato: 'Lato sinistro',
          alto: 'Dall’alto',
          isometrica: 'Isometrica',
          nonInScala: 'non in scala',
          colonnaPezzo: 'Pezzo',
          colonnaMateriale: 'Materiale',
          colonnaProcesso: 'Processo',
          colonnaPeso: 'Peso',
          pesoTotale: 'Peso totale',
          misure: 'Misure principali',
          producibilita: 'Producibilità',
          nessunControllo: 'Nessun controllo',
          livelli: { blocco: 'Blocco', avviso: 'Avviso', ok: 'Ok', info: 'Nota' },
          note: 'Note',
          segue: 'Segue',
        },
      }),
    };
  });
  afterAll(() => {
    deliveryClient.terminate();
  });
  const prepareDelivered = async (
    format: 'step' | 'iges' | 'dxf' | 'pdf' | 'glb',
    selectedNames?: string[],
    overrides: Partial<ProjectExportSource> = {},
  ) =>
    prepareProjectExport({
      source: { ...opened.source, delivery, ...overrides },
      format,
      selectedNames,
      signal: new AbortController().signal,
    });

  it('should verify the STEP by reading it back with SMLib, never calling the OpenCASCADE check', async () => {
    const verifyStep = vi.fn(opened.source.verifyStep);
    const result = await prepareDelivered('step', undefined, { verifyStep });
    expect(result.status).toBe('verified');
    expect(verifyStep).not.toHaveBeenCalled();
    if (result.status !== 'verified') {
      return;
    }
    const read = [...(lib.fromStep(result.files[0]!.bytes) as Iterable<{ name: string | null; volume: number }>)];
    expect(read.map(({ name }) => name).sort()).toEqual(['Ardiglione', 'Telaio · Ottone']);
    expect(result.measured?.size.map((value) => Math.round(value * 1000) / 1000)).toEqual([40, 20, 5.5]);
    expect(result.measured?.pieces.map(({ name }) => name)).toEqual(['Telaio', 'Ardiglione']);
  });

  it('should refuse a STEP whose volume differs from the Measures, naming the piece', async () => {
    const wrong: ProjectDelivery = {
      ...delivery,
      pieces: delivery.pieces.map((piece) => (piece.nome === 'Ardiglione' ? { ...piece, volumeMm3: 100 } : piece)),
    };
    expect(await prepareDelivered('step', undefined, { delivery: wrong })).toEqual({
      status: 'needsFix',
      problem: 'volume',
      pieces: ['Ardiglione'],
    });
  });

  it('should deliver an IGES of solids converted by OpenCASCADE and read back by SMLib', async () => {
    const result = await prepareDelivered('iges', ['Telaio']);
    expect(result).toMatchObject({ status: 'verified', files: [{ name: 'model.iges', mimeType: 'application/iges' }] });
    if (result.status === 'verified') {
      expect(new TextDecoder().decode(result.files[0]!.bytes)).toMatch(/^ {5}186 /mu);
    }
  });

  it('should write the true-size outline of the flat frame and the views of the whole buckle', async () => {
    const outline = await prepareDelivered('dxf', ['Telaio']);
    expect(outline).toMatchObject({ status: 'verified', files: [{ name: 'model.dxf', mimeType: 'application/dxf' }] });
    if (outline.status === 'verified') {
      const text = new TextDecoder().decode(outline.files[0]!.bytes);
      expect(text.match(/\nCIRCLE\r?\n/gu)).toHaveLength(1);
      expect(text).not.toContain('HIDDEN');
    }
    const views = await prepareDelivered('dxf');
    expect(views.status).toBe('verified');
    if (views.status === 'verified') {
      expect(new TextDecoder().decode(views.files[0]!.bytes)).toContain('HIDDEN');
    }
  });

  it('should make the PDF sheet from the SMLib drawings, with the version it is given', async () => {
    const result = await prepareProjectExport({
      source: { ...opened.source, delivery },
      format: 'pdf',
      signal: new AbortController().signal,
      versionLabel: 'v4',
    });
    expect(result).toMatchObject({
      status: 'ready',
      files: [{ name: 'Fibbia prova.pdf', mimeType: 'application/pdf' }],
    });
    if (result.status === 'ready') {
      const pdf = await PDFDocument.load(result.files[0]!.bytes);
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getTitle()).toBe('Tavola tecnica — Fibbia prova');
    }
  });

  it('should name each piece’s material in the GLB, with its process in the node extras', async () => {
    const result = await prepareDelivered('glb');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') {
      return;
    }
    const document = await new WebIO().registerExtensions(allExtensions).readBinary(result.files[0]!.bytes);
    const ottone = document
      .getRoot()
      .listMaterials()
      .find((material) => material.getName() === 'Ottone');
    expect(ottone?.getMetallicFactor()).toBe(1);
    const nodes = document.getRoot().listNodes();
    const telaio = nodes.find(
      (node) => (node.getExtras() as { sinopiacad?: { pezzo?: string } }).sinopiacad?.pezzo === 'Telaio',
    );
    expect(telaio?.getExtras()).toMatchObject({
      sinopiacad: { materiale: 'ottone', nomeMateriale: 'Ottone', processo: 'tranciatura_lamiera' },
    });
    // The pin has no material picked: it keeps the colour it was modelled with.
    expect(
      nodes.some(
        (node) => (node.getExtras() as { sinopiacad?: { pezzo?: string } }).sinopiacad?.pezzo === 'Ardiglione',
      ),
    ).toBe(false);
  });

  it('should prepare the Sinopia handoff with the sheet, and keep IGES, DXF and PDF away from other kernels', async () => {
    const files = await prepareSinopiaFiles({
      source: { ...opened.source, delivery },
      signal: new AbortController().signal,
    });
    expect(files.step.status).toBe('verified');
    expect(files.pdf).toMatchObject({ status: 'ready', files: [{ mimeType: 'application/pdf' }] });
    for (const format of ['iges', 'dxf', 'pdf'] as const) {
      expect(
        await prepareProjectExport({ source: { ...source, delivery }, format, signal: new AbortController().signal }),
      ).toEqual({ status: 'needsFix', problem: 'unavailable' });
    }
  });
});
