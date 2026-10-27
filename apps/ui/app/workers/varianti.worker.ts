/**
 * The assistant's variants worker (SinopiaCAD D4, D5): a kernel of its own that checks the open family model and
 * builds, checks and renders its variants, off the project's kernel (worker policy, rule 13).
 */
// oxlint-disable-next-line import/no-unassigned-import -- the package's worker entry exposes its functions on import.
import '@taucad/smlib/varianti/worker';
