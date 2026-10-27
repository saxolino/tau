import { KernelWorker } from '@classcad/smlibwasm/worker';
import type { WorkerLike } from '@classcad/smlibwasm/worker';
import type { funzioniProducibilita } from '#producibilita/funzioni.js';
import type { RichiestaProducibilita, RispostaProducibilita } from '#producibilita/tipi.js';

/**
 * Il lato chiamante della producibilità: crea il worker alla prima richiesta, una richiesta alla volta (le altre
 * aspettano in fila), lo chiude con `chiudi()`. L'`AbortSignal` di una richiesta la toglie dalla fila o termina il
 * worker se è già al lavoro (la prossima ne avvia uno nuovo).
 */

/**
 * L'analizzatore: `analizza` e `chiudi`.
 * @public
 */
export type Analizzatore = {
  analizza: (richiesta: RichiestaProducibilita, opzioni?: { signal?: AbortSignal }) => Promise<RispostaProducibilita>;
  /** Termina il worker se c'è (le richieste in corso finiscono con `AbortError`). */
  chiudi: () => void;
};

/**
 * Crea l'analizzatore.
 * @param creaWorker - Crea il worker, per esempio
 *   `() => new Worker(new URL('./producibilita.worker.ts', import.meta.url), { type: 'module' })`, il cui modulo chiama
 *   `esponiProducibilita()`.
 * @param opzioni - Tempo massimo di un'analisi (ms) prima di terminare il worker (predefinito 60 s).
 * @returns L'analizzatore.
 * @public
 */
export function creaAnalizzatore(
  creaWorker: () => WorkerLike,
  opzioni: { analysisTimeout?: number } = {},
): Analizzatore {
  let worker: KernelWorker<ReturnType<typeof funzioniProducibilita>> | undefined;
  return {
    async analizza(richiesta, { signal } = {}) {
      worker ??= new KernelWorker<ReturnType<typeof funzioniProducibilita>>(creaWorker);
      return worker.call('analizza', [richiesta], {
        timeout: opzioni.analysisTimeout ?? 60_000,
        ...(signal ? { signal } : {}),
      });
    },
    chiudi() {
      worker?.terminate();
      worker = undefined;
    },
  };
}
