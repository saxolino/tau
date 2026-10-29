/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (famiglie, facce): snake_case come in Sinopia. */
import type { IdFamiglia } from '#famiglie/famiglia.js';
import type { VisteOrtogonali, VisteOrtogonaliFamiglia } from '#famiglie/viste.js';

/**
 * La tabella delle viste piatte che si generano dalla foto, per famiglia (piano «viste ortogonali», §3). Fonte unica:
 * il contratto la copia in `famiglie[].viste.ortogonali`, Sinopia tiene la sua copia con le frasi per il generatore
 * (`_shared/parti-vista-canonica.ts`) e una prova là la confronta con il contratto.
 *
 * - tacco: di fianco (profilo, altezza, vita), controllo da dietro (larghezza e bombature); la seduta dall'alto solo su
 *   richiesta, perché costa una generazione in più;
 * - fondo: la suola da sotto (la pianta), controllo di fianco (spessore); l'intersuola o zeppa al contrario, di fianco
 *   e da sotto;
 * - puntale: di fianco, controllo dall'alto;
 * - pezzi piatti (fibbia, placca, pendente) e pezzi piccoli a vista (borchia, occhiello): di fronte (la faccia a vista
 *   `sopra`), controllo di taglio;
 * - anello: di fronte lungo il dito, controllo di fianco.
 *
 * Le parti che non sono di una famiglia (tomaia, puntale di pelle, lacci) non hanno viste.
 */

const pezzoDiFronte: VisteOrtogonali = { principale: 'sopra', controllo: ['fianco_esterno'] };

/** Le viste ortogonali di ogni famiglia del registro. @public */
export const visteOrtogonali: Readonly<Record<IdFamiglia, VisteOrtogonaliFamiglia>> = {
  tacco: { principale: 'fianco_esterno', controllo: ['dietro', 'sopra'] },
  fondo_semplice: {
    principale: 'sotto',
    controllo: ['fianco_esterno'],
    varianti: { zeppa: { principale: 'fianco_esterno', controllo: ['sotto'] } },
  },
  puntale: { principale: 'fianco_esterno', controllo: ['sopra'] },
  fibbia: pezzoDiFronte,
  placca: pezzoDiFronte,
  pendente: pezzoDiFronte,
  borchia: pezzoDiFronte,
  occhiello: pezzoDiFronte,
  anello: { principale: 'asse_dito', controllo: ['fianco_esterno'] },
};

/**
 * Le viste ortogonali di una parte: quelle della sua variante se la tabella ne ha, altrimenti quelle della famiglia.
 * @param famiglia - La famiglia.
 * @param variante - La variante, se nota.
 * @returns Principale e controlli, o `undefined` se la famiglia non ha viste.
 * @public
 */
export function visteOrtogonaliDi(famiglia: string, variante?: string): VisteOrtogonali | undefined {
  const voce = Object.hasOwn(visteOrtogonali, famiglia) ? visteOrtogonali[famiglia as IdFamiglia] : undefined;
  if (voce === undefined) {
    return undefined;
  }
  const perVariante =
    variante !== undefined && voce.varianti && Object.hasOwn(voce.varianti, variante)
      ? voce.varianti[variante]
      : undefined;
  return perVariante ?? { principale: voce.principale, controllo: voce.controllo };
}
