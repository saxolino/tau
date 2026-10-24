import type { ExportFile } from '@taucad/types';

export const projectExportFormats = ['step', 'stl', 'glb', 'png'] as const;
export type ProjectExportFormat = (typeof projectExportFormats)[number];
export type ExportProblem =
  | 'prepare'
  | 'read'
  | 'names'
  | 'solids'
  | 'invalid'
  | 'independent'
  | 'selection'
  | 'changed'
  | 'capture';
/** A ready photo has no files yet: the PNG is taken when it is asked for. */
export type PreparedExport =
  | { status: 'verified' | 'ready'; files: ExportFile[] }
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
