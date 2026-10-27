import type { ExportFile, GeometryComponentNode } from '@taucad/types';
import { createExportFile } from '@taucad/types/constants';
import type { Evaluation, RuntimeDocument, Rendering } from '@taucad/runtime';
import type { AppRuntimeClient } from '#types/runtime-client.alias.js';
import { bestRouteForActiveKernel, exportDocumentWithValidatedInput } from '#utils/export-formats.utils.js';
import { prepareStl, selectGlbPieces, exportPieces } from './project-export-mesh.js';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import type { Consegna, EsitoTavola, PezzoConsegna, ProblemaConsegna } from '@taucad/smlib/consegna';
import { annotateGlbMaterials } from './project-export-glb.js';
import type { GlbPieceMaterial } from './project-export-glb.js';
import { creaTavolaPdf } from './tavola-pdf.js';
import type { DatiTavola } from './tavola-pdf.js';
import type {
  ExportProblem,
  PreparedExport,
  PreparedProjectExport,
  ProjectExportFormat,
  ProjectExportSketches,
  StepCheckRequest,
  StepCheckResult,
} from './project-export.types.js';

/**
 * SinopiaCAD's delivery (E3a), for SMLib models: the delivery worker (SMLib only) rewrites and reads back the STEP,
 * reads back the IGES, writes the DXF and the drawings of the sheet; OpenCASCADE only converts STEP to IGES.
 */
export type ProjectDelivery = {
  consegna: Pick<Consegna, 'step' | 'rileggi' | 'dxf' | 'tavola'>;
  /** STEP → IGES in the disposable OpenCASCADE worker (the one LGPL step left: SMLib 0.5 does not write IGES). */
  convertIges: (step: Uint8Array<ArrayBuffer>, signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>;
  /** The project's name: the STEP assembly and the sheet's title block. */
  projectName: string;
  /** Every piece of the model: exact volume, material, flat by process. */
  pieces: readonly PezzoConsegna[];
  /** The GLB material of each piece, by piece name. */
  glbMaterials: ReadonlyMap<string, GlbPieceMaterial>;
  /** Everything the sheet says besides its drawings, in the interface language. */
  sheet: (
    drawings: Extract<EsitoTavola, { stato: 'pronto' }>,
    selectedNames: string[] | undefined,
    versionLabel?: string,
  ) => DatiTavola;
};

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
  /** Present for SMLib models: STEP, IGES, DXF and the PDF sheet go through the delivery worker, without OpenCASCADE. */
  delivery?: ProjectDelivery;
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
  /** The version the PDF sheet's title block names (the Sinopia version being sent); else the last one sent. */
  versionLabel?: string;
}): Promise<PreparedExport> {
  const { source, format, selectedNames, signal, versionLabel } = input;
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
    const delivery = source.kernelId === 'smlib' ? source.delivery : undefined;
    if (format === 'iges' || format === 'dxf' || format === 'pdf' || (format === 'step' && delivery)) {
      if (!delivery) {
        return { status: 'needsFix', problem: 'unavailable' };
      }
      const prepared = await prepareDelivery({ source, delivery, format, selectedNames, signal, versionLabel });
      return current() ? prepared : { status: 'needsFix', problem: 'changed' };
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
  format: 'step' | 'stl' | 'glb';
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
    const glbMaterials = source.kernelId === 'smlib' ? source.delivery?.glbMaterials : undefined;
    if (!glbMaterials) {
      return { status: 'ready', files: [file] };
    }
    const kept = exportPieces(buildGltfComponentManifest(file.bytes));
    return { status: 'ready', files: [await annotateGlbMaterials(file, kept, glbMaterials)] };
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

/** The delivery worker's problems, in the export dialog's words. */
const deliveryProblem = (problema: ProblemaConsegna): ExportProblem => (problema === 'write' ? 'prepare' : problema);

const needsFix = (result: { problema: ProblemaConsegna; pezzi?: readonly string[] }): PreparedExport =>
  result.pezzi && result.pezzi.length > 0
    ? { status: 'needsFix', problem: deliveryProblem(result.problema), pieces: [...result.pezzi] }
    : { status: 'needsFix', problem: deliveryProblem(result.problema) };

/** The kernel's own STEP of the settled render (Z up, mm), or why it is not there. */
async function kernelStep(
  source: ProjectExportSource,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | ExportProblem> {
  const route = bestRouteForActiveKernel(source.client, 'step', source.kernelId);
  if (!route || route.kernelId !== source.kernelId) {
    return 'prepare';
  }
  const result = await exportDocumentWithValidatedInput(source.document, route, {
    signal,
    options: { coordinateSystem: 'z-up' },
  });
  if (!result.success) {
    return 'prepare';
  }
  if (
    result.evaluationId !== source.rendering.evaluationId ||
    JSON.stringify(result.sourceRevision) !== JSON.stringify(source.rendering.sourceRevision)
  ) {
    return 'changed';
  }
  const [file] = result.files;
  return result.files.length === 1 ? file.bytes : 'read';
}

/** A file name without the characters file systems refuse. */
const fileStem = (name: string): string => name.replaceAll(/[\\/:*?"<>|]+/gu, ' ').trim() || 'SinopiaCAD';

/**
 * STEP, IGES, DXF or the PDF sheet of an SMLib model, from the kernel's STEP through the delivery worker. STEP and IGES
 * are only «verified» once their own bytes were read back with one solid per piece and the volumes of the Measures.
 */
async function prepareDelivery({
  source,
  delivery,
  format,
  selectedNames,
  signal,
  versionLabel,
}: {
  source: ProjectExportSource;
  delivery: ProjectDelivery;
  format: 'step' | 'iges' | 'dxf' | 'pdf';
  selectedNames: string[] | undefined;
  signal: AbortSignal;
  versionLabel: string | undefined;
}): Promise<PreparedExport> {
  const step = await kernelStep(source, signal);
  if (typeof step === 'string') {
    return { status: 'needsFix', problem: step };
  }
  const selection = selectedNames ? { selezionati: selectedNames } : {};
  if (format === 'dxf') {
    const result = await delivery.consegna.dxf({ step, pezzi: delivery.pieces, ...selection }, { signal });
    return result.stato === 'verificato'
      ? { status: 'verified', files: [createExportFile('dxf', 'model', new TextEncoder().encode(result.dxf))] }
      : needsFix(result);
  }
  if (format === 'pdf') {
    const result = await delivery.consegna.tavola({ step, ...selection }, { signal });
    if (result.stato !== 'pronto') {
      return needsFix(result);
    }
    const bytes = await creaTavolaPdf(delivery.sheet(result, selectedNames, versionLabel));
    return {
      status: 'ready',
      files: [{ name: `${fileStem(delivery.projectName)}.pdf`, bytes, mimeType: 'application/pdf' }],
    };
  }
  const written = await delivery.consegna.step(
    { step, pezzi: delivery.pieces, progetto: delivery.projectName, ...selection },
    { signal },
  );
  if (written.stato !== 'verificato') {
    return needsFix(written);
  }
  if (format === 'step') {
    return {
      status: 'verified',
      files: [createExportFile('step', 'model', written.step)],
      measured: {
        size: written.ingombro,
        pieces: written.pezzi.map(({ nome, ingombro, volumeMm3 }) => ({ name: nome, size: ingombro, volumeMm3 })),
      },
    };
  }
  let iges: Uint8Array<ArrayBuffer>;
  try {
    iges = await delivery.convertIges(written.step, signal);
  } catch {
    return { status: 'needsFix', problem: signal.aborted ? 'changed' : 'prepare' };
  }
  const read = await delivery.consegna.rileggi(
    {
      formato: 'iges',
      file: iges,
      attesi: written.pezzi.map(({ nome, volumeMm3 }) => ({ nome, volumeMm3 })),
    },
    { signal },
  );
  return read.stato === 'verificato'
    ? { status: 'verified', files: [createExportFile('iges', 'model', iges)] }
    : needsFix(read);
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
  pdf: PreparedExport;
}> {
  // Serialize native exports: their runtime document shares mutable kernel state.
  const step = await prepareProjectExport({ ...input, format: 'step' });
  const glb = await prepareProjectExport({ ...input, format: 'glb' });
  const photo = await captureProjectPhoto(input);
  // The PDF sheet (E3a) of SMLib models; other kernels report it unavailable and the dialog does not offer it.
  const pdf = await prepareProjectExport({ ...input, format: 'pdf' });
  return { step, glb, photo, pdf };
}

/** Initial row state is checking; readiness is only assigned once the actual file is prepared. */
export type ProjectExportRows = Partial<PreparedProjectExport>;
