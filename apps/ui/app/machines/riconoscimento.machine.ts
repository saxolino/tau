import { createAsyncLogic, setup, types } from 'xstate';
import {
  BUDGET_DOPO_RIENTRO_MS,
  consegnaVerifica,
  esitoDaIou,
  richiestaDaScheda,
  richiestaDaVistaGenerata,
  rolliDaProvare,
  TESTO_RIENTRO,
} from '@taucad/smlib/verifica';
import type {
  Consegna,
  EsitoSoglia,
  RichiestaVerifica,
  RispostaVerifica,
  RisultatoConfronti,
  SchedaPerVerifica,
} from '@taucad/smlib/verifica';
import { eventSchemas } from '#lib/xstate.lib.js';

/**
 * Pipeline «foto → pezzo» del CAD (specifica D3 §3.5, task T-D3-06):
 *
 *   inattivo → riconoscendo → verificando ─┬─ IoU ≥ 0,92 ───────────────→ consegnato (accettato)
 *                    │                     ├─ 0,85–0,92 ────────────────→ consegnato (riserva)
 *                    │                     └─ < 0,85 → rientrando → verificando (30 s) → consegnato (avviso se ancora < 0,85)
 *                    └─ famiglia libero / non_modellabile → pezzoLibero
 *
 * Con le viste generate (piano «viste ortogonali», §2.5) la verifica lavora sulla vista principale (camera dalla sua
 * faccia, scala libera, ancora ferma) e, prima della consegna, lo stato `confrontando` confronta il pezzo con la vista
 * di controllo e con la foto (attore `confronta`, iniettato come gli altri): il verdetto e le misure scelte entrano
 * nella consegna. Senza viste, o se la famiglia costruita non ha la faccia della principale, tutto come prima.
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
  /** Le viste generate con le loro maschere: la verifica lavora sulla principale e confronta controllo e foto. */
  viste?: VisteVerifica;
};

/** Le maschere delle viste generate, con la faccia che guardano, e la visibilità della parte nella foto. */
export type VisteVerifica = {
  principale: { png: Uint8Array<ArrayBuffer>; faccia: string };
  controllo?: { png: Uint8Array<ArrayBuffer>; faccia: string };
  /** `parziale`: la parte è tagliata, piccola o coperta nella foto, che allora non decide. */
  visibilita: 'intera' | 'parziale';
};

/** Ingresso dell'attore `confronta`: la verifica sulla principale da confrontare con il controllo e con la foto. */
export type IngressoConfronta = {
  scheda: SchedaPerVerifica;
  principale: RispostaVerifica;
  viste: VisteVerifica;
  /** La maschera della foto. */
  maschera: Uint8Array<ArrayBuffer>;
};

/**
 * Ingresso dell'attore `verifica`: la richiesta e, sulla vista generata, i rolli di partenza da sondare (un pezzo
 * piatto può arrivare girato nel piano).
 */
export type IngressoVerifica = { richiesta: RichiestaVerifica; rolli?: readonly number[] };

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
  viste: VisteVerifica | undefined;
  scheda: SchedaPerVerifica | undefined;
  /** Ultima verifica e la migliore finora, con la scheda che l'ha prodotta. */
  ultima: RispostaVerifica | undefined;
  migliore: { risposta: RispostaVerifica; scheda: SchedaPerVerifica } | undefined;
  rientri: number;
  consegna: Consegna | undefined;
  /** La scheda e la risposta da cui nasce la consegna (la migliore dei due giri se c'è l'avviso). */
  schedaConsegnata: SchedaPerVerifica | undefined;
  rispostaConsegnata: RispostaVerifica | undefined;
  /** L'esito della soglia della verifica consegnata, per rifare la consegna dopo i confronti. */
  esitoVerifica: Exclude<EsitoSoglia, 'rientro'> | undefined;
  confronti: RisultatoConfronti | undefined;
  errore: string | undefined;
};

export type RiconoscimentoEvent = { type: 'avvia' } | { type: 'riprova' } | { type: 'annulla' };

const nonFornito = (nome: string) => async (): Promise<never> => {
  throw new Error(`Attore «${nome}» non fornito: passarlo con riconoscimentoMachine.provide({ actors: { ${nome} } }).`);
};

const messaggio = (errore: unknown): string => (errore instanceof Error ? errore.message : String(errore));

const verificabile = (scheda: SchedaPerVerifica | undefined): boolean =>
  scheda !== undefined && scheda.famiglia.id !== 'libero' && scheda.famiglia.id !== 'non_modellabile';

/**
 * La richiesta della verifica: sulla vista principale se c'è e la famiglia ne ha la faccia, altrimenti sulla foto.
 *
 * @param context - Il contesto della macchina.
 * @returns La richiesta e se lavora sulla vista principale.
 */
const richiestaVerifica = (context: RiconoscimentoContext): { richiesta: RichiestaVerifica; sullaVista: boolean } => {
  const opzioni =
    context.rientri > 0
      ? { budgetMs: BUDGET_DOPO_RIENTRO_MS }
      : context.budgetMs === undefined
        ? {}
        : { budgetMs: context.budgetMs };
  const principale = context.viste?.principale;
  const sullaVista = principale
    ? richiestaDaVistaGenerata(context.scheda!, principale.png, principale.faccia, opzioni, context.bloccati)
    : undefined;
  return sullaVista
    ? { richiesta: sullaVista, sullaVista: true }
    : {
        richiesta: richiestaDaScheda(context.scheda!, context.maschera, opzioni, context.bloccati)!,
        sullaVista: false,
      };
};

export const riconoscimentoMachine = setup({
  schemas: {
    input: types<RiconoscimentoInput>(),
    context: types<RiconoscimentoContext>(),
    events: eventSchemas<RiconoscimentoEvent>(),
  },
  actors: {
    riconosci: createAsyncLogic<SchedaPerVerifica, IngressoRiconosci>({ run: nonFornito('riconosci') }),
    verifica: createAsyncLogic<RispostaVerifica, IngressoVerifica>({ run: nonFornito('verifica') }),
    rientro: createAsyncLogic<SchedaPerVerifica, IngressoRientro>({ run: nonFornito('rientro') }),
    confronta: createAsyncLogic<RisultatoConfronti, IngressoConfronta>({ run: nonFornito('confronta') }),
  },
}).createMachine({
  id: 'riconoscimento',
  context: ({ input }) => ({
    progettoId: input.progettoId,
    parteId: input.parteId,
    maschera: input.maschera,
    budgetMs: input.budgetMs,
    bloccati: input.bloccati ?? [],
    viste: input.viste,
    scheda: undefined,
    ultima: undefined,
    migliore: undefined,
    rientri: 0,
    consegna: undefined,
    schedaConsegnata: undefined,
    rispostaConsegnata: undefined,
    esitoVerifica: undefined,
    confronti: undefined,
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
        input: ({ context }): IngressoVerifica => {
          const { richiesta, sullaVista } = richiestaVerifica(context);
          return sullaVista && context.viste
            ? { richiesta, rolli: rolliDaProvare(context.scheda!.famiglia.id, context.viste.principale.faccia) }
            : { richiesta };
        },
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
            // Sulla vista principale si confronta ancora con il controllo e con la foto prima di consegnare.
            target: richiestaVerifica(context).sullaVista ? 'confrontando' : 'consegnato',
            context: {
              esitoVerifica: esito,
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
    confrontando: {
      invoke: {
        src: 'confronta',
        input: ({ context }) => ({
          scheda: context.schedaConsegnata!,
          principale: context.rispostaConsegnata!,
          viste: context.viste!,
          maschera: context.maschera,
        }),
        onDone: ({ context, event }) => ({
          target: 'consegnato',
          context: {
            confronti: event.output,
            rispostaConsegnata: event.output.risposta,
            consegna: consegnaVerifica(context.schedaConsegnata!, event.output.risposta, context.esitoVerifica!),
          },
        }),
        // I confronti non bloccano mai il pezzo: senza, si consegna la verifica sulla principale.
        onError: { target: 'consegnato' },
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
