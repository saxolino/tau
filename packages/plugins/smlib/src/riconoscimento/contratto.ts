import type { DefinizioneParametro, FamigliaQualsiasi } from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';
import { visteOrtogonali } from '#famiglie/viste-ortogonali.js';
import type { ContrattoRiconoscimento, FamigliaCatalogo, ParametroCatalogo } from '#riconoscimento/condiviso.js';
import { contestoRiconoscimentoSchema } from '#riconoscimento/contesto.js';
import { mappaLibreria, mappaPartType } from '#riconoscimento/famiglia-da-part-type.js';
import { schedaParteSchema } from '#riconoscimento/scheda-parte.js';
import { schedaRiconoscimentoSchema, schemaPerApi } from '#riconoscimento/schema.js';

/**
 * Il contratto del riconoscimento con la funzione `sinopiacad` di Sinopia: generato da qui (schemi zod, registro delle
 * famiglie, tabelle dei tipi) e salvato in `riconoscimento.contratto.json`, che si copia in Sinopia come
 * `supabase/functions/sinopiacad/riconoscimento/contratto.json`. `contratto.test.ts` controlla che il file sia
 * aggiornato (`AGGIORNA_CONTRATTO=1` lo riscrive).
 */

/** Il modello del classificatore (specifica §2.3): Claude Sonnet 5.5 con uscita strutturata. @public */
export const modelloRiconoscimento = 'claude-sonnet-5-5';

/**
 * Versione del contratto: sale quando la forma di ingresso o di uscita cambia. La 3 aggiunge all'ingresso il `contesto`
 * e le viste generate (`immagini.principale`, `immagini.controllo`); l'uscita resta quella della 2.
 * @public
 */
export const versioneContratto = 3;

const parametroCatalogo = (definizione: DefinizioneParametro): ParametroCatalogo => ({
  chiave: definizione.chiave,
  unita: definizione.unita,
  ...(definizione.min === undefined ? {} : { min: definizione.min }),
  ...(definizione.max === undefined ? {} : { max: definizione.max }),
  ...(definizione.passo === undefined ? {} : { passo: definizione.passo }),
  default: definizione.default,
  ...(definizione.valori === undefined ? {} : { valori: definizione.valori }),
  ...(definizione.critico ? { critico: true } : {}),
  ...(definizione.silhouetteSensibile ? { silhouetteSensibile: true } : {}),
  ...(definizione.derivato ? { derivato: true } : {}),
  ...(definizione.descrizione === undefined ? {} : { descrizione: definizione.descrizione }),
});

/**
 * Una famiglia del registro come la vedono prompt e normalizzazione.
 * @param famiglia - La famiglia del registro.
 * @returns La voce del catalogo.
 * @public
 */
export const famigliaCatalogo = (famiglia: FamigliaQualsiasi): FamigliaCatalogo => ({
  id: famiglia.id,
  versione: famiglia.versione,
  varianti: [...famiglia.varianti],
  partTypes: [...famiglia.partTypes],
  viste: {
    principale: famiglia.viste.principale,
    facce: famiglia.viste.facce.map((faccia) => ({ id: faccia.id, descrizione: faccia.descrizione })),
    nomi: famiglia.viste.nomi,
    ...(Object.hasOwn(visteOrtogonali, famiglia.id) ? { ortogonali: visteOrtogonali[famiglia.id] } : {}),
  },
  parametri: famiglia.parametri
    .filter((definizione) => !definizione.fuoriRiconoscimento)
    .map((definizione) => parametroCatalogo(definizione)),
});

/**
 * Il catalogo delle famiglie del registro, in ordine di id.
 * @returns Le famiglie.
 * @public
 */
export const catalogoFamiglie = (): FamigliaCatalogo[] =>
  Object.values(famiglie)
    .map((famiglia) => famigliaCatalogo(famiglia))
    .toSorted((a, b) => a.id.localeCompare(b.id));

/**
 * Il contratto completo, come va scritto in `riconoscimento.contratto.json`.
 * @returns Il contratto.
 * @public
 */
export function generaContratto(): ContrattoRiconoscimento {
  const tabellaPartType: ContrattoRiconoscimento['mappaPartType'] = Object.fromEntries(Object.entries(mappaPartType));
  const tabellaLibreria: ContrattoRiconoscimento['mappaLibreria'] = Object.fromEntries(Object.entries(mappaLibreria));
  const uscita = schemaPerApi(schedaRiconoscimentoSchema);
  const parte = schemaPerApi(schedaParteSchema, { io: 'input', tieniPattern: true });
  const contesto = schemaPerApi(contestoRiconoscimentoSchema, { io: 'input', tieniPattern: true });
  return {
    versione: versioneContratto,
    modello: modelloRiconoscimento,
    schemaUscita: uscita.schema,
    limitiUscita: uscita.limiti,
    schemaParte: parte.schema,
    limitiParte: parte.limiti,
    schemaContesto: contesto.schema,
    limitiContesto: contesto.limiti,
    famiglie: catalogoFamiglie(),
    mappaPartType: tabellaPartType,
    mappaLibreria: tabellaLibreria,
  };
}

/**
 * Il testo del file del contratto (JSON con due spazi e a capo finale), lo stesso byte per byte nei due repository.
 * @returns Il testo.
 * @public
 */
export const testoContratto = (): string => `${JSON.stringify(generaContratto(), null, 2)}\n`;
