import { z } from 'zod';
import { facceVista, ruoliVista } from '@taucad/smlib/riconoscimento';
import type { SchedaParte } from '@taucad/smlib/riconoscimento';
import { randomUuid } from '@taucad/utils/id';
import { requireClientEnvironment } from '#environment.config.js';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
import { leggiPrezziCad } from '#services/sinopia-foto.js';
import { downloadSinopiaReferenceImage } from '#services/sinopia-references.js';
import { unaVoltaPerVisita } from '#services/sinopia-recognize.js';

/**
 * Client di `POST /v1/views` della funzione `sinopiacad` (piano «viste ortogonali», §5.1): una vista piatta della parte
 * per chiamata, generata dalla sorgente (la principale) o dalla principale (il controllo). Il client non sceglie la
 * faccia: manda la famiglia risolta e la scheda della parte, il server ricava la faccia dalla sua tabella e la dice
 * nella risposta. Ogni vista ha la sua prenotazione e il suo `requestId`, stabile per visita, giro e ruolo: un
 * ricaricamento ritrova la vista già fatta senza un secondo addebito.
 *
 * Le viste aiutano, non bloccano: ogni errore che non riguarda i crediti dell'utente o il suo accesso porta a
 * «prosegui senza viste» (riconoscimento v2 sulla sola foto, come prima).
 */

/** Perché una vista non è arrivata, dal `type` dell'errore della funzione (§5.2). */
export type CodiceErroreVista =
  | 'ROUTE_MISSING'
  | 'VIEWS_NOT_APPLICABLE'
  | 'VIEW_SOURCE_UNAVAILABLE'
  | 'VIEW_REFUSED'
  | 'VIEW_INVALID'
  | 'CREDITS_NOT_CONFIGURED'
  | 'CREDIT_COST_CHANGED'
  | 'INSUFFICIENT_CREDITS'
  | 'REQUEST_IN_PROGRESS'
  | 'AI_REQUEST_CONFLICT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_SPEND_BLOCKED'
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'CAD_PILOT_NOT_ALLOWED'
  | 'BILLING_ACCOUNT_RESTRICTED'
  | 'REQUEST_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'NETWORK';

const codici = new Set<CodiceErroreVista>([
  'VIEWS_NOT_APPLICABLE',
  'VIEW_SOURCE_UNAVAILABLE',
  'VIEW_REFUSED',
  'CREDITS_NOT_CONFIGURED',
  'CREDIT_COST_CHANGED',
  'INSUFFICIENT_CREDITS',
  'REQUEST_IN_PROGRESS',
  'AI_REQUEST_CONFLICT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_SPEND_BLOCKED',
  'INVALID_REQUEST',
  'UNAUTHENTICATED',
  'CAD_PILOT_NOT_ALLOWED',
  'BILLING_ACCOUNT_RESTRICTED',
  'REQUEST_TOO_LARGE',
  'RATE_LIMITED',
]);

/** Una vista non generata, con il codice che decide come proseguire ({@link decisioneVista}). */
export class ErroreVista extends Error {
  public readonly codice: CodiceErroreVista;
  public readonly stato: number;
  /** Secondi dopo cui riprovare (`retry-after` di `REQUEST_IN_PROGRESS`), se la funzione li dice. */
  public readonly riprovaDopo: number | undefined;

  public constructor(
    codice: CodiceErroreVista,
    stato: number,
    dettaglio: string | Readonly<{ messaggio: string; riprovaDopo?: number }>,
  ) {
    super(typeof dettaglio === 'string' ? dettaglio : dettaglio.messaggio);
    this.name = 'ErroreVista';
    this.codice = codice;
    this.stato = stato;
    this.riprovaDopo = typeof dettaglio === 'string' ? undefined : dettaglio.riprovaDopo;
  }
}

/** Il ruolo di una vista. */
export type RuoloVista = (typeof ruoliVista)[number];

const rispostaSchema = z.object({
  versione: z.literal(1),
  ruolo: z.enum(ruoliVista),
  famiglia: z.string().min(1),
  faccia: z.enum(facceVista),
  assetId: z.uuid(),
  progettoId: z.uuid(),
  percorso: z.object({ bucket: z.literal('creator-private'), path: z.string().min(1).max(1024) }),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  aiAct: z.string().optional(),
  costo: z.number().int().nonnegative(),
  modello: z.string().optional(),
  millisecondi: z.number().optional(),
  replayed: z.boolean().optional(),
});

/** Una vista generata (o ritrovata), come la descrive la funzione. */
export type VistaGenerata = z.infer<typeof rispostaSchema>;

/** Che cosa fa il flusso dopo un errore di una vista (§5.2). */
export type DecisioneVista =
  /** Si prosegue senza viste: riconoscimento sulla sola foto, nessun addebito delle viste. */
  | 'senza_viste'
  /** I crediti non bastano: ci si ferma con «Crediti insufficienti». */
  | 'crediti_insufficienti'
  /** Il prezzo è cambiato: si rilegge e si chiede di nuovo la conferma. */
  | 'riconferma_prezzo'
  /** La stessa vista è ancora in corso: «Riprova» con lo stesso id. */
  | 'riprova'
  /** Il generatore non risponde ora: «Riprova» oppure «Continua senza viste». */
  | 'riprova_o_senza'
  /** L'account non può usare il CAD: lo stesso errore fermerebbe anche il riconoscimento. */
  | 'accesso';

/**
 * Come proseguire dopo un errore di `/v1/views`.
 *
 * @param errore - L'errore della vista.
 * @returns La decisione.
 */
export function decisioneVista(errore: ErroreVista): DecisioneVista {
  switch (errore.codice) {
    case 'INSUFFICIENT_CREDITS': {
      return 'crediti_insufficienti';
    }
    case 'CREDIT_COST_CHANGED': {
      return 'riconferma_prezzo';
    }
    case 'REQUEST_IN_PROGRESS': {
      return 'riprova';
    }
    case 'PROVIDER_UNAVAILABLE':
    case 'PROVIDER_SPEND_BLOCKED':
    case 'RATE_LIMITED':
    case 'NETWORK':
    case 'VIEW_INVALID': {
      return 'riprova_o_senza';
    }
    case 'UNAUTHENTICATED':
    case 'CAD_PILOT_NOT_ALLOWED':
    case 'BILLING_ACCOUNT_RESTRICTED': {
      return 'accesso';
    }
    // Rotta assente (funzione vecchia), parte senza viste, sorgente o principale non leggibili, prezzo non attivo,
    // rifiuto del generatore (crediti rimborsati), corpo rifiutato: il pezzo non resta bloccato per le viste.
    default: {
      return 'senza_viste';
    }
  }
}

/** Il prezzo di una vista, `cad_part_view` in `credit_costs`; `undefined` finché la riga non esiste. */
export const prezzoVista = async (): Promise<number | undefined> => {
  const prezzi = await leggiPrezziCad();
  return prezzi.cad_part_view;
};

/** Che cosa chiedere alla funzione. */
export type RichiestaVista = Readonly<{
  /** La famiglia risolta dal CAD (vincolo o parole): il server ne ricava la faccia. */
  famiglia: string;
  schedaParte: SchedaParte;
}> &
  (
    | Readonly<{ ruolo: 'principale' }>
    | Readonly<{
        ruolo: 'controllo';
        /** 0 = la vista di serie, 1 = la facoltativa (tacco: la seduta dall'alto). */
        indiceControllo?: number;
        /** La vista principale da cui nasce (obbligatoria: il server la rilegge e ne controlla i metadati). */
        principale: Readonly<{ assetId: string }>;
      }>
  );

const leggiRiprovaDopo = (risposta: Response): number | undefined => {
  const valore = Number(risposta.headers.get('retry-after'));
  return Number.isFinite(valore) && valore > 0 ? valore : undefined;
};

/**
 * Chiede a Sinopia una vista della parte. Una vista costa crediti (`cad_part_view`): il prezzo si legge prima e
 * viaggia come tetto approvato (`maxCreditCost`); finché la riga del prezzo non esiste la chiamata non si fa.
 *
 * @param richiesta - Ruolo, famiglia, scheda della parte e, per il controllo, la principale.
 * @param opzioni - Il `requestId` della visita, il segnale, il prezzo, `fetch` e base iniettabili per le prove.
 * @returns La vista.
 */
export async function generaVista(
  richiesta: RichiestaVista,
  opzioni: Readonly<{
    requestId: string;
    segnale?: AbortSignal;
    progettoCad?: string;
    fetch?: typeof fetch;
    base?: string;
    prezzo?: () => Promise<number | undefined>;
  }>,
): Promise<VistaGenerata> {
  const base = (opzioni.base ?? requireClientEnvironment('TAU_API_URL')).replace(/\/$/u, '');
  const { token } = await requireSinopiaUser();
  let prezzo: number | undefined;
  try {
    prezzo = await (opzioni.prezzo ?? prezzoVista)();
  } catch {
    throw new ErroreVista('NETWORK', 0, 'Il prezzo delle viste non è leggibile ora.');
  }
  if (prezzo === undefined) {
    throw new ErroreVista('CREDITS_NOT_CONFIGURED', 0, 'Il prezzo delle viste non è ancora attivo su Sinopia.');
  }
  let risposta: Response;
  try {
    risposta = await (opzioni.fetch ?? globalThis.fetch)(`${base}/v1/views`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(opzioni.progettoCad ? { 'x-tau-project-id': opzioni.progettoCad } : {}),
      },
      body: JSON.stringify({
        requestId: opzioni.requestId,
        maxCreditCost: prezzo,
        versione: 1,
        ruolo: richiesta.ruolo,
        ...(richiesta.ruolo === 'controllo'
          ? { indiceControllo: richiesta.indiceControllo ?? 0, principale: { assetId: richiesta.principale.assetId } }
          : {}),
        famiglia: richiesta.famiglia,
        schedaParte: richiesta.schedaParte,
      }),
      ...(opzioni.segnale ? { signal: opzioni.segnale } : {}),
    });
  } catch (error) {
    if (opzioni.segnale?.aborted) {
      throw error;
    }
    throw new ErroreVista('NETWORK', 0, 'Sinopia non risponde.');
  }
  const corpo: unknown = await risposta.json().catch(() => undefined);
  if (!risposta.ok) {
    const errore = (corpo as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
    const tipo = typeof errore?.type === 'string' ? errore.type : '';
    const codice: CodiceErroreVista = codici.has(tipo as CodiceErroreVista)
      ? (tipo as CodiceErroreVista)
      : risposta.status === 404
        ? 'ROUTE_MISSING'
        : 'PROVIDER_UNAVAILABLE';
    const riprovaDopo = leggiRiprovaDopo(risposta);
    throw new ErroreVista(codice, risposta.status, {
      messaggio: typeof errore?.message === 'string' ? errore.message : `HTTP ${risposta.status}`,
      ...(riprovaDopo === undefined ? {} : { riprovaDopo }),
    });
  }
  const letta = rispostaSchema.safeParse(corpo);
  if (!letta.success || letta.data.ruolo !== richiesta.ruolo) {
    throw new ErroreVista('VIEW_INVALID', risposta.status, 'La risposta della vista non è valida.');
  }
  return letta.data;
}

// ─── Memoria della visita ────────────────────────────────────────────────────────────────────────────────────────

const richiestaSchema = z.object({ requestId: z.uuid() });
const statoVisitaSchema = z.object({ giro: z.number().int().nonnegative(), confermata: z.boolean() });

/** La chiave di `sessionStorage` della richiesta di una vista: visita, giro, ruolo (§2.2). */
export const chiaveVista = (visita: string, giro: number, ruolo: RuoloVista): string =>
  `sinopiacad:viste:${visita}:${String(giro)}:${ruolo}`;

const chiaveStato = (visita: string): string => `sinopiacad:viste:${visita}:giro`;

/** La memoria del `requestId` di ogni vista (`sessionStorage`): senza memoria ogni montaggio prenota la sua. */
export const richiestaVista = {
  leggi(chiave: string): Readonly<{ requestId: string }> | undefined {
    try {
      const letta = richiestaSchema.safeParse(JSON.parse(sessionStorage.getItem(chiave) ?? 'null'));
      return letta.success ? letta.data : undefined;
    } catch {
      return undefined;
    }
  },
  nuova(chiave: string): Readonly<{ requestId: string }> {
    const richiesta = { requestId: randomUuid() };
    try {
      sessionStorage.setItem(chiave, JSON.stringify(richiesta));
    } catch {
      /* Senza memoria la richiesta parte lo stesso; solo un ricaricamento ne prenoterebbe un'altra. */
    }
    return richiesta;
  },
};

/** Lo stato di una visita: il giro delle viste (sale con «Rigenera le viste») e se la spesa è già stata confermata. */
export type StatoVisita = z.infer<typeof statoVisitaSchema>;

/**
 * Lo stato della visita in `sessionStorage`: dopo «Rigenera» e un ricaricamento il CAD riprende il giro nuovo e non
 * riaccoglie le viste vecchie; una visita già confermata non chiede di nuovo la spesa (le richieste si ripetono con gli
 * stessi id, senza addebito).
 */
export const statoVisita = {
  leggi(visita: string): StatoVisita {
    try {
      const letto = statoVisitaSchema.safeParse(JSON.parse(sessionStorage.getItem(chiaveStato(visita)) ?? 'null'));
      return letto.success ? letto.data : { giro: 0, confermata: false };
    } catch {
      return { giro: 0, confermata: false };
    }
  },
  scrivi(visita: string, stato: StatoVisita): void {
    try {
      sessionStorage.setItem(chiaveStato(visita), JSON.stringify(stato));
    } catch {
      /* Senza memoria il giro vive solo nella pagina. */
    }
  },
};

/**
 * Una vista della visita sotto la sua richiesta stabile: un id che Sinopia non accetta più (`AI_REQUEST_CONFLICT`) si
 * sostituisce una volta con uno nuovo.
 *
 * @param chiave - La chiave della vista ({@link chiaveVista}).
 * @param fai - La chiamata, con il `requestId` da mandare.
 * @returns La vista.
 */
export async function vistaUnaVolta<T>(chiave: string, fai: (requestId: string) => Promise<T>): Promise<T> {
  return unaVoltaPerVisita(
    { leggi: () => richiestaVista.leggi(chiave), nuova: () => richiestaVista.nuova(chiave) },
    async (richiesta) => fai(richiesta.requestId),
    (errore) => errore instanceof ErroreVista && errore.codice === 'AI_REQUEST_CONFLICT',
  );
}

/**
 * I byte di una vista come stanno nello storage privato del progetto: sono quelli che il riconoscimento riceve, senza
 * ricodifica, così l'impronta del corpo resta uguale a un ricaricamento.
 *
 * @param vista - La vista generata.
 * @param proprietario - L'account e il progetto Sinopia della parte.
 * @returns Il file della vista.
 */
export async function scaricaVista(
  vista: Pick<VistaGenerata, 'percorso' | 'progettoId'>,
  proprietario: Readonly<{ userId: string }>,
): Promise<Blob> {
  return downloadSinopiaReferenceImage({
    userId: proprietario.userId,
    projectId: vista.progettoId,
    location: vista.percorso,
  });
}
