import { KernelWorker } from '@classcad/smlibwasm/worker';
import type { WorkerLike } from '@classcad/smlibwasm/worker';
import type { funzioniVerifica, RichiestaVerifica, RispostaVerifica } from '#verifica/verifica-funzioni.js';

/**
 * Il lato chiamante della verifica D3: crea il worker alla prima richiesta, una richiesta alla volta, lo chiude con
 * `chiudi()`. `KernelWorker` non carica il kernel su questo thread (attraversano solo dati semplici).
 *
 * L'`AbortSignal` di una richiesta termina il worker (la richiesta finisce subito con il motivo del segnale; la
 * prossima ne avvia uno nuovo). Il budget dell'ottimizzatore (45 s) si chiude da solo dentro il worker; il `timeout`
 * qui è la rete di sicurezza oltre il budget.
 */

/** Il verificatore: `verifica` e `chiudi`. */
export type Verificatore = {
  verifica: (richiesta: RichiestaVerifica, opzioni?: { signal?: AbortSignal }) => Promise<RispostaVerifica>;
  /** Termina il worker se c'è (le richieste in corso finiscono con `AbortError`). */
  chiudi: () => void;
};

/**
 * Crea il verificatore.
 * @param creaWorker - Crea il worker, per esempio
 *   `() => new Worker(new URL('@taucad/smlib/verifica/worker', import.meta.url), { type: 'module' })`.
 * @param opzioni - Margine oltre il budget prima di terminare il worker (predefinito 15 s).
 * @returns Il verificatore.
 */
export function creaVerificatore(creaWorker: () => WorkerLike, opzioni: { margineMs?: number } = {}): Verificatore {
  let worker: KernelWorker<ReturnType<typeof funzioniVerifica>> | undefined;
  return {
    async verifica(richiesta, { signal } = {}) {
      worker ??= new KernelWorker<ReturnType<typeof funzioniVerifica>>(creaWorker);
      const timeout = (richiesta.opzioni?.budgetMs ?? 45_000) + (opzioni.margineMs ?? 15_000);
      return worker.call('verifica', [richiesta], { timeout, ...(signal ? { signal } : {}) });
    },
    chiudi() {
      worker?.terminate();
      worker = undefined;
    },
  };
}
