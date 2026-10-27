import type { PromptRiconoscimento, SchedaParteMinima } from '#riconoscimento/condiviso.js';
import { promptRiconoscimento } from '#riconoscimento/condiviso.js';
import { catalogoFamiglie } from '#riconoscimento/contratto.js';
import { mappaLibreria, mappaPartType } from '#riconoscimento/famiglia-da-part-type.js';

/**
 * Il prompt del classificatore (specifica D2 §2.4) costruito dal CAD con il registro delle famiglie: lo stesso testo
 * che la funzione di Sinopia costruisce dal contratto copiato (le funzioni stanno in `condiviso.ts`).
 * @param scheda - La scheda della parte.
 * @param opzioni - Lingua dei motivi, fattore del ritaglio, rientro dopo la verifica D3.
 * @returns Blocchi di sistema, testo dell'utente e famiglie descritte.
 * @public
 */
export function promptPerScheda(
  scheda: SchedaParteMinima,
  opzioni: { lingua: 'it' | 'en'; fattoreRitaglio?: number; rientro?: boolean },
): PromptRiconoscimento {
  return promptRiconoscimento(
    scheda,
    {
      famiglie: catalogoFamiglie(),
      mappaPartType: mappaPartType as Record<string, never>,
      mappaLibreria: mappaLibreria as Record<string, never>,
    },
    opzioni,
  );
}
