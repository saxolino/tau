import type { KernelServices } from '@taucad/runtime/kernel';
import type { ManualOperation } from '#manual-operations.js';

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry: unknown) => canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => Number(a > b) - Number(a < b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
};

const hashBytes = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
};
const hashJson = async (value: unknown): Promise<string> => hashBytes(new TextEncoder().encode(canonicalJson(value)));

/**
 * Bind face replay to the exact declared source closure and resolved parameters, excluding its own history sidecar.
 * @param input - Source closure, runtime reads and native version identities.
 * @returns SHA-256 provenance seed without a self-reference to the manual history.
 */
export async function createManualReplaySource(input: {
  entryPath: string;
  dependencies: readonly string[];
  unresolvedPaths: readonly string[];
  parameters: Readonly<Record<string, unknown>>;
  kernelVersion: string;
  libraryVersion: string;
  runtime: KernelServices;
}): Promise<string> {
  if (input.dependencies.includes(`${input.entryPath}.manual.json`)) {
    throw new Error('A model cannot import its own manual history as a source dependency.');
  }
  const paths = [...new Set([input.entryPath, ...input.dependencies])]
    .filter((path) => path !== `${input.entryPath}.manual.json`)
    .sort();
  const files = await Promise.all(
    paths.map(async (path) => {
      const value = input.runtime.fileContentCache.get(path) ?? (await input.runtime.filesystem.readFile(path));
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      return { path, sha256: await hashBytes(bytes) };
    }),
  );
  return hashJson({
    version: 1,
    kernelVersion: input.kernelVersion,
    libraryVersion: input.libraryVersion,
    entryPath: input.entryPath,
    files,
    unresolvedPaths: [...input.unresolvedPaths].sort(),
    parameters: input.parameters,
  });
}

/**
 * A provenance witness, deliberately separate from exact native serialization bytes.
 * @param source - Declared source closure and resolved parameter digest.
 * @param operations - Complete ordered history prefix, including disabled entries.
 * @param targetName - Exact authored name of the selected piece.
 * @returns SHA-256 provenance witness for that replay state.
 */
export async function manualReplayWitness(
  source: string,
  operations: readonly ManualOperation[],
  targetName: string,
): Promise<string> {
  return hashJson({ version: 1, source, targetName, operations });
}
