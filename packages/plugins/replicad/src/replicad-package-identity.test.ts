// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createMockKernelRuntime } from '@taucad/runtime-testing';
import { resolveRuntimePluginDefinition } from '@taucad/runtime/plugin';

import { replicadKernel } from '#replicad.kernel.js';
import { replicadOptionsSchema } from '#replicad.schemas.js';

vi.setConfig({ testTimeout: 60_000 });

/**
 * Manifest of an installed dependency of this plugin.
 * @param name - The dependency name.
 * @returns Its `name` and `version`.
 */
const readInstalledManifest = async (name: string): Promise<{ name: string; version: string }> =>
  JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')) as {
    name: string;
    version: string;
  };

/** Manifest of the package this plugin resolves for `import 'replicad'`. */
const readInstalledReplicad = async (): Promise<{ name: string; version: string }> => readInstalledManifest('replicad');

describe('replicad package identity', () => {
  it('declares the installed fork under the replicad import name, beside the OpenCascade build it runs on', async () => {
    const installed = await readInstalledReplicad();
    const installedOpencascade = await readInstalledManifest('replicad-opencascadejs');
    const spec = `npm:${installed.name}@${installed.version}`;
    const definition = await resolveRuntimePluginDefinition('kernel', replicadKernel());
    const runtime = createMockKernelRuntime();
    const registerModule = vi.spyOn(runtime.bundler, 'registerModule');

    await definition.initialize(replicadOptionsSchema.parse({}), runtime);

    expect(installed.name).toBe('@taulabs/replicad');
    expect(replicadKernel().builtinDependencies).toEqual({
      replicad: spec,
      'replicad-opencascadejs': `npm:${installedOpencascade.name}@${installedOpencascade.version}`,
    });
    const [, replicadModule] = registerModule.mock.calls.find(([name]) => name === 'replicad')!;
    expect(replicadModule.package).toEqual({ name: 'replicad', spec });
    expect(replicadModule.version).toBe(installed.version);
  });
});
