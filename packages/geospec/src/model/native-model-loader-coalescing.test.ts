import type { VmFileSystem } from '@taucad/esbuild/vm';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { RuntimeDocument } from '@taucad/runtime/client';
import type { KernelIssue, SourceRevision } from '@taucad/runtime/types';
import { createGeoSpecNativeModelLoader } from '#model/native-model-loader.js';
import type { GeoSpecNativeLoadModelOptions, GeoSpecNativeModelEngine } from '#model/native-model-loader.js';
import type { GeoSpecLoadRegion, GeoSpecRuntimeClient } from '#model/types.js';
import type { GeoSpecExportRoute } from '#model/export-intent.js';
import { rawSubjectResidency, resolveGeoSpecSubject, bindGeoSpecSubject } from '#model/subject.js';
import { createGeoSpecAssertionClient } from '#assertion-client/client.js';
import { runGeoSpecModule } from '#runner/index.js';

const encode = (value: unknown): Uint8Array<ArrayBuffer> => new TextEncoder().encode(JSON.stringify(value));
const decodeRequest = (bytes: Uint8Array<ArrayBuffer>): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

// SAFETY: the fixture constructs an exact 64-hex SHA-256 digest for source revision identity.
const digest = (fill: string): Exclude<SourceRevision['files'][string], 'missing'> =>
  `sha256:${fill.repeat(64)}` as Exclude<SourceRevision['files'][string], 'missing'>;

type SnapshotSource = NonNullable<GeoSpecRuntimeClient['snapshotSource']>;
type SnapshotResult = Awaited<ReturnType<SnapshotSource>>;

/** One engine whose subject identity is the first primary byte, with release accounting. */
const fixtureEngine = () => {
  const released: string[] = [];
  const ingestSubject = vi.fn(
    (
      _request: Uint8Array<ArrayBuffer>,
      primary: Uint8Array<ArrayBuffer>,
      _resources: ReadonlyArray<Uint8Array<ArrayBuffer>>,
    ) =>
      encode({
        result: { subject: { subjectHash: String(primary[0]).repeat(64) } },
      }),
  );
  const engine: GeoSpecNativeModelEngine = {
    evaluateClaim: (input) => ({
      canonicalClaim: input,
      canonicalPlan: input,
      canonicalResult: input,
    }),
    processRequest: () =>
      encode({
        requestId: 'configuration',
        result: {
          canonicalProfile: 'geospec-jcs-v1',
          protocolVersion: 3,
          registryVersion: 5,
          configuration: {
            binaryAdmissionLimits: {
              maxSubjectBytes: 1024,
              maxTotalBinaryBytes: 1024,
            },
          },
        },
      }),
    ingestSubject,
    subjectHandle: (request) =>
      encode({
        result: {
          subjectHandle: {
            subjectHash: decodeRequest(request)['subjectHash'],
            generation: 1,
          },
        },
      }),
    releaseSubject: (request) => {
      const handle = decodeRequest(request)['subjectHandle'] as {
        subjectHash: string;
      };
      released.push(handle.subjectHash[0]!);
      return encode({ result: {} });
    },
  };
  return { engine, ingestSubject, released };
};

/** A file-backed Runtime whose export revision and snapshot follow the mutable source digests. */
const fixtureRuntime = (
  options: {
    snapshot?: boolean;
    issues?: (exportOptions: unknown) => KernelIssue[];
  } = {},
) => {
  const files: Record<string, SourceRevision['files'][string]> = {
    'main.ts': digest('a'),
    'part.ts': digest('b'),
  };
  const byte = { value: 7 };
  const document = mock<RuntimeDocument>();
  document.export.mockImplementation(async (_format, request) => ({
    success: true,
    exportId: 'glb',
    evaluationId: 'evaluation-1',
    issues: options.issues?.(request?.options) ?? [],
    sourceRevision: { entry: 'main.ts', files: { ...files } },
    files: [
      {
        name: 'model.glb',
        mimeType: 'model/gltf-binary',
        bytes: Uint8Array.of(byte.value),
      },
    ],
  }));
  const snapshotSource = vi.fn<SnapshotSource>(
    async (): Promise<SnapshotResult> => ({
      success: true,
      data: {
        entryPath: 'main.ts',
        files: [],
        unresolvedPaths: [],
        kernelId: 'fixture',
      },
      issues: [],
      sourceRevision: { entry: 'main.ts', files: { ...files } },
    }),
  );
  const open = vi.fn(() => document);
  const runtime: GeoSpecRuntimeClient = {
    connect: async () => undefined,
    terminate: () => undefined,
    open,
    ...(options.snapshot === false ? {} : { snapshotSource }),
  };
  return { runtime, document, open, snapshotSource, files, byte };
};

describe('native model loader run coalescing', () => {
  it('should export and ingest identical file loads once and record each load as its own reuse', async () => {
    const { engine, ingestSubject } = fixtureEngine();
    const { runtime, document, snapshotSource } = fixtureRuntime();
    const loader = createGeoSpecNativeModelLoader({ engine, runtime });
    try {
      const first = await loader({
        file: 'main.ts',
        parameters: { width: 2, depth: { value: 1 } },
      });
      const second = await loader({
        file: 'main.ts',
        parameters: { depth: { value: 1 }, width: 2 },
      });
      expect(document.export).toHaveBeenCalledOnce();
      expect(ingestSubject).toHaveBeenCalledOnce();
      expect(snapshotSource).toHaveBeenCalledWith({
        source: { path: 'main.ts' },
      });
      expect(second.subjectHash).toBe(first.subjectHash);
      expect(first.load).not.toHaveProperty('reused');
      expect(second.load).toMatchObject({
        reused: true,
        artifacts: first.load?.artifacts,
      });
      expect(second.load?.loadId).not.toBe(first.load?.loadId);
      rawSubjectResidency(second)!();
    } finally {
      await loader.releaseAll();
    }
  });

  it('should export again when the source closure changed, a dependency joined it, or it cannot be confirmed', async () => {
    const { engine, ingestSubject } = fixtureEngine();
    const changed = fixtureRuntime();
    const loader = createGeoSpecNativeModelLoader({
      engine,
      runtime: changed.runtime,
    });
    try {
      await loader({ file: 'main.ts' });
      changed.files['part.ts'] = digest('c');
      const edited = await loader({ file: 'main.ts' });
      expect(changed.document.export).toHaveBeenCalledTimes(2);
      expect(edited.load).not.toHaveProperty('reused');
      expect(edited.load?.sourceRevision?.files['part.ts']).toBe(digest('c'));
      changed.snapshotSource.mockResolvedValueOnce({
        success: true,
        data: {
          entryPath: 'main.ts',
          files: [],
          unresolvedPaths: [],
          kernelId: 'fixture',
        },
        issues: [],
        sourceRevision: {
          entry: 'main.ts',
          files: { ...changed.files, 'extra.ts': digest('d') },
        },
      });
      await loader({ file: 'main.ts' });
      changed.snapshotSource.mockRejectedValueOnce(new Error('snapshot unavailable'));
      await loader({ file: 'main.ts' });
      changed.snapshotSource.mockResolvedValueOnce({
        success: false,
        issues: [],
      });
      await loader({ file: 'main.ts' });
      expect(changed.document.export).toHaveBeenCalledTimes(5);
    } finally {
      await loader.releaseAll();
    }
    const unverifiable = fixtureRuntime({ snapshot: false });
    const second = createGeoSpecNativeModelLoader({
      engine,
      runtime: unverifiable.runtime,
    });
    try {
      await second({ file: 'main.ts' });
      await second({ file: 'main.ts' });
      expect(unverifiable.document.export).toHaveBeenCalledTimes(2);
    } finally {
      await second.releaseAll();
    }
    expect(ingestSubject).toHaveBeenCalledTimes(7);
  });

  it('should compare digests derived from snapshot files when the snapshot carries no revision', async () => {
    const { engine } = fixtureEngine();
    const { runtime, document, snapshotSource } = fixtureRuntime();
    snapshotSource.mockResolvedValue({
      success: true,
      data: {
        entryPath: 'main.ts',
        files: [
          {
            path: 'main.ts',
            content: Uint8Array.of(1),
            sha256: 'a'.repeat(64),
            role: 'entry',
          },
          {
            path: 'part.ts',
            content: Uint8Array.of(2),
            sha256: 'b'.repeat(64),
            role: 'kernel-dependency',
          },
        ],
        unresolvedPaths: [],
        kernelId: 'fixture',
      },
      issues: [],
    });
    const loader = createGeoSpecNativeModelLoader({ engine, runtime });
    try {
      await loader({ file: 'main.ts' });
      await loader({ file: 'main.ts' });
      expect(document.export).toHaveBeenCalledOnce();
    } finally {
      await loader.releaseAll();
    }
  });

  it('should key on every export and admission input and never reuse a failure or a released scope', async () => {
    const { engine } = fixtureEngine();
    const { runtime, document } = fixtureRuntime();
    const loader = createGeoSpecNativeModelLoader({ engine, runtime });
    try {
      for (const options of [
        { file: 'main.ts', parameters: { width: 2 } },
        { file: 'main.ts', parameters: { width: 3 } },
        { file: 'main.ts', parameters: { width: 3 }, meshLinearTolerance: 0.1 },
        {
          file: 'main.ts',
          parameters: { width: 3 },
          ingestOptions: { tag: 'a' },
        },
        { file: 'other.ts', parameters: { width: 3 } },
        { file: 'main.ts', parameters: { at: new Date(0) } },
        { file: 'main.ts', parameters: { at: new Date(0) } },
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- Each distinct input must export before the next is compared.
        await loader(options);
      }
      expect(document.export).toHaveBeenCalledTimes(7);
    } finally {
      await loader.releaseAll();
    }
    await loader({ file: 'main.ts', parameters: { width: 2 } });
    expect(document.export).toHaveBeenCalledTimes(8);
    document.export.mockRejectedValueOnce(new Error('export failed'));
    await expect(loader({ file: 'failing.ts' })).rejects.toThrow('export failed');
    await loader({ file: 'failing.ts' });
    expect(document.export).toHaveBeenCalledTimes(10);
    await loader.releaseAll();
  });

  it('should load afresh once every owner released the earlier admission', async () => {
    const { engine, released } = fixtureEngine();
    const { runtime, document } = fixtureRuntime();
    const loader = createGeoSpecNativeModelLoader({ engine, runtime });
    const lease = (subject: Awaited<ReturnType<typeof loader>>) => {
      const facade = bindGeoSpecSubject({
        client: createGeoSpecAssertionClient({ engine }),
        engine,
        identity: subject,
        isLive: () => true,
        ensureResident: rawSubjectResidency(subject)!,
      });
      return resolveGeoSpecSubject(facade).lease!;
    };
    try {
      const options = {
        file: 'main.ts',
        code: { 'main.ts': 'model' },
      } as const;
      const first = await loader(options);
      const reused = await loader(options);
      expect(document.export).toHaveBeenCalledOnce();
      lease(first).dispose();
      expect(released).toEqual([]);
      lease(reused).dispose();
      expect(released).toEqual(['7']);
      const fresh = await loader(options);
      expect(document.export).toHaveBeenCalledTimes(2);
      expect(fresh.load).not.toHaveProperty('reused');
    } finally {
      await loader.releaseAll();
    }
  });
});

describe('native model loader work-unit budget', () => {
  it('should record a bounded loadModel budget per load and refuse an unbounded one before export', async () => {
    const { engine } = fixtureEngine();
    const { runtime, document } = fixtureRuntime();
    const loader = createGeoSpecNativeModelLoader({
      engine,
      runtime,
      readSource: async () => Uint8Array.of(3),
    });
    try {
      const first = await loader({
        file: 'main.ts',
        workUnitLimit: 16_000_000,
      });
      const reused = await loader({
        file: 'main.ts',
        workUnitLimit: 32_000_000,
      });
      const defaulted = await loader({ file: 'main.ts' });
      const direct = await loader({ source: 'part.glb', workUnitLimit: 9 });
      expect(first.load?.workUnitLimit).toBe(16_000_000);
      expect(reused.load).toMatchObject({
        reused: true,
        workUnitLimit: 32_000_000,
      });
      expect(defaulted.load).not.toHaveProperty('workUnitLimit');
      expect(direct.load?.workUnitLimit).toBe(9);
      await Promise.all(
        [0, 1.5, 512_000_001, Number.NaN].map(async (workUnitLimit) => {
          const refusal = loader({ file: 'main.ts', workUnitLimit });
          await expect(refusal).rejects.toMatchObject({
            diagnostics: [{ code: 'GEOSPEC_MODEL_OPTION_INVALID', details: { option: 'workUnitLimit' } }],
          });
          await expect(refusal).rejects.toThrow(
            'loadModel workUnitLimit must be a positive integer no greater than 512000000',
          );
        }),
      );
      expect(document.export).toHaveBeenCalledOnce();
    } finally {
      await loader.releaseAll();
    }
  });
});

describe('native model loader region crop', () => {
  const region = { min: [0, 0, 0], max: [10, 20, 30] } as const;
  const regionRoute: GeoSpecExportRoute = {
    kernelId: 'picovoxel',
    targetFormat: 'glb',
    exportOptions: {
      schema: { properties: { coordinateSystem: {}, unit: {}, region: {} } },
      defaults: {},
    },
  };
  const confirm = (exportOptions: unknown): KernelIssue[] => {
    const requested =
      exportOptions !== null && typeof exportOptions === 'object' && 'region' in exportOptions
        ? exportOptions.region
        : undefined;
    return requested === undefined
      ? []
      : [
          {
            code: 'RESOURCE_LIMIT',
            severity: 'info',
            message: 'Cropped to the region.',
            type: 'runtime',
            details: { region: requested },
          },
        ];
  };

  it('should crop through a declaring direct route and keep the crop in admission and evidence', async () => {
    const { engine, ingestSubject } = fixtureEngine();
    const fixture = fixtureRuntime({ issues: confirm });
    const runtime = Object.assign(fixture.runtime, {
      bestRouteFor: vi.fn(() => regionRoute),
    });
    const loader = createGeoSpecNativeModelLoader({ engine, runtime });
    try {
      const cropped = await loader({ file: 'main.ts', region });
      const whole = await loader({ file: 'main.ts' });
      const again = await loader({
        file: 'main.ts',
        region: { min: [0, 0, 0], max: [10, 20, 30] },
      });
      expect(fixture.document.export).toHaveBeenCalledTimes(2);
      expect(fixture.document.export.mock.calls[0]?.[1]).toMatchObject({
        options: { region },
      });
      expect(fixture.document.export.mock.calls[1]?.[1]?.options).not.toHaveProperty('region');
      expect(cropped.load).toMatchObject({ region, exportOptions: { region } });
      expect(whole.load).not.toHaveProperty('region');
      expect(again.load).toMatchObject({ reused: true, region });
      const admission = decodeRequest(ingestSubject.mock.calls[0]![0]);
      expect(admission).toMatchObject({
        diagnostics: [
          {
            code: 'RESOURCE_LIMIT',
            severity: 'info',
            message: 'Cropped to the region.',
          },
        ],
      });
    } finally {
      await loader.releaseAll();
    }
  });

  it('should refuse a crop no route declares, a route that transcodes, or an export that does not confirm it', async () => {
    const { engine, ingestSubject } = fixtureEngine();
    const routeless = fixtureRuntime({ issues: confirm });
    const loader = createGeoSpecNativeModelLoader({
      engine,
      runtime: routeless.runtime,
    });
    await expect(loader({ file: 'main.ts', region })).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: 'GEOSPEC_MODEL_REGION_UNSUPPORTED',
          details: { file: 'main.ts', format: 'glb', region },
        }),
      ],
    });
    for (const route of [
      {
        ...regionRoute,
        exportOptions: {
          schema: { properties: { coordinateSystem: {}, unit: {} } },
        },
      },
      { ...regionRoute, transcoderId: 'mesh' },
    ]) {
      const runtime = Object.assign(fixtureRuntime({ issues: confirm }).runtime, { bestRouteFor: () => route });
      const scoped = createGeoSpecNativeModelLoader({ engine, runtime });
      // oxlint-disable-next-line no-await-in-loop -- Each route must refuse before export.
      await expect(scoped({ file: 'main.ts', region })).rejects.toMatchObject({
        diagnostics: [{ code: 'GEOSPEC_MODEL_REGION_UNSUPPORTED', details: { kernelId: 'picovoxel' } }],
      });
    }
    const silent = fixtureRuntime();
    const unconfirmed = createGeoSpecNativeModelLoader({
      engine,
      runtime: Object.assign(silent.runtime, {
        bestRouteFor: () => regionRoute,
      }),
    });
    await expect(unconfirmed({ file: 'main.ts', region })).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'GEOSPEC_MODEL_REGION_NOT_HONORED' })],
    });
    expect(silent.document.export).toHaveBeenCalledOnce();
    expect(routeless.document.export).not.toHaveBeenCalled();
    expect(ingestSubject).not.toHaveBeenCalled();
  });

  it('should refuse a malformed crop, a STEP crop and a direct-source crop before reading anything', async () => {
    const { engine } = fixtureEngine();
    const { runtime, document } = fixtureRuntime({ issues: confirm });
    const readSource = vi.fn(async () => Uint8Array.of(1));
    const loader = createGeoSpecNativeModelLoader({
      engine,
      runtime,
      readSource,
    });
    for (const malformed of [
      { min: [0, 0, 0], max: [0, 1, 1] },
      { min: [0, 0], max: [1, 1, 1] },
      { min: [0, 0, 0], max: [1, 1, Number.POSITIVE_INFINITY] },
      { min: [0, 0, 0], max: [1, 1, 1], pad: 1 },
      null,
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- Each malformed crop must refuse before export.
      await expect(
        loader({ file: 'main.ts', region: malformed as unknown as GeoSpecLoadRegion }),
      ).rejects.toMatchObject({
        diagnostics: [{ code: 'GEOSPEC_MODEL_OPTION_INVALID', details: { option: 'region' } }],
      });
    }
    await expect(loader({ file: 'main.ts', format: 'step', region })).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: 'GEOSPEC_MODEL_OPTION_UNSUPPORTED',
          details: { option: 'region' },
        }),
      ],
    });
    const directCrop: unknown = { source: 'part.glb', region };
    await expect(loader(directCrop as GeoSpecNativeLoadModelOptions)).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: 'GEOSPEC_MODEL_OPTION_UNSUPPORTED',
          details: { option: 'region' },
        }),
      ],
    });
    expect(document.export).not.toHaveBeenCalled();
    expect(readSource).not.toHaveBeenCalled();
    await loader.releaseAll();
  });
});

class MemoryFileSystem implements VmFileSystem {
  private readonly files = new Map<string, string>();

  public constructor(entries: Record<string, string>) {
    for (const [path, content] of Object.entries(entries)) {
      this.files.set(path, content);
    }
  }

  public async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  public async readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  public async readFile(path: string, encoding: 'utf8'): Promise<string>;
  public async readFile(path: string, encoding?: 'utf8'): Promise<string | Uint8Array<ArrayBuffer>> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return encoding === 'utf8' ? content : new TextEncoder().encode(content);
  }

  public async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  public async ensureDir(): Promise<void> {
    return undefined;
  }
}

describe('run-level load coalescing', () => {
  it('should perform one export and one ingest for two it blocks with identical loads', async () => {
    const { engine, ingestSubject } = fixtureEngine();
    const { runtime, document } = fixtureRuntime();
    const nativeModelLoader = createGeoSpecNativeModelLoader({
      engine,
      runtime,
    });
    try {
      const result = await runGeoSpecModule({
        filesystem: new MemoryFileSystem({
          'spec.geospec.ts': `
            import { describe, it } from 'geospec';
            import { loadModel } from 'geospec/model';
            describe('print layout', () => {
              it('first view', async () => { await loadModel({ file: 'main.ts', parameters: { voxelSize: 0.5 } }); });
              it('second view', async () => { await loadModel({ file: 'main.ts', parameters: { voxelSize: 0.5 } }); });
            });
          `,
        }),
        entryPath: 'spec.geospec.ts',
        nativeAssertions: { engine },
        nativeModelLoader,
      });
      expect(result.success && result.tests.map(({ status }) => status)).toEqual(['passed', 'passed']);
      expect(document.export).toHaveBeenCalledOnce();
      expect(ingestSubject).toHaveBeenCalledOnce();
      const loads = result.lineage?.loads ?? [];
      expect(loads).toHaveLength(2);
      expect(new Set(loads.map(({ loadId }) => loadId)).size).toBe(2);
      expect(
        loads.map(({ status, evidence }) => ({
          status,
          reused: evidence?.reused,
        })),
      ).toEqual([
        { status: 'complete', reused: undefined },
        { status: 'complete', reused: true },
      ]);
    } finally {
      await nativeModelLoader.releaseAll();
    }
  });
});
