import { createAsyncLogic, setup, types } from 'xstate';
import {
  BUDGET_DOPO_RIENTRO_MS,
  consegnaVerifica,
  esitoDaIou,
  richiestaDaScheda,
  TESTO_RIENTRO,
} from '@taucad/smlib/verifica';
import type { Consegna, RichiestaVerifica, RispostaVerifica, SchedaPerVerifica } from '@taucad/smlib/verifica';
import { eventSchemas } from '#lib/xstate.lib.js';

/**
 * Pipeline «foto → pezzo» del CAD (specifica D3 §3.5, task T-D3-06):
 *
 *   inattivo → riconoscendo → verificando ─┬─ IoU ≥ 0,92 ───────────────→ consegnato (accettato)
 *                    │                     ├─ 0,85–0,92 ────────────────→ consegnato (riserva)
 *                    │                     └─ < 0,85 → rientrando → verificando (30 s) → consegnato (avviso se ancora < 0,85)
 *                    └─ famiglia libero / non_modellabile → pezzoLibero
 *
 * I tre attori sono iniettati alla radice di composizione con `.provide({ actors })`: `riconosci` e `rientro` sono la
 * chiamata al classificatore (D2, `/v1/recognize`), `verifica` è il worker della verifica D3
 * (`creaVerificatore` di `@taucad/smlib/verifica`). Il segnale dell'attore arriva fino al worker: lasciare lo stato
 * (annulla) lo termina. Nessun I/O qui dentro; il rientro si fa una volta sola e si consegna il migliore dei due giri.
 */

export type RiconoscimentoInput = {
  progettoId: string;
  parteId: string;
  /** PNG della maschera della parte (SAM o alfa). */
  maschera: Uint8Array<ArrayBuffer>;
  /** Budget della prima verifica in ms (predefinito quello dell'ottimizzatore, 45 s). */
  budgetMs?: number;
  /** Chiavi fissate dall'utente: l'ottimizzatore non le muove. */
  bloccati?: readonly string[];
};

/** Ingresso dell'attore `riconosci` (D2). */
export type IngressoRiconosci = Pick<RiconoscimentoInput, 'progettoId' | 'parteId' | 'maschera'>;

/** Ingresso dell'attore `rientro` (D2 con l'immagine differenza). */
export type IngressoRientro = IngressoRiconosci & {
  scheda: SchedaPerVerifica;
  differenzaPng: Uint8Array;
  testo: string;
  iou: number;
};

type RiconoscimentoContext = {
  progettoId: string;
  parteId: string;
  maschera: Uint8Array<ArrayBuffer>;
  budgetMs: number | undefined;
  bloccati: readonly string[];
  scheda: SchedaPerVerifica | undefined;
  /** Ultima verifica e la migliore finora, con la scheda che l'ha prodotta. */
  ultima: RispostaVerifica | undefined;
  migliore: { risposta: RispostaVerifica; scheda: SchedaPerVerifica } | undefined;
  rientri: number;
  consegna: Consegna | undefined;
  /** La scheda e la risposta da cui nasce la consegna (la migliore dei due giri se c'è l'avviso). */
  schedaConsegnata: SchedaPerVerifica | undefined;
  rispostaConsegnata: RispostaVerifica | undefined;
  errore: string | undefined;
};

export type RiconoscimentoEvent = { type: 'avvia' } | { type: 'riprova' } | { type: 'annulla' };

const nonFornito = (nome: string) => async (): Promise<never> => {
  throw new Error(`Attore «${nome}» non fornito: passarlo con riconoscimentoMachine.provide({ actors: { ${nome} } }).`);
};

const messaggio = (errore: unknown): string => (errore instanceof Error ? errore.message : String(errore));

const verificabile = (scheda: SchedaPerVerifica | undefined): boolean =>
  scheda !== undefined && scheda.famiglia.id !== 'libero' && scheda.famiglia.id !== 'non_modellabile';

export const riconoscimentoMachine = setup({
  schemas: {
    input: types<RiconoscimentoInput>(),
    context: types<RiconoscimentoContext>(),
    events: eventSchemas<RiconoscimentoEvent>(),
  },
  actors: {
    riconosci: createAsyncLogic<SchedaPerVerifica, IngressoRiconosci>({ run: nonFornito('riconosci') }),
    verifica: createAsyncLogic<RispostaVerifica, { richiesta: RichiestaVerifica }>({ run: nonFornito('verifica') }),
    rientro: createAsyncLogic<SchedaPerVerifica, IngressoRientro>({ run: nonFornito('rientro') }),
  },
}).createMachine({
  id: 'riconoscimento',
  context: ({ input }) => ({
    progettoId: input.progettoId,
    parteId: input.parteId,
    maschera: input.maschera,
    budgetMs: input.budgetMs,
    bloccati: input.bloccati ?? [],
    scheda: undefined,
    ultima: undefined,
    migliore: undefined,
    rientri: 0,
    consegna: undefined,
    schedaConsegnata: undefined,
    rispostaConsegnata: undefined,
    errore: undefined,
  }),
  initial: 'inattivo',
  on: {
    annulla: { target: '.annullato' },
  },
  states: {
    inattivo: {
      on: { avvia: { target: 'riconoscendo' } },
    },
    riconoscendo: {
      invoke: {
        src: 'riconosci',
        input: ({ context }) => ({
          progettoId: context.progettoId,
          parteId: context.parteId,
          maschera: context.maschera,
        }),
        onDone: ({ event }) =>
          verificabile(event.output)
            ? { target: 'verificando', context: { scheda: event.output } }
            : { target: 'pezzoLibero', context: { scheda: event.output } },
        onError: ({ event }) => ({ target: 'errore', context: { errore: messaggio(event.error) } }),
      },
    },
    verificando: {
      invoke: {
        src: 'verifica',
        input: ({ context }) => ({
          richiesta: richiestaDaScheda(
            context.scheda!,
            context.maschera,
            {
              ...(context.rientri > 0
                ? { budgetMs: BUDGET_DOPO_RIENTRO_MS }
                : context.budgetMs === undefined
                  ? {}
                  : { budgetMs: context.budgetMs }),
            },
            context.bloccati,
          )!,
        }),
        onDone: ({ context, event }) => {
          const risposta = event.output;
          const migliore =
            context.migliore && context.migliore.risposta.iou >= risposta.iou
              ? context.migliore
              : { risposta, scheda: context.scheda! };
          const esito = esitoDaIou(risposta.iou, context.rientri);
          if (esito === 'rientro') {
            return { target: 'rientrando', context: { ultima: risposta, migliore } };
          }
          // Accettato o riserva valgono per quest'ultima verifica; con l'avviso si consegna il migliore dei due giri.
          const scelta = esito === 'avviso' ? migliore : { risposta, scheda: context.scheda! };
          return {
            target: 'consegnato',
            context: {
              ultima: risposta,
              migliore,
              consegna: consegnaVerifica(scelta.scheda, scelta.risposta, esito),
              schedaConsegnata: scelta.scheda,
              rispostaConsegnata: scelta.risposta,
            },
          };
        },
        onError: ({ event }) => ({ target: 'errore', context: { errore: messaggio(event.error) } }),
      },
    },
    rientrando: {
      invoke: {
        src: 'rientro',
        input: ({ context }) => ({
          progettoId: context.progettoId,
          parteId: context.parteId,
          maschera: context.maschera,
          scheda: context.scheda!,
          differenzaPng: context.ultima!.differenzaPng,
          testo: TESTO_RIENTRO,
          iou: context.ultima!.iou,
        }),
        onDone: ({ context, event }) =>
          verificabile(event.output)
            ? { target: 'verificando', context: { scheda: event.output, rientri: context.rientri + 1 } }
            : { target: 'pezzoLibero', context: { scheda: event.output, rientri: context.rientri + 1 } },
        onError: ({ event }) => ({ target: 'errore', context: { errore: messaggio(event.error) } }),
      },
    },
    consegnato: { type: 'final' },
    pezzoLibero: { type: 'final' },
    annullato: { type: 'final' },
    errore: {
      on: {
        riprova: ({ context }) => ({
          target: context.scheda && verificabile(context.scheda) ? 'verificando' : 'riconoscendo',
          context: { errore: undefined },
        }),
      },
    },
  },
});
