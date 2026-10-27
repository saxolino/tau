/**
 * Worker dedicato della producibilità (E1), con un kernel SMLib suo, come quello della verifica D3.
 *
 * Perché un worker suo e non quello del kernel del progetto: le misure (raggi, sformo, fori) durano decine o
 * centinaia di millisecondi e si metterebbero in coda ai rendering del modello (regola 13 di
 * `docs/policy/worker-policy.md`); il worker del kernel ha un RPC fisso del runtime (valuta, esporta, viste). La
 * geometria arriva come lo STEP che il kernel del progetto esporta già per Esporta: nessun protocollo nuovo.
 *
 * L'interfaccia lo avvia con `esponiProducibilita()` nel proprio file di worker (una chiamata esplicita, così un
 * bundler non la scarta come import senza effetti).
 */
import { expose } from '@classcad/smlibwasm/worker';

/**
 * Risponde alle chiamate di `creaAnalizzatore` in questo worker.
 * @public
 */
export function esponiProducibilita(): void {
  expose(async () => {
    const [lib, { funzioniProducibilita }] = await Promise.all([
      import('@classcad/smlibwasm'),
      import('#producibilita/funzioni.js'),
    ]);
    return funzioniProducibilita(lib);
  });
}
