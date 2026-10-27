import type { ExportFile } from '@taucad/types';

/** The rows of Esporta, in the order a maker reads them: exact solids, 2D, meshes, pictures, the drawing sheet. */
export const projectExportFormats = ['step', 'iges', 'dxf', 'stl', 'glb', 'png', 'pdf'] as const;
/** The formats SinopiaCAD's delivery (E3a) writes and checks with SMLib, from the kernel's own STEP. */
export const deliveryFormats = ['iges', 'dxf', 'pdf'] as const;
/** Present only when the current evaluated model actually offers saved drawings. */
export type ProjectExportSketches = 'mixed' | 'only';
export type ProjectExportFormat = (typeof projectExportFormats)[number];
export type ExportProblem =
  | 'prepare'
  | 'read'
  | 'names'
  | 'solids'
  | 'invalid'
  | 'independent'
  | 'selection'
  | 'sketchOnly'
  | 'changed'
  | 'capture'
  | 'volume'
  | 'unavailable';
/** A ready photo has no files yet: the PNG is taken when it is asked for. */
/** What the delivery measured on the solids it read back (mm): overall size and each piece. */
export type MeasuredExport = Readonly<{
  size: readonly [number, number, number];
  pieces: ReadonlyArray<Readonly<{ name: string; size: readonly [number, number, number]; volumeMm3: number }>>;
}>;
export type PreparedExport =
  | { status: 'verified' | 'ready'; files: ExportFile[]; measured?: MeasuredExport }
  | { status: 'needsFix'; problem: ExportProblem; files?: ExportFile[]; pieces?: string[] };
export type PreparedProjectExport = Record<ProjectExportFormat, PreparedExport>;
export type StepInspection = { name: string; solids: number; valid: boolean };
export type StepCheckRequest = {
  bytes: Uint8Array<ArrayBuffer>;
  expectedNames: string[];
  /** Omitted means every occurrence. Names must be unique in the model. */
  selectedNames?: string[];
};
export type StepCheckResult =
  | { status: 'verified'; bytes: Uint8Array<ArrayBuffer>; pieces: StepInspection[] }
  | { status: 'needsFix'; problem: ExportProblem; pieces?: string[] };
/** STEP → IGES in the OpenCASCADE worker: the delivery STEP, already read back by SMLib. */
export type IgesConversionRequest = { kind: 'iges'; bytes: Uint8Array<ArrayBuffer> };
export type IgesConversionResult =
  | { status: 'ready'; bytes: Uint8Array<ArrayBuffer> }
  | { status: 'needsFix'; problem: ExportProblem };
