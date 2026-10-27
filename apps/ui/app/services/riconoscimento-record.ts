import { z } from 'zod';
import { famiglie } from '@taucad/smlib/famiglie';
import type { IdFamiglia } from '@taucad/smlib/famiglie';
import { schedaParteSchema, schedaRiconoscimentoSchema } from '@taucad/smlib/riconoscimento';
import { vistaSenzaFaccia } from '@taucad/smlib/verifica';

/**
 * The recognition's record in the project (SinopiaCAD D2 §2.7, T-D2-07): `.tau/workbench/riconoscimento.json`, with
 * the part sheet, the recognition sheet, the designer's answers to the chips and the D3 verification. Workbench
 * records admit `version` (the `wr-version` exception of the parameter-record policy); the values the designer fixes
 * live in `.tau/parameters/`, not here: this file only remembers which questions were answered.
 */

/** Where the record lives, relative to the project root. */
export const percorsoRiconoscimento = '.tau/workbench/riconoscimento.json';

/**
 * Where the part's mask is kept in the project (`riferimenti/<part>.maschera.png`), beside its picture: the D3 check
 * runs again on it when the designer answers a chip.
 *
 * @param idParte - The part id of the part sheet.
 * @returns The path, relative to the project root.
 */
export const percorsoMaschera = (idParte: string): string =>
  `riferimenti/${idParte.replaceAll(/[^\w-]/gu, '_') || 'parte'}.maschera.png`;

/** The record version this build writes. */
export const versioneRecord = 1;

const valoreSchema = z.union([z.number(), z.string(), z.boolean()]);

const verificaSchema = z.discriminatedUnion('stato', [
  z.object({ stato: z.literal('non_disponibile'), motivo: z.string() }),
  z.object({
    stato: z.literal('fatta'),
    iou: z.number(),
    camera: z.object({
      azimuth: z.number(),
      elevation: z.number(),
      rollo: z.number(),
      pxPerMm: z.number(),
      cx: z.number(),
      cy: z.number(),
    }),
    /** How the check ended: accepted, accepted with reserve, or kept with a warning (the best of the two rounds). */
    esito: z.enum(['accettato', 'riserva', 'avviso']).optional(),
    /** Parameters the optimiser moved that the photo's view does not fix: they stay assumptions (observability rule). */
    nonOsservabili: z.array(z.string()).optional(),
    /** A critical measure is not seen from this view: «Aggiungi una foto di lato». */
    suggerimenti: z.array(z.enum(['foto_lato'])).optional(),
    /** Times the model was asked again with the difference picture (0 or 1). */
    rientri: z.number().int().min(0).optional(),
  }),
]);

/** Schema of the record, version 1. */
export const recordRiconoscimentoSchema = z.object({
  version: z.literal(versioneRecord),
  creato: z.string(),
  schedaParte: schedaParteSchema,
  scheda: schedaRiconoscimentoSchema,
  /** The family built (the designer may have chosen another one at the family chip) and its variant. */
  famiglia: z.object({ id: z.string(), variante: z.string(), scelta: z.boolean() }),
  /** Answers to the parameter chips, by dotted key: the values are locked in `.tau/parameters/` too. */
  risposte: z.record(z.string(), valoreSchema),
  /** Whether the designer gave a known measure at the scale chip. */
  scalaData: z.boolean(),
  /** The `main.ts` written last, so a regeneration never overwrites the designer's or the agent's edits. */
  mainScritto: z.string(),
  verifica: verificaSchema,
  cronologia: z
    .array(z.object({ quando: z.string(), iou: z.number().nullable(), parametri: z.record(z.string(), valoreSchema) }))
    .max(50),
});

/** The recognition's record. */
export type RecordRiconoscimento = z.infer<typeof recordRiconoscimentoSchema>;

/** Reading a record: present and current, absent, unreadable, or written by a newer build (left untouched). */
export type LetturaRecord =
  | Readonly<{ stato: 'ok'; record: RecordRiconoscimento }>
  | Readonly<{ stato: 'assente' }>
  | Readonly<{ stato: 'non_valido' }>
  | Readonly<{ stato: 'piu_recente'; version: number }>;

/**
 * Bring an older record up to this version. The draft before versions (no `version`, no `risposte`) becomes version 1.
 *
 * @param grezzo - The parsed JSON.
 * @returns The record shape of this version, or the input when it is not a known older shape.
 */
export function aggiornaRecord(grezzo: unknown): unknown {
  if (typeof grezzo !== 'object' || grezzo === null || Array.isArray(grezzo)) {
    return grezzo;
  }
  const record = completaFaccia(grezzo as Record<string, unknown>);
  if (record['version'] !== undefined) {
    return record;
  }
  return {
    version: 1,
    creato: typeof record['creato'] === 'string' ? record['creato'] : new Date(0).toISOString(),
    risposte: {},
    scalaData: false,
    mainScritto: '',
    verifica: { stato: 'non_disponibile', motivo: 'modulo_assente' },
    cronologia: [],
    ...record,
  };
}

/**
 * Records written before the sheet named the face (`vista.faccia`): the face comes from the view name of the family
 * built, and its angles (absolute then, offsets now) are replaced by the name's offsets.
 *
 * @param record - The parsed record.
 * @returns The record with the face, or the input when it has one or cannot be completed.
 */
function completaFaccia(record: Record<string, unknown>): Record<string, unknown> {
  const scheda: unknown = record['scheda'];
  const famiglia: unknown = record['famiglia'];
  if (typeof scheda !== 'object' || scheda === null || typeof famiglia !== 'object' || famiglia === null) {
    return record;
  }
  const vista: unknown = Reflect.get(scheda, 'vista');
  if (typeof vista !== 'object' || vista === null || Reflect.get(vista, 'faccia') !== undefined) {
    return record;
  }
  const id: unknown = Reflect.get(famiglia, 'id');
  const viste = typeof id === 'string' ? famiglie[id as IdFamiglia]?.viste : undefined;
  const nome: unknown = Reflect.get(vista, 'nome');
  const completa = viste
    ? vistaSenzaFaccia(viste, typeof nome === 'string' ? nome : undefined)
    : { faccia: 'sopra', azimuth: 0, elevation: 0 };
  return { ...record, scheda: { ...scheda, vista: { ...vista, ...completa } } };
}

/**
 * Read the record's bytes.
 *
 * @param bytes - The file, or undefined when it does not exist.
 * @returns The reading.
 */
export function leggiRecordRiconoscimento(bytes: Uint8Array<ArrayBuffer> | string | undefined): LetturaRecord {
  if (bytes === undefined) {
    return { stato: 'assente' };
  }
  let grezzo: unknown;
  try {
    grezzo = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
  } catch {
    return { stato: 'non_valido' };
  }
  const version: unknown = typeof grezzo === 'object' && grezzo !== null ? Reflect.get(grezzo, 'version') : undefined;
  if (typeof version === 'number' && version > versioneRecord) {
    return { stato: 'piu_recente', version };
  }
  const letto = recordRiconoscimentoSchema.safeParse(aggiornaRecord(grezzo));
  return letto.success ? { stato: 'ok', record: letto.data } : { stato: 'non_valido' };
}

/**
 * The record's text: checked against the schema, two-space JSON with a final newline.
 *
 * @param record - The record.
 * @returns The file's text.
 */
export const serializzaRecordRiconoscimento = (record: RecordRiconoscimento): string =>
  `${JSON.stringify(recordRiconoscimentoSchema.parse(record), null, 2)}\n`;
