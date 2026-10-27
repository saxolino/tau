import { z } from 'zod';
import { schedaParteSchema, schedaRiconoscimentoSchema } from '@taucad/smlib/riconoscimento';

/**
 * The recognition's record in the project (SinopiaCAD D2 §2.7, T-D2-07): `.tau/workbench/riconoscimento.json`, with
 * the part sheet, the recognition sheet, the designer's answers to the chips and the D3 verification. Workbench
 * records admit `version` (the `wr-version` exception of the parameter-record policy); the values the designer fixes
 * live in `.tau/parameters/`, not here: this file only remembers which questions were answered.
 */

/** Where the record lives, relative to the project root. */
export const percorsoRiconoscimento = '.tau/workbench/riconoscimento.json';

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
  const record = grezzo as Record<string, unknown>;
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
