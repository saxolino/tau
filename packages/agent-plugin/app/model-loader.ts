import { tauViewerReadLimit, tauViewerToolName } from '@taucad/mcp/viewer-protocol';
import type { TauViewerModel, TauViewerReadResult } from '@taucad/mcp/viewer-protocol';
import type { Artifact } from '@taucad/runtime';

/** Calls one Tau tool and returns its structured result. */
export type CallTool = (name: string, args: Readonly<Record<string, unknown>>) => Promise<unknown>;

const isReadResult = (value: unknown): value is TauViewerReadResult =>
  typeof value === 'object' && value !== null && 'data' in value && 'totalBytes' in value && 'offset' in value;

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64Values = new Map([...base64Alphabet].map((character, value) => [character, value]));

/**
 * Decode base64 into a fresh buffer.
 *
 * @param data - Base64 text, padded or not.
 * @returns The bytes.
 * @throws Error on a character outside the base64 alphabet.
 */
export const decodeBase64 = (data: string): Uint8Array<ArrayBuffer> => {
  const text = data.replace(/=+$/u, '');
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let written = 0;
  /* Four characters carry 24 bits, three bytes; a short last group carries fewer. */
  for (let start = 0; start < text.length; start += 4) {
    const group = text.slice(start, start + 4);
    let value = 0;
    for (const character of group) {
      const digit = base64Values.get(character);
      if (digit === undefined) {
        throw new Error(`Invalid base64 character ${JSON.stringify(character)}.`);
      }
      value = value * 64 + digit;
    }
    value *= 64 ** (4 - group.length);
    for (let index = 0; index < group.length - 1; index += 1) {
      bytes[written] = Math.floor(value / 256 ** (2 - index)) % 256;
      written += 1;
    }
  }
  return bytes;
};

/**
 * Read a shown model through `app_read`, one reply-sized range at a time (blueprint D4).
 *
 * @param callTool - The bridge's tool call.
 * @param model - The model `show_model` returned.
 * @param onProgress - Receives the bytes read so far.
 * @returns The model as the artifact the viewer draws.
 * @throws Error when a reply does not continue where the last one stopped, or the size changes.
 */
export const loadModel = async (
  callTool: CallTool,
  model: TauViewerModel,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Artifact> => {
  const bytes = new Uint8Array(model.byteLength);
  let offset = 0;
  while (offset < model.byteLength) {
    // oxlint-disable-next-line no-await-in-loop -- each range starts where the last one ended.
    const result = await callTool(tauViewerToolName.appRead, {
      modelId: model.id,
      offset,
      length: Math.min(tauViewerReadLimit, model.byteLength - offset),
    });
    if (!isReadResult(result) || result.offset !== offset || result.totalBytes !== model.byteLength) {
      throw new Error(`${model.path} changed while it was loading.`);
    }
    const chunk = decodeBase64(result.data);
    if (chunk.length === 0) {
      throw new Error(`${model.path} ended early while it was loading.`);
    }
    bytes.set(chunk, offset);
    offset += chunk.length;
    onProgress?.(offset, model.byteLength);
  }
  return model.mimeType === 'image/svg+xml'
    ? { mimeType: model.mimeType, content: new TextDecoder().decode(bytes) }
    : { mimeType: model.mimeType, content: bytes };
};
