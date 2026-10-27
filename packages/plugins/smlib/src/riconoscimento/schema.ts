import { z } from 'zod';
import { facceVista } from '#famiglie/viste.js';
import type { LimiteContratto, SchemaJson } from '#riconoscimento/condiviso.js';

/**
 * La scheda di riconoscimento (specifica D2 §2.4): l'uscita strutturata del classificatore, validata qui con zod e,
 * nella funzione di Sinopia, con lo schema JSON gemello del contratto (`riconoscimento.contratto.json`).
 */

/** Le famiglie che il classificatore può rispondere, più `libero` (ricetta dell'agente) e `non_modellabile`. @public */
export const idRiconoscibili = [
  'tacco',
  'fondo_semplice',
  'fibbia',
  'occhiello',
  'borchia',
  'placca',
  'puntale',
  'anello',
  'pendente',
  'libero',
  'non_modellabile',
] as const;

/** Le viste per nome. @public */
export const nomiVista = [
  'fronte',
  'dietro',
  'fianco_esterno',
  'fianco_interno',
  'tre_quarti',
  'sopra',
  'sotto',
] as const;

/** Da dove viene un parametro. @public */
export const fontiParametro = [
  'misura_nota',
  'taglia',
  'libreria',
  'catalogo',
  'proporzione',
  'default_mestiere',
  'non_visibile',
] as const;

/** Da dove viene la scala riconosciuta. @public */
export const fontiScalaRiconosciuta = ['misura_nota', 'libreria', 'catalogo', 'taglia', 'forma', 'stima'] as const;

const confidenza = z.number().min(0).max(1);

/** Un parametro riconosciuto. @public */
export const parametroRiconosciutoSchema = z.strictObject({
  /** Percorso puntato (`tacco.altezza`): DEVE esistere fra i parametri della famiglia. */
  chiave: z.string(),
  valore: z.union([z.number(), z.string(), z.boolean()]),
  min: z.number().optional(),
  max: z.number().optional(),
  confidenza,
  fonte: z.enum(fontiParametro),
  /** Nella lingua dell'interfaccia: va nella riga «Ipotesi». */
  motivo: z.string().max(140),
});

/** Schema della scheda di riconoscimento. @public */
export const schedaRiconoscimentoSchema = z.strictObject({
  famiglia: z.strictObject({
    id: z.enum(idRiconoscibili),
    confidenza,
    alternative: z.array(z.strictObject({ id: z.enum(idRiconoscibili), confidenza })).max(2),
  }),
  variante: z.strictObject({ id: z.string(), confidenza }),
  vista: z.strictObject({
    nome: z.enum(nomiVista),
    /** La faccia del pezzo che la foto mostra, fra quelle della scheda della famiglia (`viste`): la camera la calcola il codice. */
    faccia: z.enum(facceVista),
    /** Scarto dalla vista dritta della faccia, gradi: quanto la camera è spostata verso destra nell'immagine (0 = di fronte). */
    azimuth: z.number().min(-180).max(180),
    /** Scarto dalla vista dritta della faccia, gradi: quanto la camera è alzata verso l'alto dell'immagine. */
    elevation: z.number().min(-90).max(90),
    /** Rotazione nel piano immagine, gradi. */
    rollo: z.number().min(-45).max(45),
    /** True = foto da lontano o col tele. */
    ortografica: z.boolean(),
    confidenza,
    /** Dove la parte è coperta (per esempio la seduta del tacco sotto la scarpa). */
    latiOcclusi: z.array(z.enum(['alto', 'basso', 'sinistra', 'destra'])).max(4),
  }),
  scala: z.strictObject({
    pxPerMm: z.number().positive().nullable(),
    fonte: z.enum(fontiScalaRiconosciuta),
    riferimento: z.string().max(140),
    confidenza,
  }),
  parametri: z.array(parametroRiconosciutoSchema).max(80),
  /** Chiave dei materiali delle famiglie (`materiali.ts`). */
  materiale: z.strictObject({ chiave: z.string().max(40), confidenza }),
  domande: z
    .array(z.strictObject({ chiave: z.string(), motivo: z.string().max(100), proposte: z.array(z.number()).length(3) }))
    .max(3),
  note: z.string().max(300),
});

/** La scheda di riconoscimento. @public */
export type SchedaRiconoscimento = z.infer<typeof schedaRiconoscimentoSchema>;
/** Un parametro riconosciuto. @public */
export type ParametroRiconosciuto = z.infer<typeof parametroRiconosciutoSchema>;

/** Le parole chiave che `output_config.format` dell'API Anthropic non ammette: diventano limiti del contratto. */
const vincoliNonAmmessi = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
] as const;

/** Le parole chiave tolte senza conservarle (annotazioni). */
const annotazioni = ['$schema', 'default', 'format', 'description', 'title'] as const;

/**
 * Lo schema JSON per l'uscita strutturata e, a parte, i limiti che l'API non sa imporre. Ricavati dallo schema zod
 * (`z.toJSONSchema`), così prompt, convalida del server e convalida del client non divergono.
 * @param schema - Uno schema zod.
 * @param opzioni - `input` per uno schema d'ingresso (i campi con predefinito diventano facoltativi).
 * @returns Lo schema senza vincoli numerici e di lunghezza, e i limiti per percorso.
 * @public
 */
export function schemaPerApi(
  schema: z.ZodType,
  opzioni: { io?: 'input' | 'output'; tieniPattern?: boolean } = {},
): { schema: SchemaJson; limiti: LimiteContratto[] } {
  const grezzo = z.toJSONSchema(schema, { io: opzioni.io ?? 'output', unrepresentable: 'throw' }) as SchemaJson;
  const limiti: LimiteContratto[] = [];
  const pulisci = (nodo: SchemaJson, percorso: string): SchemaJson => {
    const limite: LimiteContratto = { percorso };
    const pulito: SchemaJson = {};
    for (const [chiave, valore] of Object.entries(nodo)) {
      if ((vincoliNonAmmessi as readonly string[]).includes(chiave)) {
        (limite as Record<string, unknown>)[chiave] = valore;
        continue;
      }
      if ((annotazioni as readonly string[]).includes(chiave) || (chiave === 'pattern' && !opzioni.tieniPattern)) {
        continue;
      }
      if (chiave === 'properties') {
        pulito.properties = Object.fromEntries(
          Object.entries(valore as Record<string, SchemaJson>).map(([nome, figlio]) => [
            nome,
            pulisci(figlio, `${percorso}/${nome}`),
          ]),
        );
      } else if (chiave === 'items' && typeof valore === 'object') {
        pulito.items = pulisci(valore as SchemaJson, `${percorso}/*`);
      } else if (chiave === 'prefixItems') {
        pulito.prefixItems = (valore as SchemaJson[]).map((figlio, indice) => pulisci(figlio, `${percorso}/${indice}`));
      } else if (chiave === 'anyOf') {
        pulito.anyOf = (valore as SchemaJson[]).map((figlio) => pulisci(figlio, percorso));
      } else {
        pulito[chiave] = valore;
      }
    }
    if (Object.keys(limite).length > 1) {
      limiti.push(limite);
    }
    return pulito;
  };
  const pulito = pulisci(grezzo, '');
  return { schema: pulito, limiti };
}
