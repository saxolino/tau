// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import initialize from 'libcascade/single/init';
import type { OpenCascadeInstance } from 'libcascade/init';
import { smlibKernel } from '@taucad/smlib';
import type { ManualOperation } from '@taucad/smlib/manual-operations';
import { esbuildBundler } from '@taucad/esbuild';
import { asKnownArtifact } from '@taucad/runtime';
import { defineRuntime } from '@taucad/runtime/worker';
import { createTestRuntimeClient } from '@taucad/runtime-testing';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import { checkStepExport, inspectStep } from './project-export-step.js';
import { exportPieces } from './project-export-mesh.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await initialize({ print: () => undefined, printErr: () => undefined });
});

describe('manual buckle acceptance', () => {
  it('should export two separately named valid solids after independently moving the pin', async () => {
    const code = await readFile(
      new URL('../../../../libs/tau-examples/src/kernels/smlib/manual-buckle-fixture/main.ts', import.meta.url),
      'utf8',
    );
    const evaluate = async (operations: ManualOperation[]) => {
      const client = createTestRuntimeClient({
        runtime: defineRuntime({ kernels: [smlibKernel()], bundlers: [esbuildBundler()] }),
        files: {
          'main.ts': code,
          'main.ts.manual.json': JSON.stringify({ version: 1, operations }),
        },
      });
      const document = client.open({ source: { path: 'main.ts' }, watch: false });
      const view = document.view('model');
      try {
        const rendered = await view.rendering();
        if (rendered.superseded || !rendered.rendering.success) {
          throw new Error('Expected buckle rendering');
        }
        const artifact = asKnownArtifact(rendered.rendering.artifact);
        if (artifact?.mimeType !== 'model/gltf-binary') {
          throw new Error('Expected buckle GLB');
        }
        const pieces = exportPieces(buildGltfComponentManifest(artifact.content));
        const exported = await document.export('step');
        if (!exported.success) {
          throw new Error(JSON.stringify(exported.issues));
        }
        return { bytes: exported.files[0].bytes, pieces };
      } finally {
        view.close();
        document.close();
        await client.shutdown();
      }
    };
    const base = await evaluate([]);
    const moved = await evaluate([
      { id: 'explode-pin', type: 'translate', target: { name: 'Ardiglione' }, delta: [12, 0, 8] },
    ]);
    const names = ['Telaio fibbia', 'Ardiglione'];
    expect(inspectStep(oc, moved.bytes)).toEqual(names.map((name) => ({ name, solids: 1, valid: true })));
    expect(checkStepExport(oc, { bytes: moved.bytes, expectedNames: names })).toMatchObject({ status: 'verified' });
    expect(moved.pieces.find(({ name }) => name === names[0])?.bounds).toEqual(
      base.pieces.find(({ name }) => name === names[0])?.bounds,
    );
    const before = base.pieces.find(({ name }) => name === names[1])?.bounds;
    const after = moved.pieces.find(({ name }) => name === names[1])?.bounds;
    if (!before || !after) {
      throw new Error('Expected independent pin geometry bounds');
    }
    // The pin reaches the front rail, and its eye projects below the frame mid-plane.
    expect(before.min[2]).toBeCloseTo(-0.0215, 6);
    expect(before.max[2]).toBeCloseTo(0.0029, 6);
    expect(before.min[1]).toBeCloseTo(-0.0009, 6);
    expect(before.max[1]).toBeCloseTo(0.0065, 6);
    // The glTF metre coordinates are Y-up: a native +8 mm Z displacement is +0.008 m Y.
    for (const corner of ['min', 'max'] as const) {
      expect(after[corner][0] - before[corner][0]).toBeCloseTo(0.012, 7);
      expect(after[corner][1] - before[corner][1]).toBeCloseTo(0.008, 7);
      expect(after[corner][2] - before[corner][2]).toBeCloseTo(0, 7);
    }
  });
});
