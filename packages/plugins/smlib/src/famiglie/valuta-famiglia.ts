import type * as Smlib from '@classcad/smlibwasm';
import type { Esito, FamigliaQualsiasi, OpzioniFamiglia, PezzoFamiglia, Processo } from '#famiglie/famiglia.js';

/**
 * Una valutazione completa: parametri normalizzati, pezzi, esiti di costruzione e verifiche, tempi.
 * @public
 */
export type Valutazione = {
  parametri: unknown;
  pezzi: PezzoFamiglia[];
  esiti: Esito[];
  /** Milliseconds. */
  tempoCostruzione: number;
  /** Milliseconds. */
  tempoVerifiche: number;
};

/**
 * Normalizza, costruisce e verifica una famiglia: la via diretta del worker (D3, varianti) e dei test.
 * @param lib - Libreria SMLib.
 * @param famiglia - Famiglia del registro.
 * @param richiesta - Parametri anche parziali (le chiavi mancanti prendono i predefiniti della variante), variante,
 *   processo (default: quello dei parametri) e se eseguire le verifiche.
 * @returns Pezzi, esiti e tempi.
 * @public
 */
export function valutaFamiglia(
  lib: typeof Smlib,
  famiglia: FamigliaQualsiasi,
  richiesta: OpzioniFamiglia & { parametri?: unknown; processo?: Processo; verifiche?: boolean } = {},
): Valutazione {
  const { parametri: p, ...opzioni } = richiesta;
  const parametri: unknown = famiglia.normalizza(p, opzioni);
  const inizio = performance.now();
  const { pezzi, esiti } = famiglia.costruisciConEsiti(lib, parametri, opzioni);
  const costruito = performance.now();
  const verifiche =
    opzioni.verifiche === false ? [] : famiglia.verifiche(lib, pezzi, parametri, opzioni.processo, opzioni);
  return {
    parametri,
    pezzi,
    esiti: [...esiti, ...verifiche],
    tempoCostruzione: costruito - inizio,
    tempoVerifiche: performance.now() - costruito,
  };
}
