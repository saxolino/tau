import { describe, expect, it, vi } from 'vitest';
import { kernelConfigurations } from '@taucad/types/constants';

const bridge = vi.hoisted(() => ({ runtimeKernelIds: [] as string[] }));
vi.mock('#filesystem/desktop-bridge.js', () => ({ desktopBridge: () => bridge }));

const { isSinopiaKernelId, sinopiaKernelIds, sinopiaStarterKernelId } = await import('#lib/sinopia-engines.js');
const { availableKernelConfigurations, isKernelAvailable, isKernelExecutable } =
  await import('#constants/available-kernel-configurations.js');

describe('SinopiaCAD engines', () => {
  it('offers SMLib, PicoVoxel, Replicad and Manifold, SMLib first and as the starter', () => {
    expect(sinopiaKernelIds).toEqual(['smlib', 'picovoxel', 'replicad', 'manifold']);
    expect(sinopiaStarterKernelId).toBe('smlib');
    expect(availableKernelConfigurations().map(({ id }) => id)).toEqual(['smlib', 'picovoxel', 'replicad', 'manifold']);
  });

  it.each(['zoo', 'tscircuit', 'openscad', 'jscad', 'build123d', 'smlibpy', 'picogk', 'opencascadejs'])(
    'offers no %s anywhere a person or the agent could pick an engine',
    (kernelId) => {
      expect(isSinopiaKernelId(kernelId)).toBe(false);
      expect(isKernelAvailable(kernelId)).toBe(false);
    },
  );

  it('still executes a project written for an engine it does not offer', () => {
    bridge.runtimeKernelIds = ['build123d'];
    try {
      expect(isKernelExecutable('openscad')).toBe(true);
      expect(isKernelExecutable('build123d')).toBe(true);
      expect(isKernelAvailable('build123d')).toBe(false);
    } finally {
      bridge.runtimeKernelIds = [];
    }
    expect(isKernelExecutable('build123d')).toBe(false);
  });

  it('names only catalog kernels', () => {
    const catalog = new Set<string>(kernelConfigurations.map(({ id }) => id));
    expect(sinopiaKernelIds.every((id) => catalog.has(id))).toBe(true);
  });
});
