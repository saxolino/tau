import { KernelWorker } from '@classcad/smlibwasm/worker';
import type { WorkerLike } from '@classcad/smlibwasm/worker';
import type {
  ControlloAttuale,
  EsitoVarianti,
  funzioniVarianti,
  RichiestaControllo,
  RichiestaVarianti,
} from '#varianti/varianti-funzioni.js';

/**
 * Il lato chiamante del worker delle varianti: lo crea alla prima richiesta, una richiesta alla volta (le chiamate
 * di `KernelWorker` vanno in fila), lo chiude con `chiudi()`. Un `AbortSignal` termina il worker: la richiesta dopo
 * ne avvia uno nuovo.
 * @public
 */
export type ValutatoreVarianti = {
  controlla: (richiesta: RichiestaControllo, opzioni?: { signal?: AbortSignal }) => Promise<ControlloAttuale>;
  proponi: (richiesta: RichiestaVarianti, opzioni?: { signal?: AbortSignal }) => Promise<EsitoVarianti>;
  /** Termina il worker se c'è (le richieste in corso finiscono con `AbortError`). */
  chiudi: () => void;
};

/**
 * Crea il valutatore.
 * @param creaWorker - Crea il worker, per esempio
 *   `() => new Worker(new URL('./varianti.worker.ts', import.meta.url), { type: 'module' })`.
 * @param opzioni - Durata massima di una richiesta (predefinita 30 s: tre varianti stanno sotto i 5 s).
 * @returns Il valutatore.
 * @public
 */
export function creaValutatoreVarianti(
  creaWorker: () => WorkerLike,
  opzioni: {
    /** Milliseconds. */
    durataMassima?: number;
  } = {},
): ValutatoreVarianti {
  let worker: KernelWorker<ReturnType<typeof funzioniVarianti>> | undefined;
  /** Milliseconds. */
  const durataMassima = opzioni.durataMassima ?? 30_000;
  const avvia = (): KernelWorker<ReturnType<typeof funzioniVarianti>> => {
    worker ??= new KernelWorker<ReturnType<typeof funzioniVarianti>>(creaWorker);
    return worker;
  };
  return {
    async controlla(richiesta, { signal } = {}) {
      return avvia().call('controlla', [richiesta], { timeout: durataMassima, ...(signal ? { signal } : {}) });
    },
    async proponi(richiesta, { signal } = {}) {
      return avvia().call('proponi', [richiesta], { timeout: durataMassima, ...(signal ? { signal } : {}) });
    },
    chiudi() {
      worker?.terminate();
      worker = undefined;
    },
  };
}
