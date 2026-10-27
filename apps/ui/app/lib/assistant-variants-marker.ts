import { z } from 'zod';

/**
 * The agent's own variants in a chat answer (SinopiaCAD D5): a fenced block with the language `sinopia-varianti` and
 * a JSON body. The chat shows it as the variants card instead of code; the CAD evaluates the sets in its worker, inside
 * the family's limits, and never applies them without the designer's «Usa questa». The skill
 * `sinopia-varianti` teaches the agent the format.
 *
 * ```sinopia-varianti
 * { "famiglia": "fibbia", "insiemi": [{ "titolo": "Più leggera", "motivo": "…", "parametri": { "telaio": { … } } }] }
 * ```
 */

/** The fence's language. */
export const linguaggioVarianti = 'sinopia-varianti';

const insiemeSchema = z.object({
  titolo: z.string().trim().min(1).max(40),
  motivo: z.string().trim().max(160).optional(),
  parametri: z.record(z.string(), z.unknown()),
});

/** The block's JSON: the family it was written for, and two or three sets of parameters. */
export const bloccoVariantiSchema = z.object({
  famiglia: z.string().optional(),
  insiemi: z.array(insiemeSchema).min(1).max(3),
});

/** A set of parameters the agent proposes. */
export type InsiemeAgente = z.infer<typeof insiemeSchema>;

/** A block while the answer streams, unreadable, or ready. */
export type BloccoVarianti =
  | Readonly<{ stato: 'in_corso' }>
  | Readonly<{ stato: 'non_valido' }>
  | Readonly<{ stato: 'pronto'; famiglia?: string; insiemi: readonly InsiemeAgente[] }>;

/** A piece of an answer: markdown, or a variants block. */
export type ParteRisposta =
  | Readonly<{ tipo: 'testo'; testo: string }>
  | Readonly<{ tipo: 'varianti'; blocco: BloccoVarianti }>;

const apertura = /```sinopia-varianti[^\S\n]*\n/gu;

const leggiBlocco = (corpo: string): BloccoVarianti => {
  try {
    const letto = bloccoVariantiSchema.safeParse(JSON.parse(corpo));
    return letto.success
      ? {
          stato: 'pronto',
          ...(letto.data.famiglia === undefined ? {} : { famiglia: letto.data.famiglia }),
          insiemi: letto.data.insiemi,
        }
      : { stato: 'non_valido' };
  } catch {
    return { stato: 'non_valido' };
  }
};

/**
 * Split an answer into its markdown and its variants blocks. A block still open (the answer is streaming) is
 * `in_corso`; one whose JSON does not read is `non_valido`.
 *
 * @param testo - The answer's text.
 * @returns The pieces in order; one text piece when there is no block.
 */
export function separaVarianti(testo: string): ParteRisposta[] {
  const parti: ParteRisposta[] = [];
  let posizione = 0;
  apertura.lastIndex = 0;
  for (let trovata = apertura.exec(testo); trovata !== null; trovata = apertura.exec(testo)) {
    const prima = testo.slice(posizione, trovata.index);
    if (prima.trim() !== '') {
      parti.push({ tipo: 'testo', testo: prima });
    }
    const inizioCorpo = trovata.index + trovata[0].length;
    const chiusura = testo.indexOf('\n```', inizioCorpo - 1);
    if (chiusura === -1) {
      parti.push({ tipo: 'varianti', blocco: { stato: 'in_corso' } });
      return parti;
    }
    parti.push({ tipo: 'varianti', blocco: leggiBlocco(testo.slice(inizioCorpo, chiusura)) });
    posizione = chiusura + '\n```'.length;
    apertura.lastIndex = posizione;
  }
  const resto = testo.slice(posizione);
  if (resto.trim() !== '' || parti.length === 0) {
    parti.push({ tipo: 'testo', testo: resto });
  }
  return parti;
}

/**
 * The answer without its variants blocks, for the one-line summary under the inspector.
 *
 * @param testo - The answer's text.
 * @returns The prose alone.
 */
export function senzaVarianti(testo: string): string {
  return separaVarianti(testo)
    .flatMap((parte) => (parte.tipo === 'testo' ? [parte.testo] : []))
    .join(' ');
}
