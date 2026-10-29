import { createActor, createAsyncLogic } from 'xstate';
import { catalogoFamiglie, schedaConsegnata, schedaRiconoscimentoSchema } from '@taucad/smlib/riconoscimento';
import type { SchedaRiconoscimento } from '@taucad/smlib/riconoscimento';
import {
  chiaviDelControllo,
  consegnaVerifica,
  richiestaDiConfronto,
  richiestaGirata,
  risultatoConfronti,
  rolliDaProvare,
} from '@taucad/smlib/verifica';
import type {
  Consegna,
  RispostaVerifica,
  RisultatoConfronti,
  SchedaPerVerifica,
  Verificatore,
} from '@taucad/smlib/verifica';
import { riconoscimentoMachine } from '#machines/riconoscimento.machine.js';
import type {
  IngressoConfronta,
  IngressoRiconosci,
  IngressoRientro,
  IngressoVerifica,
  VisteVerifica,
} from '#machines/riconoscimento.machine.js';
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
  /**
   * The piece matches (or is kept with a warning): the sheet with the optimised parameters, and the check. With the
   * generated views, `confronti` says whether the reconstruction matches the photo and which measures were used.
   */
  | Readonly<{
      tipo: 'consegna';
      scheda: SchedaRiconoscimento;
      consegna: Consegna;
      verifica: VerificaFatta;
      confronti?: RisultatoConfronti;
    }>
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
  /** Le maschere delle viste generate: la verifica lavora sulla principale e confronta controllo e foto. */
  viste?: VisteVerifica;
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
 * Una verifica su una vista generata che parte dal rollo che la spiega meglio: con più rolli, prima una sonda per
 * ciascuno (solo la fase A: una costruzione e proiezioni), poi la verifica piena dal migliore.
 *
 * @param verificatore - Il worker della verifica.
 * @param ingresso - La richiesta e i rolli da sondare.
 * @param signal - Il segnale dell'attore.
 * @returns La verifica piena.
 */
export async function verificaConRolli(
  verificatore: Verificatore,
  ingresso: IngressoVerifica,
  signal: AbortSignal,
): Promise<RispostaVerifica> {
  const rolli = ingresso.rolli ?? [0];
  if (rolli.length <= 1) {
    return verificatore.verifica(ingresso.richiesta, { signal });
  }
  let migliore = { rollo: rolli[0]!, iou: -1 };
  for (const rollo of rolli) {
    // oxlint-disable-next-line no-await-in-loop -- one worker: the probes run one after the other anyway.
    const sonda = await verificatore.verifica(richiestaGirata(ingresso.richiesta, rollo, true), { signal });
    if (sonda.iou > migliore.iou) {
      migliore = { rollo, iou: sonda.iou };
    }
  }
  return verificatore.verifica(richiestaGirata(ingresso.richiesta, migliore.rollo, false), { signal });
}

/** Millisecondi: il tempo massimo del confronto con il controllo (un giro di fase B sui parametri non visti). */
const tempoControllo = 15_000;

/**
 * I confronti sulle tre immagini (§2.5): il controllo con i parametri che la principale non vede liberi, poi la foto a
 * parametri fermi con le misure della principale e, se il controllo ne ha date, con quelle. Tutte con lo stesso
 * segnale: lasciare `confrontando` ferma il worker.
 *
 * @param verificatore - Il worker della verifica.
 * @param ingresso - La verifica sulla principale, le viste e la maschera della foto.
 * @param signal - Il segnale dell'attore.
 * @returns Il risultato dei confronti.
 */
export async function confrontaViste(
  verificatore: Verificatore,
  ingresso: IngressoConfronta,
  signal: AbortSignal,
): Promise<RisultatoConfronti> {
  const { principale, viste, scheda, maschera } = ingresso;
  const liberi = chiaviDelControllo(principale);
  const richiestaControllo = viste.controllo
    ? richiestaDiConfronto(principale, viste.controllo.png, {
        tipo: 'controllo',
        faccia: viste.controllo.faccia,
        liberi,
        tempoMassimo: tempoControllo,
      })
    : undefined;
  const controllo = richiestaControllo
    ? await verificaConRolli(
        verificatore,
        {
          richiesta: richiestaControllo,
          rolli: rolliDaProvare(principale.famiglia, viste.controllo!.faccia),
        },
        signal,
      )
    : undefined;
  const sullaFoto = async (pezzo: RispostaVerifica): Promise<RispostaVerifica | undefined> => {
    const richiesta = richiestaDiConfronto(pezzo, maschera, { tipo: 'sorgente', scheda });
    return richiesta ? verificatore.verifica(richiesta, { signal }) : undefined;
  };
  const sorgentePrincipale = await sullaFoto(principale);
  const sorgenteControllo = controllo && liberi.length > 0 ? await sullaFoto(controllo) : undefined;
  return risultatoConfronti(
    {
      principale,
      ...(controllo ? { controllo, liberi } : {}),
      ...(sorgentePrincipale ? { sorgentePrincipale } : {}),
      ...(sorgenteControllo ? { sorgenteControllo } : {}),
    },
    viste.visibilita,
  );
}

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
      verifica: createAsyncLogic<RispostaVerifica, IngressoVerifica>({
        run: async ({ input, signal }) => verificaConRolli(ingresso.verificatore, input, signal),
      }),
      confronta: createAsyncLogic<RisultatoConfronti, IngressoConfronta>({
        run: async ({ input, signal }) => confrontaViste(ingresso.verificatore, input, signal),
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
      ...(ingresso.viste ? { viste: ingresso.viste } : {}),
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
      origine: Readonly<{ scheda: SchedaPerVerifica | undefined; rientri: number; confronti?: RisultatoConfronti }>,
    ): EsitoPipeline => {
      const { scheda: schedaDiPartenza, rientri, confronti } = origine;
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
        ...(confronti ? { confronti } : {}),
      };
    };
    attore.subscribe((istantanea) => {
      const { context } = istantanea;
      if (istantanea.matches('consegnato') && context.consegna && context.rispostaConsegnata) {
        concludi(
          consegna(context.consegna, context.rispostaConsegnata, {
            scheda: context.schedaConsegnata,
            rientri: context.rientri,
            ...(context.confronti ? { confronti: context.confronti } : {}),
          }),
        );
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
            ? consegna(consegnaVerifica(migliore.scheda, migliore.risposta, 'avviso'), migliore.risposta, {
                scheda: migliore.scheda,
                rientri: context.rientri,
              })
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
