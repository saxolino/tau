// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createMockKernelRuntime } from '@taucad/runtime-testing';
import { resolveRuntimePluginDefinition } from '@taucad/runtime/plugin';

import { tscircuitKernel } from '#tscircuit.kernel.js';

vi.setConfig({ testTimeout: 60_000 });

/** Manifest of the package this plugin resolves for a bare import of `name`. */
const readInstalled = async (name: string): Promise<{ name: string; version: string }> =>
  JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')) as {
    name: string;
    version: string;
  };

describe('tscircuit package identity', () => {
  it('declares the installed engine packages and the rest of their closure, with tscircuit as an alias of @tscircuit/core', async () => {
    const [core, props, react] = await Promise.all(
      ['@tscircuit/core', '@tscircuit/props', 'react'].map(async (name) => readInstalled(name)),
    );
    const definition = await resolveRuntimePluginDefinition('kernel', tscircuitKernel());
    const runtime = createMockKernelRuntime();
    const registerModule = vi.spyOn(runtime.bundler, 'registerModule');

    await definition.initialize({}, runtime);

    // Every non-optional peer of the installed core except the TypeScript compiler, at its installed version.
    const coreManifest = JSON.parse(
      await readFile(new URL('../node_modules/@tscircuit/core/package.json', import.meta.url), 'utf8'),
    ) as { peerDependencies: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }> };
    const peerNames = Object.keys(coreManifest.peerDependencies).filter(
      (name) =>
        name !== 'typescript' &&
        name !== '@tscircuit/props' &&
        coreManifest.peerDependenciesMeta?.[name]?.optional !== true,
    );
    // The undeclared runtime imports: this plugin's own dev dependencies, and two that pnpm hoists for the engine build.
    const undeclared = [
      '@tscircuit/copper-pour-solver',
      '@tscircuit/infer-cable-insertion-point',
      '@tscircuit/miniflex',
      '@tscircuit/schematic-trace-solver',
      '@tscircuit/soup-util',
      'calculate-elbow',
      'connectivity-map',
      'minicssgrid',
      'spicey',
    ];
    const hoisted = await Promise.all(
      ['debug', 'flatbush'].map(
        async (name) =>
          JSON.parse(
            await readFile(
              new URL(`../../../../node_modules/.pnpm/node_modules/${name}/package.json`, import.meta.url),
              'utf8',
            ),
          ) as { name: string; version: string },
      ),
    );
    const closure = [
      ...(await Promise.all([...peerNames, ...undeclared].map(async (name) => readInstalled(name)))),
      ...hoisted,
    ];

    expect(tscircuitKernel().builtinDependencies).toEqual({
      tscircuit: `npm:${core!.name}@${core!.version}`,
      '@tscircuit/core': core!.version,
      '@tscircuit/props': props!.version,
      react: react!.version,
      ...Object.fromEntries(closure.map(({ name, version }) => [name, version])),
    });
    expect(Object.fromEntries(registerModule.mock.calls.map(([name, entry]) => [name, entry.package]))).toEqual({
      react: { name: 'react', spec: react!.version },
      'react/jsx-runtime': { name: 'react', spec: react!.version },
      '@tscircuit/core': { name: '@tscircuit/core', spec: core!.version },
      tscircuit: { name: 'tscircuit', spec: `npm:${core!.name}@${core!.version}` },
      '@tscircuit/props': { name: '@tscircuit/props', spec: props!.version },
    });
  });
});
