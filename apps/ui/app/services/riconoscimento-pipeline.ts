import { createActor, createAsyncLogic } from 'xstate';
import { catalogoFamiglie, schedaConsegnata, schedaRiconoscimentoSchema } from '@taucad/smlib/riconoscimento';
import type { SchedaRiconoscimento } from '@taucad/smlib/riconoscimento';
import { consegnaVerifica } from '@taucad/smlib/verifica';
import type {
  Consegna,
  RichiestaVerifica,
  RispostaVerifica,
  SchedaPerVerifica,
  Verificatore,
} from '@taucad/smlib/verifica';
import { riconoscimentoMachine } from '#machines/riconoscimento.machine.js';
import type { IngressoRiconosci, IngressoRientro } from '#machines/riconoscimento.machine.js';
import type { RecordRiconoscimento } from '#services/riconoscimento-record.js';

/**
 * The photo → piece pipeline run to its end (SinopiaCAD D2 + D3, specification §3.5): the recognition sheet in, the
 * silhouette check against the mask, the model asked again once with the difference picture if the match is poor, and
 * the best of the two rounds out. The states and the thresholds are `riconoscimentoMachine`'s; this wires its three
 * actors to the real clients and reads the result.
 *
 * Stopping (`segnale`) leaves the machine, which stops the check's actor: its signal terminates the worker.
 */

/** The result of a check, ready for the project record. */
export type VerificaFatta = Extract<RecordRiconoscimento['verifica'], { stato: 'fatta' }>;

/** How the pipeline ended. */
export type EsitoPipeline =
  /** The piece matches (or is kept with a warning): the sheet with the optimised parameters, and the check. */
  | Readonly<{ tipo: 'consegna'; scheda: SchedaRiconoscimento; consegna: Consegna; verifica: VerificaFatta }>
  /** The recogniser now says the part is free-form or cannot be modelled (after the second round). */
  | Readonly<{ tipo: 'libero'; scheda: SchedaRiconoscimento }>
  /** Stopped by the designer: nothing was checked. */
  | Readonly<{ tipo: 'fermata' }>
  /** The check failed (worker, kernel): the piece is built from the recognition, unchecked. */
  | Readonly<{ tipo: 'errore'; messaggio: string }>;

/** What the pipeline needs. */
export type IngressoPipeline = Readonly<{
  /** The recognition sheet (after the family chip: the family already chosen). */
  scheda: SchedaRiconoscimento;
  /** The mask PNG of the part (white = part). */
  maschera: Uint8Array<ArrayBuffer>;
  progettoId: string;
  parteId: string;
  verificatore: Verificatore;
  /** The second call to the recogniser with the difference picture (D2 `rientro`). */
  rientro: (
    ingresso: Readonly<{ scheda: SchedaRiconoscimento; differenzaPng: Uint8Array; testo: string; iou: number }>,
  ) => Promise<SchedaRiconoscimento>;
  /** Keys the designer fixed: the optimiser leaves them alone. */
  bloccati?: readonly string[];
  budgetMs?: number;
  lingua: 'it' | 'en';
  segnale: AbortSignal;
}>;

const comeScheda = (candidata: SchedaPerVerifica | undefined, ripiego: SchedaRiconoscimento): SchedaRiconoscimento => {
  const letta = schedaRiconoscimentoSchema.safeParse(candidata);
  return letta.success ? letta.data : ripiego;
};

/**
 * The record's check from a delivery.
 *
 * @param consegna - The delivery.
 * @param risposta - The check it comes from.
 * @param rientri - How many times the model was asked again.
 * @returns The check as the project record keeps it.
 */
export const verificaDaConsegna = (consegna: Consegna, risposta: RispostaVerifica, rientri: number): VerificaFatta => ({
  stato: 'fatta',
  iou: consegna.iou,
  camera: { ...risposta.camera },
  esito: consegna.esito === 'avviso' ? 'avviso' : consegna.esito === 'riserva' ? 'riserva' : 'accettato',
  nonOsservabili: consegna.nonOsservabili,
  suggerimenti: consegna.suggerimenti,
  rientri,
});

/**
 * Run the pipeline.
 *
 * @param ingresso - The sheet, the mask, the clients and the signal.
 * @returns How it ended; never throws for a failed check (the piece is then built from the recognition).
 */
export async function eseguiPipelineRiconoscimento(ingresso: IngressoPipeline): Promise<EsitoPipeline> {
  const catalogo = catalogoFamiglie();
  const macchina = riconoscimentoMachine.provide({
    actors: {
      // The first recognition was already made (the family question may sit between it and the check): the machine
      // starts from its sheet.
      riconosci: createAsyncLogic<SchedaPerVerifica, IngressoRiconosci>({
        run: async () => ingresso.scheda as SchedaPerVerifica,
      }),
      verifica: createAsyncLogic<RispostaVerifica, { richiesta: RichiestaVerifica }>({
        run: async ({ input, signal }) => ingresso.verificatore.verifica(input.richiesta, { signal }),
      }),
      rientro: createAsyncLogic<SchedaPerVerifica, IngressoRientro>({
        run: async ({ input }) =>
          (await ingresso.rientro({
            scheda: comeScheda(input.scheda, ingresso.scheda),
            differenzaPng: input.differenzaPng,
            testo: input.testo,
            iou: input.iou,
          })) as SchedaPerVerifica,
      }),
    },
  });
  const attore = createActor(macchina, {
    input: {
      progettoId: ingresso.progettoId,
      parteId: ingresso.parteId,
      maschera: ingresso.maschera,
      ...(ingresso.budgetMs === undefined ? {} : { budgetMs: ingresso.budgetMs }),
      ...(ingresso.bloccati ? { bloccati: ingresso.bloccati } : {}),
    },
  });
  return new Promise<EsitoPipeline>((resolve) => {
    let concluso = false;
    const concludi = (esito: EsitoPipeline): void => {
      if (concluso) {
        return;
      }
      concluso = true;
      ingresso.segnale.removeEventListener('abort', ferma);
      attore.stop();
      resolve(esito);
    };
    const ferma = (): void => {
      // `annulla` leaves the checking state: the actor's signal aborts and the worker is terminated.
      attore.send({ type: 'annulla' });
      concludi({ tipo: 'fermata' });
    };
    const consegna = (
      consegnaFatta: Consegna,
      risposta: RispostaVerifica,
      schedaDiPartenza: SchedaPerVerifica | undefined,
      rientri: number,
    ): EsitoPipeline => {
      const completa = comeScheda(schedaDiPartenza, ingresso.scheda);
      const famiglia = catalogo.find((voce) => voce.id === consegnaFatta.famiglia);
      return {
        tipo: 'consegna',
        scheda: schedaConsegnata(completa, consegnaFatta, {
          lingua: ingresso.lingua,
          ...(famiglia ? { catalogo: famiglia } : {}),
        }),
        consegna: consegnaFatta,
        verifica: verificaDaConsegna(consegnaFatta, risposta, rientri),
      };
    };
    attore.subscribe((istantanea) => {
      const { context } = istantanea;
      if (istantanea.matches('consegnato') && context.consegna && context.rispostaConsegnata) {
        concludi(consegna(context.consegna, context.rispostaConsegnata, context.schedaConsegnata, context.rientri));
      } else if (istantanea.matches('pezzoLibero')) {
        concludi({ tipo: 'libero', scheda: comeScheda(context.scheda, ingresso.scheda) });
      } else if (istantanea.matches('annullato')) {
        concludi({ tipo: 'fermata' });
      } else if (istantanea.matches('errore')) {
        // The second round failed (the function does not answer, no network) but the first check is good: keep it with
        // the warning rather than lose it.
        const { migliore } = context;
        concludi(
          migliore
            ? consegna(
                consegnaVerifica(migliore.scheda, migliore.risposta, 'avviso'),
                migliore.risposta,
                migliore.scheda,
                context.rientri,
              )
            : { tipo: 'errore', messaggio: context.errore ?? 'La verifica non è riuscita.' },
        );
      }
    });
    if (ingresso.segnale.aborted) {
      concludi({ tipo: 'fermata' });
      return;
    }
    ingresso.segnale.addEventListener('abort', ferma, { once: true });
    attore.start();
    attore.send({ type: 'avvia' });
  });
}
