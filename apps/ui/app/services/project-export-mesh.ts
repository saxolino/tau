import { WebIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import { allExtensions } from '@taucad/geometry-core';
import type { ExportFile, GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { PreparedExport } from './project-export.types.js';

/** Highest named physical components; faces and repeated child bodies are not separate pieces. */
export function exportPieces(manifest: GeometryComponentManifest): GeometryComponentNode[] {
  const candidates = manifest.nodeOrder
    .map((id) => manifest.nodesById[id]!)
    .filter((node) => ['part', 'body', 'mesh'].includes(node.kind) && node.meshNodeIndices.length > 0);
  const ids = new Set(candidates.map(({ id }) => id));
  return candidates.filter((node) => {
    let parent = node.parentId;
    while (parent) {
      if (ids.has(parent)) {
        return false;
      }
      parent = manifest.nodesById[parent]?.parentId;
    }
    return true;
  });
}

/** Strict closed-manifold edge census of the delivered STL, welding equal spatial positions. */
export function isClosedStl(bytes: Uint8Array<ArrayBuffer>): boolean {
  try {
    const geometry = new STLLoader().parse(new Uint8Array(bytes).buffer);
    try {
      if (!geometry.hasAttribute('position')) {
        return false;
      }
      const positions = geometry.getAttribute('position');
      if (positions.count === 0 || positions.count % 3 !== 0) {
        return false;
      }
      const edges = new Map<string, number>();
      const point = (index: number): string =>
        [positions.getX(index), positions.getY(index), positions.getZ(index)]
          .map((value) => {
            if (!Number.isFinite(value)) {
              throw new TypeError('INVALID_STL_POSITION');
            }
            // Export units are mm. Weld only float serialization noise, never visible gaps.
            return Math.round(value * 1e6);
          })
          .join(',');
      for (let index = 0; index < positions.count; index += 3) {
        const vertices = [point(index), point(index + 1), point(index + 2)];
        if (new Set(vertices).size !== 3) {
          return false;
        }
        for (let edge = 0; edge < 3; edge += 1) {
          const key = [vertices[edge]!, vertices[(edge + 1) % 3]!].sort().join('|');
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      return [...edges.values()].every((count) => count === 2);
    } finally {
      geometry.dispose();
    }
  } catch {
    return false;
  }
}

/** Match the kernel's per-piece files by their authored names; never guess by array order. */
export function prepareStl(files: readonly ExportFile[], allNames: string[], selectedNames: string[]): PreparedExport {
  const byName = new Map(files.map((file) => [file.name.replace(/\.stl$/i, ''), file]));
  if (
    new Set(allNames).size !== allNames.length ||
    byName.size !== files.length ||
    files.length !== allNames.length ||
    allNames.some((name) => !byName.has(name)) ||
    selectedNames.length === 0 ||
    selectedNames.some((name) => !allNames.includes(name))
  ) {
    return { status: 'needsFix', problem: 'names' };
  }
  const selected = selectedNames.map((name) => byName.get(name)!);
  const open = selectedNames.filter((name) => !isClosedStl(byName.get(name)!.bytes));
  return open.length > 0
    ? { status: 'needsFix', problem: 'invalid', pieces: open, files: selected }
    : { status: 'verified', files: selected };
}

/** Remove unselected geometry while retaining the original occurrence transforms and materials. */
export async function selectGlbPieces(
  file: ExportFile,
  pieces: GeometryComponentNode[],
  names: string[],
): Promise<ExportFile> {
  if (
    names.length === 0 ||
    new Set(pieces.map(({ name }) => name)).size !== pieces.length ||
    names.some((name) => !pieces.some((piece) => piece.name === name))
  ) {
    throw new Error('EXPORT_SELECTION_UNAVAILABLE');
  }
  if (names.length === pieces.length) {
    return file;
  }
  const selectedIndices = new Set(
    pieces.filter(({ name }) => names.includes(name)).flatMap(({ meshNodeIndices }) => meshNodeIndices),
  );
  // A shared primitive node cannot be partially selected by dropping its whole mesh.
  if (
    pieces.some(
      (piece) => !names.includes(piece.name) && piece.meshNodeIndices.some((index) => selectedIndices.has(index)),
    )
  ) {
    throw new Error('EXPORT_SELECTION_AMBIGUOUS');
  }
  const io = new WebIO().registerExtensions(allExtensions);
  const document = await io.readBinary(file.bytes);
  for (const [index, node] of document.getRoot().listNodes().entries()) {
    if (!selectedIndices.has(index)) {
      node.setMesh(null);
    }
  }
  // The original topology describes the full assembly, so do not ship stale component references.
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (
      extension.extensionName === 'TAU_cad_topology' ||
      extension.extensionName === 'KITTYCAD_boundary_representation'
    ) {
      extension.dispose();
    }
  }
  await document.transform(prune());
  return { ...file, bytes: new Uint8Array(await io.writeBinary(document)) };
}
