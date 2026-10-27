import type * as Smlib from '@classcad/smlibwasm';
import { preparaMascheraPng } from '#verifica/maschera.js';
import type { OpzioniMaschera } from '#verifica/maschera.js';
import { verificaSilhouette } from '#verifica/ottimizza.js';
import type { EsitoVerifica, IngressoVerifica, OpzioniOttimizzatore } from '#verifica/ottimizza.js';
import { codificaPng } from '#verifica/png.js';

/**
 * Le funzioni del worker della verifica D3 (esposte da `verifica.worker.ts`, chiamate con `KernelWorker`).
 *
 * Tutto ciò che attraversa il confine è dato semplice: il PNG della maschera entra, parametri, camera, IoU, tempi e il
 * PNG dell'immagine differenza escono. Nessuna geometria passa fra i thread: il worker ricostruisce la famiglia dai
 * parametri con il proprio kernel.
 */

/** Richiesta serializzabile: la maschera come PNG (la prepara il worker) e la scala in pixel della foto. */
export type RichiestaVerifica = Omit<IngressoVerifica, 'maschera' | 'scala' | 'opzioni'> & {
  maschera: { png: Uint8Array; opzioni?: Omit<OpzioniMaschera, 'pxPerMm' | 'latiOcclusi'> };
  /** Pixel della **foto** per mm, o null; il worker li porta nella maschera (× k). */
  scala: { pxPerMmFoto: number | null; fonte: IngressoVerifica['scala']['fonte'] };
  opzioni?: Omit<OpzioniOttimizzatore, 'segnale' | 'adesso'>;
};

/** Risposta: l'esito senza le maschere grezze, con l'immagine differenza in PNG e il legame maschera ↔ foto. */
export type RispostaVerifica = Omit<EsitoVerifica, 'silhouette' | 'differenza'> & {
  differenzaPng: Uint8Array;
  maschera: { k: number; origine: [number, number]; lato: number };
  /** Tempo di preparazione della maschera (ms). */
  tempoMascheraMs: number;
};

/**
 * Le funzioni del worker sopra una libreria data (quella del worker; nei test quella del processo).
 * @param lib - Libreria SMLib.
 * @returns `{ verifica }`.
 */
export function funzioniVerifica(lib: typeof Smlib): {
  verifica: (richiesta: RichiestaVerifica) => Promise<RispostaVerifica>;
} {
  return {
    async verifica(richiesta) {
      const inizio = performance.now();
      const maschera = await preparaMascheraPng(richiesta.maschera.png, {
        ...richiesta.maschera.opzioni,
        pxPerMm: richiesta.scala.pxPerMmFoto,
        latiOcclusi: richiesta.vista.latiOcclusi ?? [],
      });
      const tempoMascheraMs = performance.now() - inizio;
      const {
        silhouette: _silhouette,
        differenza,
        ...esito
      } = verificaSilhouette(lib, {
        famiglia: richiesta.famiglia,
        ...(richiesta.variante === undefined ? {} : { variante: richiesta.variante }),
        stima: richiesta.stima,
        vista: richiesta.vista,
        scala: { pxPerMm: maschera.pxPerMm, fonte: richiesta.scala.fonte },
        maschera,
        ...(richiesta.opzioni ? { opzioni: richiesta.opzioni } : {}),
      });
      return {
        ...esito,
        differenzaPng: await codificaPng(differenza),
        maschera: { k: maschera.k, origine: maschera.origine, lato: maschera.larghezza },
        tempoMascheraMs,
      };
    },
  };
}
