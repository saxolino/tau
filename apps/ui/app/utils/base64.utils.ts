/**
 * Base64 of bytes of any size, safe in a browser worker.
 *
 * `uint8array-extras`'s `uint8ArrayToBase64` turns each 65 535 bytes into one call's argument list
 * (`String.fromCodePoint.apply`); a browser worker's stack is smaller than the page's and overflows from about 30 000
 * arguments («Maximum call stack size exceeded»). The file-manager worker encodes revision snapshots with it, so a
 * project holding a picture (the recognised part's photo and mask) could not be saved to Sinopia. This uses the
 * engine's own `Uint8Array.prototype.toBase64` when there is one; otherwise it encodes blocks of 6 KiB, a multiple of
 * 3 bytes, so each block's Base64 has no padding and the blocks join into the Base64 of the whole. No recursion, no
 * argument list larger than one block.
 *
 * Self-contained on purpose (no module-level names): its test runs its source in a worker thread with a small stack.
 *
 * @param bytes - The bytes.
 * @returns Their standard Base64 (with padding).
 */
export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  const native = (bytes as Uint8Array<ArrayBuffer> & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') {
    return native.call(bytes);
  }
  const blockBytes = 6144;
  const blocks: string[] = [];
  for (let start = 0; start < bytes.length; start += blockBytes) {
    blocks.push(globalThis.btoa(String.fromCodePoint(...bytes.subarray(start, start + blockBytes))));
  }
  return blocks.join('');
}
