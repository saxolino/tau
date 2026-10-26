import type { ExportFile, GeometryComponentNode } from '@taucad/types';
import { createExportFile } from '@taucad/types/constants';
import type { Evaluation, RuntimeDocument, Rendering } from '@taucad/runtime';
import type { AppRuntimeClient } from '#types/runtime-client.alias.js';
import { bestRouteForActiveKernel, exportDocumentWithValidatedInput } from '#utils/export-formats.utils.js';
import { prepareStl, selectGlbPieces, exportPieces } from './project-export-mesh.js';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import type {
  PreparedExport,
  PreparedProjectExport,
  ProjectExportFormat,
  ProjectExportSketches,
  StepCheckRequest,
  StepCheckResult,
} from './project-export.types.js';

export type ProjectExportSource = {
  document: RuntimeDocument;
  client: AppRuntimeClient;
  kernelId: string;
  rendering: Extract<Rendering, { success: true }>;
  pieces: GeometryComponentNode[];
  sketches?: ProjectExportSketches;
  isCurrent: () => boolean;
  /** Whether the current view can be captured now, without rendering it. */
  canCapture: () => boolean;
  capture: (signal: AbortSignal) => Promise<ExportFile[]>;
  verifyStep: (request: StepCheckRequest, signal: AbortSignal) => Promise<StepCheckResult>;
};

/** Describe drawings only from the successful committed evaluation that produced this render. */
export function projectExportSketches({
  kernelId,
  evaluation,
  rendering,
}: {
  kernelId: string | undefined;
  evaluation: Evaluation | undefined;
  rendering: Rendering | undefined;
}): ProjectExportSketches | undefined {
  if (
    kernelId !== 'smlib' ||
    !evaluation?.success ||
    evaluation.transient ||
    !rendering?.success ||
    rendering.transient ||
    evaluation.id !== rendering.evaluationId ||
    JSON.stringify(evaluation.sourceRevision) !== JSON.stringify(rendering.sourceRevision) ||
    !evaluation.views.some((view) => view.id === 'drawing' && view.mimeType === 'image/svg+xml')
  ) {
    return undefined;
  }
  return evaluation.views.some((view) => view.id === 'model' && view.mimeType === 'model/gltf-binary')
    ? 'mixed'
    : 'only';
}

/** Longest wait for one current-view PNG; a headless render that never returns ends as a capture problem. */
export const photoCaptureTimeout = 60_000;

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
    // The photo has nothing to verify: it is ready once the view can be captured, and taken at the click.
    if (format === 'png') {
      return source.canCapture() ? { status: 'ready', files: [] } : { status: 'needsFix', problem: 'capture' };
    }
    if (source.sketches === 'only') {
      return { status: 'needsFix', problem: 'sketchOnly' };
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

/** Take the current-view PNG now, within {@link photoCaptureTimeout}; the render is released when it ends. */
export async function captureProjectPhoto(input: {
  source: ProjectExportSource;
  signal: AbortSignal;
}): Promise<PreparedExport> {
  const { source, signal } = input;
  const current = (): boolean => !signal.aborted && source.isCurrent();
  const capture = new AbortController();
  const stop = (): void => {
    capture.abort();
  };
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, photoCaptureTimeout);
  try {
    if (!current() || !source.canCapture()) {
      return { status: 'needsFix', problem: current() ? 'capture' : 'changed' };
    }
    const stopped = new Promise<never>((_resolve, reject) => {
      capture.signal.addEventListener(
        'abort',
        () => {
          reject(new Error('CAPTURE_STOPPED'));
        },
        { once: true },
      );
    });
    const files = await Promise.race([source.capture(capture.signal), stopped]);
    if (!current()) {
      return { status: 'needsFix', problem: 'changed' };
    }
    return files.length === 1 && files[0]?.mimeType === 'image/png'
      ? { status: 'ready', files }
      : { status: 'needsFix', problem: 'capture' };
  } catch {
    return { status: 'needsFix', problem: current() ? 'capture' : 'changed' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
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
  const photo = await captureProjectPhoto(input);
  return { step, glb, photo };
}

/** Initial row state is checking; readiness is only assigned once the actual file is prepared. */
export type ProjectExportRows = Partial<PreparedProjectExport>;
