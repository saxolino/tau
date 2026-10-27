import { z } from 'zod';
import { schedaRiconoscimentoSchema, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import type { SchedaParte } from '@taucad/smlib/riconoscimento';
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
  /** 2 = the sheet names the face; 1 = a function not yet updated (the face is completed from the view name). */
  versione: z.union([z.literal(1), z.literal(2)]),
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

/** What the function answers. */
export type EsitoRiconoscimento = z.infer<typeof rispostaSchema>;

const codici = new Set<CodiceErroreRiconoscimento>([
  'UNAUTHENTICATED',
  'BILLING_ACCOUNT_RESTRICTED',
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
]);

/** The price of a recognition, `cad_recognize` in `credit_costs`; `undefined` while the row does not exist. */
const prezzoRiconoscimento = async (): Promise<number | undefined> => (await leggiPrezziCad()).cad_recognize;

/**
 * Ask Sinopia's function to recognise a part. A recognition costs credits (`cad_recognize`): the price is read first and
 * travels as the approved ceiling (`maxCreditCost`) with a fresh `requestId`; while the price row does not exist the
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
          // The function reads the second round from `immagini.differenza` and builds the prompt with `rientro: true`.
          ...(richiesta.rientro
            ? { differenza: { mediaType: 'image/png', data: base64(richiesta.rientro.differenzaPng) } }
            : {}),
        },
        fattoreRitaglio: richiesta.immagini.fattoreRitaglio,
        lingua: richiesta.lingua,
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
  return letto.data;
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
