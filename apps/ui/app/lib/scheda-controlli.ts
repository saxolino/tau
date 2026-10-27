import type { Esito } from '@taucad/smlib/famiglie';
import type { ControlliScheda } from '#components/chat/assistant-brief-card.js';
import type { Language } from '#i18n/language.js';
import { rigaEsito } from '#lib/assistant-brief.js';

/**
 * What the card needs from the manufacturability checks of the open model: the same state and checks the inspector's
 * «Producibilità» reads (`useProducibilita()`), so the card does not measure anything on its own.
 */
export type ProducibilitaLetta = Readonly<{
  stato: 'inattivo' | 'in_corso' | 'pronto' | 'non_disponibile' | 'errore';
  controlli: readonly Esito[];
  /** Whether the checks describe the geometry on screen. */
  aggiornati: boolean;
}>;

/**
 * The card's «Producibilità» rows from the shared checks: running while the model is measured or a newer render
 * waits for its measure, unavailable (no rows) where the checks do not read the kernel, and otherwise the warnings
 * and blocks, blocks first, worded as the designer reads them.
 *
 * @param producibilita - The state and checks of the open model.
 * @param language - The language of the rows.
 * @returns The card's checks, or undefined when there is nothing to say (checks unavailable for this kernel).
 */
export function controlliDaProducibilita(
  producibilita: ProducibilitaLetta,
  language: Language,
): ControlliScheda | undefined {
  switch (producibilita.stato) {
    case 'non_disponibile': {
      return undefined;
    }
    case 'errore': {
      return { stato: 'errore' };
    }
    case 'inattivo':
    case 'in_corso': {
      return { stato: 'caricamento' };
    }
    case 'pronto': {
      if (!producibilita.aggiornati) {
        return { stato: 'caricamento' };
      }
      return {
        stato: 'pronto',
        righe: producibilita.controlli
          .filter(({ livello }) => livello === 'avviso' || livello === 'blocco')
          .toSorted((a, b) => (a.livello === b.livello ? 0 : a.livello === 'blocco' ? -1 : 1))
          .map((esito, indice) => ({
            id: `${esito.codice}-${esito.pezzo ?? ''}-${indice}`,
            testo: rigaEsito(esito, language),
            livello: esito.livello === 'blocco' ? 'blocco' : 'avviso',
            ...(esito.pezzo ? { pezzo: esito.pezzo } : {}),
          })),
      };
    }
  }
}
