import type { ExportFile, GeometryComponentNode } from '@taucad/types';
import { createExportFile } from '@taucad/types/constants';
import type { RuntimeDocument, Rendering } from '@taucad/runtime';
import type { AppRuntimeClient } from '#types/runtime-client.alias.js';
import { bestRouteForActiveKernel, exportDocumentWithValidatedInput } from '#utils/export-formats.utils.js';
import { prepareStl, selectGlbPieces, exportPieces } from './project-export-mesh.js';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import type {
  PreparedExport,
  PreparedProjectExport,
  ProjectExportFormat,
  StepCheckRequest,
  StepCheckResult,
} from './project-export.types.js';

export type ProjectExportSource = {
  document: RuntimeDocument;
  client: AppRuntimeClient;
  kernelId: string;
  rendering: Extract<Rendering, { success: true }>;
  pieces: GeometryComponentNode[];
  isCurrent: () => boolean;
  capture: () => Promise<ExportFile[]>;
  verifyStep: (request: StepCheckRequest, signal: AbortSignal) => Promise<StepCheckResult>;
};

const selectionMatches = (names: string[], selected: string[]): boolean =>
  names.length > 0 &&
  selected.length > 0 &&
  new Set(names).size === names.length &&
  new Set(selected).size === selected.length &&
  selected.every((name) => names.includes(name));

/** Prepare one format against the same settled render, without downloading or saving anything. */
export async function prepareProjectExport(input: {
  source: ProjectExportSource;
  format: ProjectExportFormat;
  selectedNames?: string[];
  signal: AbortSignal;
}): Promise<PreparedExport> {
  const { source, format, selectedNames, signal } = input;
  const names = source.pieces.map(({ name }) => name);
  const selected = selectedNames ?? names;
  const current = (): boolean => !signal.aborted && source.isCurrent();
  try {
    if (!current()) {
      return { status: 'needsFix', problem: 'changed' };
    }
    if (format === 'png') {
      const files = await source.capture();
      return current() && files.length === 1 && files[0]?.mimeType === 'image/png'
        ? { status: 'ready', files }
        : { status: 'needsFix', problem: 'capture' };
    }
    if (!selectionMatches(names, selected)) {
      return { status: 'needsFix', problem: 'selection' };
    }
    // A fresh instance of the producing engine is not an independent second engine.
    if (format === 'step' && source.kernelId === 'opencascade') {
      return { status: 'needsFix', problem: 'independent' };
    }
    const route = bestRouteForActiveKernel(source.client, format, source.kernelId);
    if (!route || route.kernelId !== source.kernelId) {
      return { status: 'needsFix', problem: 'prepare' };
    }
    const result = await exportDocumentWithValidatedInput(source.document, route, { signal });
    if (!current()) {
      return { status: 'needsFix', problem: 'changed' };
    }
    if (!result.success) {
      return { status: 'needsFix', problem: 'prepare' };
    }
    if (
      result.evaluationId !== source.rendering.evaluationId ||
      JSON.stringify(result.sourceRevision) !== JSON.stringify(source.rendering.sourceRevision)
    ) {
      return { status: 'needsFix', problem: 'changed' };
    }
    const prepared = await prepareGeometryFiles({ source, format, files: [...result.files], selectedNames, signal });
    return current() ? prepared : { status: 'needsFix', problem: 'changed' };
  } catch {
    return { status: 'needsFix', problem: current() ? 'prepare' : 'changed' };
  }
}

async function prepareGeometryFiles({
  source,
  format,
  files,
  selectedNames,
  signal,
}: {
  source: ProjectExportSource;
  format: Exclude<ProjectExportFormat, 'png'>;
  files: ExportFile[];
  selectedNames: string[] | undefined;
  signal: AbortSignal;
}): Promise<PreparedExport> {
  const names = source.pieces.map(({ name }) => name);
  const selected = selectedNames ?? names;
  if (format === 'stl') {
    return prepareStl(files, names, selected);
  }
  if (format === 'glb') {
    const exportedFile = files[0];
    if (files.length !== 1 || !exportedFile) {
      return { status: 'needsFix', problem: 'prepare' };
    }
    const exportedPieces = exportPieces(buildGltfComponentManifest(exportedFile.bytes));
    if (exportedPieces.length !== names.length || exportedPieces.some((piece) => !names.includes(piece.name))) {
      return { status: 'needsFix', problem: 'names' };
    }
    const file = await selectGlbPieces(exportedFile, exportedPieces, selected);
    return { status: 'ready', files: [file] };
  }
  const exportedFile = files[0];
  if (files.length !== 1 || !exportedFile) {
    return { status: 'needsFix', problem: 'read' };
  }
  const checked = await source.verifyStep({ bytes: exportedFile.bytes, expectedNames: names, selectedNames }, signal);
  return checked.status === 'verified'
    ? { status: 'verified', files: [createExportFile('step', 'model', checked.bytes)] }
    : checked;
}

/** Reusable preparation boundary for the future Sinopia handoff. No upload, download or persistence. */
export async function prepareSinopiaFiles(input: Omit<Parameters<typeof prepareProjectExport>[0], 'format'>): Promise<{
  step: PreparedExport;
  glb: PreparedExport;
  photo: PreparedExport;
}> {
  // Serialize native exports: their runtime document shares mutable kernel state.
  const step = await prepareProjectExport({ ...input, format: 'step' });
  const glb = await prepareProjectExport({ ...input, format: 'glb' });
  const photo = await prepareProjectExport({ ...input, format: 'png' });
  return { step, glb, photo };
}

/** Initial row state is checking; readiness is only assigned once the actual file is prepared. */
export type ProjectExportRows = Partial<PreparedProjectExport>;
