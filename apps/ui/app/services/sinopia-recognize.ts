import { z } from 'zod';
import { schedaRiconoscimentoSchema, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import type { ContestoRiconoscimento, MisureFoto, SchedaParte } from '@taucad/smlib/riconoscimento';
import { randomUuid } from '@taucad/utils/id';
import { requireClientEnvironment } from '#environment.config.js';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
import { completaFacciaScheda } from '#services/riconoscimento-faccia.js';
import { leggiPrezziCad } from '#services/sinopia-foto.js';
import type { ImmaginiRiconoscimento } from '#services/riconoscimento-immagini.js';

/**
 * Client of `POST /v1/recognize` (SinopiaCAD D2, T-D2-05) on Sinopia's `sinopiacad` function: the part sheet and the
 * two pictures go out, the recognition sheet comes back, validated again here with the same zod schema the contract
 * was generated from.
 */

/** Why a recognition failed, by the function's error type. */
export type CodiceErroreRiconoscimento =
  | 'UNAUTHENTICATED'
  | 'BILLING_ACCOUNT_RESTRICTED'
  | 'CAD_PILOT_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'RECOGNITION_INVALID'
  | 'RECOGNITION_REFUSED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CREDITS_NOT_CONFIGURED'
  | 'CREDIT_COST_CHANGED'
  | 'INSUFFICIENT_CREDITS'
  | 'REQUEST_IN_PROGRESS'
  | 'AI_REQUEST_CONFLICT'
  | 'REQUEST_TOO_LARGE'
  | 'NETWORK';

/** A failed recognition, with a code the page turns into words. */
export class ErroreRiconoscimento extends Error {
  public readonly codice: CodiceErroreRiconoscimento;
  public readonly stato: number;

  public constructor(codice: CodiceErroreRiconoscimento, stato: number, messaggio: string) {
    super(messaggio);
    this.name = 'ErroreRiconoscimento';
    this.codice = codice;
    this.stato = stato;
  }
}

const rispostaSchema = z.object({
  /**
   * 3 = the function read the generated views and the context (contract v3); 2 = the sheet names the face; 1 = a
   * function not yet updated (the face is completed from the view name).
   */
  versione: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  scheda: z.preprocess(completaFacciaScheda, schedaRiconoscimentoSchema),
  vincolo: z.object({
    vincolo: z.enum(['vincolata', 'suggerita', 'libera']),
    famiglia: z.string().optional(),
    variante: z.string().optional(),
    pezzo: z.string().optional(),
  }),
  telemetria: z.object({ modello: z.string(), scartati: z.array(z.string()), millisecondi: z.number() }).loose(),
});

/**
 * The second round after the D3 check (specification §3.5): the silhouette of the model (red) over the mask (blue) as a
 * PNG, the question, and the IoU that made the check ask. Only the PNG travels (as `immagini.differenza`): the function
 * builds the prompt with `rientro: true`; the question and the IoU stay in the CAD record.
 */
export type RientroRiconoscimento = Readonly<{ differenzaPng: Uint8Array; testo: string; iou: number }>;

const base64 = (bytes: Uint8Array): string => {
  let testo = '';
  for (let indice = 0; indice < bytes.length; indice += 0x80_00) {
    testo += String.fromCodePoint(...bytes.subarray(indice, indice + 0x80_00));
  }
  return btoa(testo);
};

/**
 * What the function answers. `visteUsate`: views went out and the function answered v3, so it read them; `false` when
 * a function not yet updated answered v2 and ignored them (the check then works on the photo alone).
 */
export type EsitoRiconoscimento = z.infer<typeof rispostaSchema> & Readonly<{ visteUsate?: boolean }>;

/** Una vista generata come la riceve il riconoscimento: i byte scaricati, in base64, con il loro tipo e la faccia. */
export type VistaPerRiconoscimento = Readonly<{
  ruolo: 'principale' | 'controllo';
  faccia: NonNullable<ContestoRiconoscimento['viste']>[number]['faccia'];
  mediaType: string;
  data: string;
}>;

/**
 * Il contesto v3 della richiesta: le misure della foto e una voce per ogni vista (la funzione rifiuta una vista senza
 * la sua voce). Undefined se non c'è nulla da dire: allora il corpo resta quello della v2.
 *
 * @param misure - Proporzioni e visibilità misurate dal CAD.
 * @param viste - Le viste che accompagnano la foto.
 * @returns Il contesto, o undefined.
 */
export function contestoRichiesta(
  misure: MisureFoto | undefined,
  viste: readonly VistaPerRiconoscimento[],
): ContestoRiconoscimento | undefined {
  if (misure === undefined && viste.length === 0) {
    return undefined;
  }
  return {
    versione: 1,
    ...(misure?.proporzioni ? { proporzioni: misure.proporzioni } : {}),
    ...(misure ? { visibilita: misure.visibilita } : {}),
    ...(viste.length > 0 ? { viste: viste.map((vista) => ({ ruolo: vista.ruolo, faccia: vista.faccia })) } : {}),
  };
}

const codici = new Set<CodiceErroreRiconoscimento>([
  'UNAUTHENTICATED',
  'BILLING_ACCOUNT_RESTRICTED',
  'CAD_PILOT_NOT_ALLOWED',
  'RATE_LIMITED',
  'INVALID_REQUEST',
  'RECOGNITION_INVALID',
  'RECOGNITION_REFUSED',
  'PROVIDER_UNAVAILABLE',
  'CREDITS_NOT_CONFIGURED',
  'CREDIT_COST_CHANGED',
  'INSUFFICIENT_CREDITS',
  'REQUEST_IN_PROGRESS',
  'AI_REQUEST_CONFLICT',
  // 413: con le viste il corpo arriva a 4–5 immagini; la pagina offre di rifarlo con la sola foto.
  'REQUEST_TOO_LARGE',
]);

/** The request a visit of «/cad/nuovo» booked: its id and the language its reasons were asked in. */
export type RichiestaRiconoscimento = Readonly<{ requestId: string; lingua: 'it' | 'en' }>;

const richiestaSchema = z.object({ requestId: z.uuid(), lingua: z.enum(['it', 'en']) });
const chiaveRichiesta = (visita: string): string => `sinopiacad:riconoscimento:${visita}`;

/**
 * The tab's memory of the recognition each visit booked (`sessionStorage`). A reload, or the page mounted again, sends
 * the same request with the same id and language: Sinopia's idempotency answers it again without a second charge.
 * Without storage every mount books its own request, as before.
 */
export const richiestaRiconoscimento = {
  leggi(visita: string): RichiestaRiconoscimento | undefined {
    try {
      const letta = richiestaSchema.safeParse(JSON.parse(sessionStorage.getItem(chiaveRichiesta(visita)) ?? 'null'));
      return letta.success ? letta.data : undefined;
    } catch {
      return undefined;
    }
  },
  nuova(visita: string, lingua: 'it' | 'en'): RichiestaRiconoscimento {
    const richiesta = { requestId: randomUuid(), lingua };
    try {
      sessionStorage.setItem(chiaveRichiesta(visita), JSON.stringify(richiesta));
    } catch {
      /* Without storage the request still goes out; only a reload would book another. */
    }
    return richiesta;
  },
};

/**
 * Una chiamata a pagamento di una visita sotto la sua richiesta stabile (riconoscimento, viste): la richiesta salvata
 * se c'è, altrimenti una nuova. Un id che Sinopia non accetta più (una richiesta già rimborsata, o lo stesso id con un
 * altro corpo: `AI_REQUEST_CONFLICT`) si sostituisce una volta sola con uno nuovo.
 *
 * @param memoria - Dove la visita tiene la sua richiesta: leggerla, o prenotarne una nuova.
 * @param fai - La chiamata, con la richiesta da mandare.
 * @param conflitto - Se un errore vuol dire «id non più accettato».
 * @returns L'esito della chiamata.
 */
export async function unaVoltaPerVisita<R, T>(
  memoria: Readonly<{ leggi: () => R | undefined; nuova: () => R }>,
  fai: (richiesta: R) => Promise<T>,
  conflitto: (errore: unknown) => boolean,
): Promise<T> {
  try {
    return await fai(memoria.leggi() ?? memoria.nuova());
  } catch (error) {
    if (conflitto(error)) {
      return fai(memoria.nuova());
    }
    throw error;
  }
}

/**
 * Make one recognition of a visit under its stable request. An id Sinopia no longer accepts (a request already refunded,
 * or the same id with another body: `AI_REQUEST_CONFLICT`) is replaced once by a new one.
 *
 * @param visita - The visit and round the request belongs to.
 * @param lingua - The language a new request asks its reasons in.
 * @param fai - The call, with the request id and language to send.
 * @returns The recognition.
 */
export async function riconosciUnaVolta<T>(
  visita: string,
  lingua: 'it' | 'en',
  fai: (richiesta: RichiestaRiconoscimento) => Promise<T>,
): Promise<T> {
  return unaVoltaPerVisita(
    { leggi: () => richiestaRiconoscimento.leggi(visita), nuova: () => richiestaRiconoscimento.nuova(visita, lingua) },
    fai,
    (errore) => errore instanceof ErroreRiconoscimento && errore.codice === 'AI_REQUEST_CONFLICT',
  );
}

/** The price of a recognition, `cad_recognize` in `credit_costs`; `undefined` while the row does not exist. */
const prezzoRiconoscimento = async (): Promise<number | undefined> => (await leggiPrezziCad()).cad_recognize;

/**
 * Ask Sinopia's function to recognise a part. A recognition costs credits (`cad_recognize`): the price is read first and
 * travels as the approved ceiling (`maxCreditCost`) with the caller's `requestId` (a fresh one without it); while the price row does not exist the
 * call is not made at all.
 *
 * @param richiesta - The part sheet, the two pictures and the language of the reasons.
 * @param opzioni - Abort signal, the CAD project id (usage log), the price and request id, injected fetch and API base
 *   for tests.
 * @returns The recognition.
 */
export async function riconosciParte(
  richiesta: Readonly<{
    schedaParte: SchedaParte;
    immagini: ImmaginiRiconoscimento;
    lingua: 'it' | 'en';
    rientro?: RientroRiconoscimento;
    /** V3: le viste generate (byte come scaricati) che accompagnano la foto. */
    viste?: readonly VistaPerRiconoscimento[];
    /** V3: proporzioni e visibilità misurate dal CAD. */
    misure?: MisureFoto;
  }>,
  opzioni: Readonly<{
    segnale?: AbortSignal;
    progettoCad?: string;
    fetch?: typeof fetch;
    base?: string;
    prezzo?: () => Promise<number | undefined>;
    requestId?: string;
  }> = {},
): Promise<EsitoRiconoscimento> {
  const base = (opzioni.base ?? requireClientEnvironment('TAU_API_URL')).replace(/\/$/u, '');
  const { token } = await requireSinopiaUser();
  let prezzo: number | undefined;
  try {
    prezzo = await (opzioni.prezzo ?? prezzoRiconoscimento)();
  } catch {
    throw new ErroreRiconoscimento('NETWORK', 0, 'Il prezzo del riconoscimento non è leggibile ora.');
  }
  if (prezzo === undefined) {
    throw new ErroreRiconoscimento(
      'CREDITS_NOT_CONFIGURED',
      0,
      'Il prezzo del riconoscimento non è ancora attivo su Sinopia.',
    );
  }
  const viste = richiesta.viste ?? [];
  const contesto = contestoRichiesta(richiesta.misure, viste);
  const vista = (ruolo: VistaPerRiconoscimento['ruolo']): Readonly<{ mediaType: string; data: string }> | undefined => {
    const trovata = viste.find((voce) => voce.ruolo === ruolo);
    return trovata ? { mediaType: trovata.mediaType, data: trovata.data } : undefined;
  };
  const principale = vista('principale');
  const controllo = vista('controllo');
  let risposta: Response;
  try {
    risposta = await (opzioni.fetch ?? globalThis.fetch)(`${base}/v1/recognize`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(opzioni.progettoCad ? { 'x-tau-project-id': opzioni.progettoCad } : {}),
      },
      body: JSON.stringify({
        requestId: opzioni.requestId ?? randomUuid(),
        maxCreditCost: prezzo,
        schedaParte: richiesta.schedaParte,
        immagini: {
          ritaglio: richiesta.immagini.ritaglio,
          intera: richiesta.immagini.intera,
          ...(principale ? { principale } : {}),
          ...(controllo ? { controllo } : {}),
          // The function reads the second round from `immagini.differenza` and builds the prompt with `rientro: true`.
          ...(richiesta.rientro
            ? { differenza: { mediaType: 'image/png', data: base64(richiesta.rientro.differenzaPng) } }
            : {}),
        },
        fattoreRitaglio: richiesta.immagini.fattoreRitaglio,
        lingua: richiesta.lingua,
        // V3 solo con viste o misure: senza, il corpo è quello di prima byte per byte.
        ...(contesto ? { versioneContratto: 3, contesto } : {}),
      }),
      ...(opzioni.segnale ? { signal: opzioni.segnale } : {}),
    });
  } catch (error) {
    if (opzioni.segnale?.aborted) {
      throw error;
    }
    throw new ErroreRiconoscimento('NETWORK', 0, 'Sinopia non risponde.');
  }
  const corpo: unknown = await risposta.json().catch(() => undefined);
  if (!risposta.ok) {
    const errore = (corpo as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
    const tipo = typeof errore?.type === 'string' ? errore.type : '';
    throw new ErroreRiconoscimento(
      codici.has(tipo as CodiceErroreRiconoscimento) ? (tipo as CodiceErroreRiconoscimento) : 'PROVIDER_UNAVAILABLE',
      risposta.status,
      typeof errore?.message === 'string' ? errore.message : `HTTP ${risposta.status}`,
    );
  }
  const letto = rispostaSchema.safeParse(corpo);
  if (!letto.success) {
    throw new ErroreRiconoscimento('RECOGNITION_INVALID', risposta.status, 'La scheda di riconoscimento non è valida.');
  }
  return viste.length > 0 ? { ...letto.data, visteUsate: letto.data.versione === 3 } : letto.data;
}

/**
 * The recorded answer of the development trial (`?prova=fibbia`, `?prova=fibbia-incerta`): the same shape the function
 * returns, no call.
 *
 * @param opzioni - `famigliaIncerta`: the family below the threshold, so the family question shows before building.
 * @returns The recognition of the recorded buckle.
 */
export const riconoscimentoRegistrato = (
  opzioni: Readonly<{ famigliaIncerta?: boolean }> = {},
): EsitoRiconoscimento => ({
  versione: 2,
  scheda: opzioni.famigliaIncerta
    ? {
        ...structuredClone(schedaRiconoscimentoDiProva),
        famiglia: {
          id: 'fibbia',
          confidenza: 0.48,
          alternative: [
            { id: 'placca', confidenza: 0.31 },
            { id: 'borchia', confidenza: 0.08 },
          ],
        },
      }
    : structuredClone(schedaRiconoscimentoDiProva),
  vincolo: { vincolo: 'vincolata', famiglia: 'fibbia', variante: 'rettangolare' },
  telemetria: { modello: 'registrato', scartati: [], millisecondi: 0 },
});
