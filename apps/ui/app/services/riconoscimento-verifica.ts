import { creaVerificatore } from '@taucad/smlib/verifica';
import type { Verificatore } from '@taucad/smlib/verifica';

/**
 * The D3 check in the browser (SinopiaCAD silhouette ↔ mask): one worker, made at the first check and ended with
 * `chiudi()` or when a check is aborted (the signal terminates the worker, the only thing that stops a kernel at work).
 *
 * @returns A verifier that makes its worker on first use.
 */
export const creaVerificatoreBrowser = (): Verificatore =>
  creaVerificatore(
    () => new Worker(new URL('../workers/verifica-silhouette.worker.ts', import.meta.url), { type: 'module' }),
  );
