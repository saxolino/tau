import { KernelWorker } from '@classcad/smlibwasm/worker';
import type { WorkerLike } from '@classcad/smlibwasm/worker';
import type { funzioniConsegna } from '#consegna/funzioni.js';
import type {
  EsitoDxf,
  EsitoRilettura,
  EsitoStep,
  EsitoTavola,
  RichiestaDxf,
  RichiestaRilettura,
  RichiestaStep,
  RichiestaTavola,
} from '#consegna/tipi.js';

/**
 * Il lato chiamante della consegna: crea il worker alla prima richiesta, una richiesta alla volta, lo chiude con
 * `chiudi()`. L'`AbortSignal` di una richiesta la toglie dalla fila o termina il worker se è già al lavoro.
 * @public
 */
export type Consegna = {
  step: (richiesta: RichiestaStep, opzioni?: { signal?: AbortSignal }) => Promise<EsitoStep>;
  rileggi: (richiesta: RichiestaRilettura, opzioni?: { signal?: AbortSignal }) => Promise<EsitoRilettura>;
  dxf: (richiesta: RichiestaDxf, opzioni?: { signal?: AbortSignal }) => Promise<EsitoDxf>;
  tavola: (richiesta: RichiestaTavola, opzioni?: { signal?: AbortSignal }) => Promise<EsitoTavola>;
  /** Termina il worker se c'è (le richieste in corso finiscono con `AbortError`). */
  chiudi: () => void;
};

type Funzioni = ReturnType<typeof funzioniConsegna>;

/**
 * Crea il client della consegna.
 * @param creaWorker - Crea il worker, il cui modulo chiama `esponiConsegna()`.
 * @param opzioni - Tempo massimo di una richiesta (ms) prima di terminare il worker (predefinito 120 s).
 * @returns Il client.
 * @public
 */
export function creaConsegna(creaWorker: () => WorkerLike, opzioni: { requestTimeout?: number } = {}): Consegna {
  let worker: KernelWorker<Funzioni> | undefined;
  const avvia = (): KernelWorker<Funzioni> => {
    worker ??= new KernelWorker<Funzioni>(creaWorker);
    return worker;
  };
  const tempo = (signal: AbortSignal | undefined): Parameters<KernelWorker<Funzioni>['call']>[2] => ({
    timeout: opzioni.requestTimeout ?? 120_000,
    ...(signal ? { signal } : {}),
  });
  return {
    step: async (richiesta, { signal } = {}) => avvia().call('step', [richiesta], tempo(signal)),
    rileggi: async (richiesta, { signal } = {}) => avvia().call('rileggi', [richiesta], tempo(signal)),
    dxf: async (richiesta, { signal } = {}) => avvia().call('dxf', [richiesta], tempo(signal)),
    tavola: async (richiesta, { signal } = {}) => avvia().call('tavola', [richiesta], tempo(signal)),
    chiudi() {
      worker?.terminate();
      worker = undefined;
    },
  };
}
