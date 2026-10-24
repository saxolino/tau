import type { KernelId } from '@taucad/types/constants';

/**
 * The geometry engines SinopiaCAD offers, the default first: SMLib for precise pieces, PicoVoxel for sculpted forms,
 * Replicad for the exact operations SMLib cannot do, Manifold for mesh work.
 *
 * Nobody picks an engine by hand: the agent chooses one per job (`create-model`), and a project keeps the engine its
 * main file is written in. Tau's other kernels stay in its catalog and runtime, so a project already written for one
 * still opens, but no picker, skill or create-model row offers them.
 */
export const sinopiaKernelIds = ['smlib', 'picovoxel', 'replicad', 'manifold'] as const satisfies readonly KernelId[];

/** One engine SinopiaCAD offers. */
export type SinopiaKernelId = (typeof sinopiaKernelIds)[number];

/** The engine of a new project's empty starter file. It pins nothing: the agent replaces it when the job needs another. */
export const sinopiaStarterKernelId: SinopiaKernelId = 'smlib';

/**
 * Whether SinopiaCAD offers this catalog id.
 *
 * @param kernelId - A kernel catalog id.
 * @returns True for the four engines in {@link sinopiaKernelIds}.
 */
export const isSinopiaKernelId = (kernelId: string): kernelId is SinopiaKernelId =>
  (sinopiaKernelIds as readonly string[]).includes(kernelId);
