import { creaValutatoreVarianti } from '@taucad/smlib/varianti';
import type { ValutatoreVarianti } from '@taucad/smlib/varianti';

/**
 * The variants worker of the project page (SinopiaCAD D4, D5): one per page, made at the first check and closed when
 * the assistant leaves, so its WebAssembly kernel does not outlive the project.
 */

let valutatore: ValutatoreVarianti | undefined;

/**
 * The page's variants worker, made on first use.
 *
 * @returns The evaluator.
 */
export function prendiValutatoreVarianti(): ValutatoreVarianti {
  valutatore ??= creaValutatoreVarianti(
    () => new Worker(new URL('../workers/varianti.worker.ts', import.meta.url), { type: 'module', name: 'varianti' }),
  );
  return valutatore;
}

/** Close the worker; the next use makes a new one. */
export function chiudiValutatoreVarianti(): void {
  valutatore?.chiudi();
  valutatore = undefined;
}
