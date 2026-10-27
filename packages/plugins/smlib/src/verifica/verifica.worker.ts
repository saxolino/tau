/**
 * Worker dedicato della verifica D3 (silhouette ↔ maschera), con un kernel SMLib suo.
 *
 * Perché un worker suo e non quello del kernel del progetto: l'ottimizzazione dura fino a 45 s su un kernel a un solo
 * thread e bloccherebbe le valutazioni del modello (regola 13 di `docs/policy/worker-policy.md`: calcoli di una
 * funzione che si metterebbero in coda a quelli di un'altra → worker nuovo); il worker del kernel ha un RPC fisso del
 * runtime (valuta, esporta, viste) che andrebbe esteso nel protocollo; `KernelWorker` interrompe una chiamata
 * terminando il worker (l'unica cosa che ferma un kernel al lavoro) e un crash del kernel durante l'ottimizzazione non
 * tocca quello del progetto. Il vantaggio che la specifica cercava nel worker del kernel (nessuna geometria copiata
 * fra worker) resta: qui la famiglia si ricostruisce dai parametri e attraversano il confine solo il PNG della maschera
 * e numeri. Il prezzo è un secondo modulo WebAssembly in memoria finché il worker vive (si crea alla prima verifica e
 * si chiude dopo).
 */
import { expose } from '@classcad/smlibwasm/worker';

expose(async () => {
  const [lib, { funzioniVerifica }] = await Promise.all([
    import('@classcad/smlibwasm'),
    import('#verifica/verifica-funzioni.js'),
  ]);
  return funzioniVerifica(lib);
});
