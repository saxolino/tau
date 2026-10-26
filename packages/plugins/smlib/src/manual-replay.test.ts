import { describe, expect, it } from 'vitest';
import { createMockKernelRuntime } from '@taucad/runtime-testing';
import { createManualReplaySource, manualReplayWitness } from '#manual-replay.js';
import type { ManualOperation } from '#manual-operations.js';

describe('manual face replay source identity', () => {
  it('binds source, imported data, resolved parameters and native versions while excluding its own sidecar', async () => {
    const files = new Map<string, string>([
      ['main.ts', 'model source'],
      ['part.ts', 'imported source'],
      ['data.json', '{"radius":3}'],
      ['main.ts.manual.json', 'history one'],
    ]);
    const runtime = { ...createMockKernelRuntime(), fileContentCache: files };
    const input = {
      entryPath: 'main.ts',
      dependencies: ['main.ts', 'part.ts', 'data.json'],
      unresolvedPaths: ['missing.ts'],
      parameters: { width: 64, nested: { a: 1, b: 2 } },
      kernelVersion: '1.3.0',
      libraryVersion: '0.3.4',
      runtime,
    };
    const original = await createManualReplaySource(input);
    await expect(
      createManualReplaySource({ ...input, dependencies: [...input.dependencies, 'main.ts.manual.json'] }),
    ).rejects.toThrow('own manual history');
    files.set('main.ts.manual.json', 'history two');
    expect(await createManualReplaySource(input)).toBe(original);
    expect(
      await createManualReplaySource({
        ...input,
        dependencies: [...input.dependencies].reverse(),
        parameters: { nested: { b: 2, a: 1 }, width: 64 },
      }),
    ).toBe(original);
    files.set('data.json', '{"radius":4}');
    expect(await createManualReplaySource(input)).not.toBe(original);
    files.set('data.json', '{"radius":3}');
    files.set('part.ts', 'changed imported source');
    expect(await createManualReplaySource(input)).not.toBe(original);
    files.set('part.ts', 'imported source');
    expect(await createManualReplaySource({ ...input, parameters: { ...input.parameters, width: 65 } })).not.toBe(
      original,
    );
    expect(await createManualReplaySource({ ...input, kernelVersion: '1.4.0' })).not.toBe(original);
    expect(await createManualReplaySource({ ...input, unresolvedPaths: [] })).not.toBe(original);
  });

  it('binds exact target names and the complete ordered prefix including disabled operations', async () => {
    const first: ManualOperation = { id: 'first', type: 'translate', target: { name: 'piece' }, delta: [1, 0, 0] };
    const second: ManualOperation = { id: 'second', type: 'translate', target: { name: 'piece' }, delta: [0, 1, 0] };
    const original = await manualReplayWitness('source', [first, second], 'piece');
    expect(await manualReplayWitness('source', [first, second], 'piece')).toBe(original);
    expect(await manualReplayWitness('source', [second, first], 'piece')).not.toBe(original);
    expect(await manualReplayWitness('source', [{ ...first, enabled: false }, second], 'piece')).not.toBe(original);
    expect(await manualReplayWitness('source', [first, second], ' piece ')).not.toBe(original);
  });
});
