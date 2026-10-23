// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import initialize from 'libcascade/single/init';
import type { OpenCascadeInstance } from 'libcascade/init';
import { replicadKernel } from '@taucad/replicad';
import { esbuildBundler } from '@taucad/esbuild';
import { asKnownArtifact } from '@taucad/runtime';
import { defineRuntime } from '@taucad/runtime/worker';
import type { RuntimeDefinition } from '@taucad/runtime/worker';
import { createTestRuntimeClient } from '@taucad/runtime-testing';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import { createExportFile } from '@taucad/types/constants';
import { checkStepExport, inspectStep } from './project-export-step.js';
import { exportPieces, isClosedStl, prepareStl } from './project-export-mesh.js';
import { prepareProjectExport, prepareSinopiaFiles } from './project-export.js';
import type { ProjectExportSource } from './project-export.js';

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

beforeAll(async () => {
  oc = await initialize({ print: () => undefined, printErr: () => undefined });
  await client.connect();
  const document = client.open({ source: { path: 'main.ts' }, watch: false });
  const view = document.view('model');
  const rendered = await view.rendering();
  if (rendered.superseded || !rendered.rendering.success) {
    throw new Error('FIXTURE_RENDER_FAILED');
  }
  const artifact = asKnownArtifact(rendered.rendering.artifact);
  if (artifact?.mimeType !== 'model/gltf-binary') {
    throw new Error('FIXTURE_GLB_MISSING');
  }
  source = {
    document,
    client,
    kernelId: 'replicad',
    rendering: rendered.rendering,
    pieces: exportPieces(buildGltfComponentManifest(artifact.content)),
    isCurrent: () => true,
    capture: async () => [createExportFile('png', 'view', new Uint8Array([137, 80, 78, 71]))],
    verifyStep: async (request) => checkStepExport(oc, request),
  };
  const exported = await document.export('step');
  if (!exported.success) {
    throw new Error('FIXTURE_STEP_FAILED');
  }
  step = exported.files[0].bytes;
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
      expect(checkStepExport(oc, { bytes: step, expectedNames: names })).toEqual({
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
