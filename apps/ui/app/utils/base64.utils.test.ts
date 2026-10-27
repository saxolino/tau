import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '#utils/base64.utils.js';

/** Deterministic bytes covering all 256 values. */
const bytesOf = (length: number): Uint8Array<ArrayBuffer> =>
  Uint8Array.from({ length }, (_, index) => (index * 131 + Math.floor(index / 256)) % 256);

/** The same bytes without the engine's `toBase64`, so the block encoder is the one under test. */
const withoutNative = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> =>
  Object.defineProperty(bytes, 'toBase64', { value: undefined });

/** Runs `bytesToBase64`'s own source in a worker thread whose stack is as small as a browser worker's. */
const encodeInSmallStack = async (
  bytes: Uint8Array<ArrayBuffer>,
): Promise<{ readonly encoded: string; readonly control: string }> => {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const bytesToBase64 = (${bytesToBase64.toString()});
    // Control: the 65 535-argument call of uint8array-extras overflows this stack, as in a browser worker.
    let control = 'ok';
    try { String.fromCodePoint.apply(undefined, new Uint8Array(65535)); } catch (error) { control = error.message; }
    parentPort.postMessage({ encoded: bytesToBase64(workerData), control });
  `;
  const worker = new Worker(code, { eval: true, workerData: bytes, resourceLimits: { stackSizeMb: 0.5 } });
  try {
    return await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
  } finally {
    await worker.terminate();
  }
};

describe('bytesToBase64', () => {
  it('should match standard Base64 at every block boundary', () => {
    for (const length of [0, 1, 2, 3, 4, 6143, 6144, 6145, 12_289]) {
      const bytes = bytesOf(length);
      expect(bytesToBase64(withoutNative(bytes))).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('should encode a 6 MB file in a worker stack that overflows on 65 535 arguments', async () => {
    const bytes = bytesOf(6 * 1024 * 1024);
    const { encoded, control } = await encodeInSmallStack(bytes);
    expect(control).toBe('Maximum call stack size exceeded');
    expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('should use the engine’s own toBase64 when it has one', () => {
    const bytes = Object.defineProperty(bytesOf(3), 'toBase64', { value: () => 'native' });
    expect(bytesToBase64(bytes)).toBe('native');
  });
});
