/**
 * Worker della consegna (E3a), con un kernel SMLib suo come quelli della producibilità e della verifica.
 *
 * Riscrive e rilegge lo STEP, rilegge l'IGES convertito, scrive il DXF e i disegni della tavola fuori dal thread
 * dell'interfaccia e fuori dal worker del kernel del progetto (che ha il suo RPC fisso). La geometria arriva come lo
 * STEP che il kernel del progetto esporta già per Esporta: nessun protocollo nuovo, nessun OpenCASCADE.
 *
 * L'interfaccia lo avvia con `esponiConsegna()` nel proprio file di worker.
 */
import { expose } from '@classcad/smlibwasm/worker';

/**
 * Risponde alle chiamate di `creaConsegna` in questo worker.
 * @public
 */
export function esponiConsegna(): void {
  expose(async () => {
    const [lib, { funzioniConsegna }] = await Promise.all([
      import('@classcad/smlibwasm'),
      import('#consegna/funzioni.js'),
    ]);
    return funzioniConsegna(lib);
  });
}
