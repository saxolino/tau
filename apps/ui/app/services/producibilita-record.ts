/* eslint-disable @typescript-eslint/naming-convention -- process keys are the engine's snake_case ids. */
import { z } from 'zod';
import type { Processo } from '@taucad/smlib/famiglie';
import type { ControlloProducibilita } from '@taucad/smlib/producibilita';

/**
 * The producibility record of a project (E1): `.tau/workbench/producibilita.json`, with the process picked per piece,
 * the pull direction and the register of exports done with blocks open («Esporta comunque») or turned back to fix
 * («Correggi»). Workbench records admit `version` (the `wr-version` exception of the parameter-record policy).
 */

/** Where the record lives, relative to the project root. */
export const percorsoProducibilita = '.tau/workbench/producibilita.json';

/** The record version this build writes. */
export const versioneProducibilita = 1;

/** Entries of the register kept in the file: the latest ones. */
const voci = 50;

const processoSchema = z.enum([
  'fusione_cera_persa',
  'pressofusione_zama',
  'stampaggio_iniezione',
  'tranciatura_lamiera',
  'cnc',
  'stampa_3d_resina',
  'stampa_3d_metallo',
  'taglio_cuoio',
]) satisfies z.ZodType<Processo>;

const bloccoSchema = z.object({
  codice: z.string(),
  pezzo: z.string().optional(),
  valore: z.number().optional(),
  soglia: z.number().optional(),
  messaggio: z.string(),
});

const sceltaSchema = z.object({
  quando: z.string(),
  scelta: z.enum(['correggi', 'esporta_comunque']),
  processi: z.record(z.string(), processoSchema),
  blocchi: z.array(bloccoSchema),
});

/** Schema of the record, version 1. */
export const recordProducibilitaSchema = z.object({
  version: z.literal(versioneProducibilita),
  processi: z.record(z.string(), processoSchema),
  direzione: z.enum(['z', 'x', 'y']),
  registro: z.array(sceltaSchema),
});

/** The record. */
export type RecordProducibilita = z.infer<typeof recordProducibilitaSchema>;

/** One choice in front of the soft block of Esporta. */
export type SceltaEsportazione = z.infer<typeof sceltaSchema>['scelta'];

/** An empty record. */
export const recordVuoto = (): RecordProducibilita => ({
  version: versioneProducibilita,
  processi: {},
  direzione: 'z',
  registro: [],
});

/**
 * Read a record's bytes; an absent or unreadable record is an empty one (it is rewritten whole on the next change).
 *
 * @param bytes - The file's bytes, or undefined when it does not exist.
 * @returns The record.
 */
export function leggiRecordProducibilita(bytes: Uint8Array<ArrayBuffer> | undefined): RecordProducibilita {
  if (!bytes) {
    return recordVuoto();
  }
  try {
    const parsed = recordProducibilitaSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : recordVuoto();
  } catch {
    return recordVuoto();
  }
}

/**
 * The record's text, stable and validated.
 *
 * @param record - The record.
 * @returns JSON with a trailing newline.
 */
export const serializzaRecordProducibilita = (record: RecordProducibilita): string =>
  `${JSON.stringify(recordProducibilitaSchema.parse(record), null, 2)}\n`;

/**
 * Add one choice to the register, keeping the latest entries.
 *
 * @param record - The record.
 * @param input - The choice, the processes it was made under, the blocks it was made in front of, and when.
 * @returns The new record.
 */
export function aggiungiScelta(
  record: RecordProducibilita,
  {
    scelta,
    processi,
    blocchi,
    quando,
  }: Readonly<{
    scelta: SceltaEsportazione;
    processi: Readonly<Record<string, Processo>>;
    blocchi: readonly ControlloProducibilita[];
    quando: Date;
  }>,
): RecordProducibilita {
  const voce = {
    quando: quando.toISOString(),
    scelta,
    processi: { ...processi },
    blocchi: blocchi.map(({ codice, pezzo, valore, soglia, messaggio }) => ({
      codice,
      ...(pezzo === undefined ? {} : { pezzo }),
      ...(valore === undefined || !Number.isFinite(valore) ? {} : { valore }),
      ...(soglia === undefined ? {} : { soglia }),
      messaggio,
    })),
  };
  return { ...record, registro: [...record.registro, voce].slice(-voci) };
}
