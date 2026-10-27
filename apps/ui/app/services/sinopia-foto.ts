/* oxlint-disable typescript/no-restricted-types -- Supabase nullable columns are part of its wire contract. */
import { z } from 'zod';
import { isPieceMaterialId } from '@taucad/viewer/cad/piece-materials';
import { requireClientEnvironment } from '#environment.config.js';
import { getSinopiaDataClient, requireSinopiaUser } from '#lib/sinopia-data-client.js';
import { livelliFoto } from '#lib/foto-campione/impronta.js';
import type { LivelloFoto, MaterialeFoto } from '#lib/foto-campione/impronta.js';
import { vistePhoto } from '#lib/foto-campione/mappe.js';
import type { VistaFoto } from '#lib/foto-campione/mappe.js';
import type { FotoCampione } from '#lib/foto-campione/galleria.js';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';

/**
 * Client of `POST /v1/photo` (SinopiaCAD D6) on Sinopia's `sinopiacad` function, and the reads the gallery needs from
 * Sinopia: the prices (`credit_costs`), the photos of this CAD model (`assets` `ai_render` with its `cad_model_id`), the
 * last delivered version and the photo bytes. Every read uses the admitted user's client and explicit ownership filters.
 */

/** Why a photo failed, by the function's error type. */
export type CodiceErroreFoto =
  | 'UNAUTHENTICATED'
  | 'BILLING_ACCOUNT_RESTRICTED'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'CAD_MODEL_NOT_FOUND'
  | 'CREDITS_NOT_CONFIGURED'
  | 'CREDIT_COST_CHANGED'
  | 'INSUFFICIENT_CREDITS'
  | 'AI_REQUEST_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'PHOTO_REFUSED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NETWORK';

const codici = new Set<CodiceErroreFoto>([
  'UNAUTHENTICATED',
  'BILLING_ACCOUNT_RESTRICTED',
  'RATE_LIMITED',
  'INVALID_REQUEST',
  'CAD_MODEL_NOT_FOUND',
  'CREDITS_NOT_CONFIGURED',
  'CREDIT_COST_CHANGED',
  'INSUFFICIENT_CREDITS',
  'AI_REQUEST_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'PHOTO_REFUSED',
  'PROVIDER_UNAVAILABLE',
]);

/** A failed photo, with a code the gallery turns into words. */
export class ErroreFoto extends Error {
  public readonly codice: CodiceErroreFoto;
  public readonly stato: number;

  public constructor(codice: CodiceErroreFoto, stato: number, messaggio: string) {
    super(messaggio);
    this.name = 'ErroreFoto';
    this.codice = codice;
    this.stato = stato;
  }
}

const materialeSchema = z.object({
  id: z.string().refine(isPieceMaterialId),
  finitura: z.enum(['polished', 'satin', 'sandblasted']).optional(),
});
const improntaSchema = z.string().regex(/^[0-9a-f]{64}$/u);

const rispostaSchema = z
  .object({
    versione: z.literal(1),
    assetId: z.uuid(),
    progettoId: z.uuid(),
    url: z.string(),
    aiAct: z.string(),
    vista: z.enum(vistePhoto),
    materiale: materialeSchema,
    livello: z.enum(livelliFoto),
    impronta: improntaSchema,
    costo: z.number().int().nonnegative(),
    modello: z.string(),
    replayed: z.boolean(),
  })
  .loose();

/** What the function answers for a photo. */
export type EsitoFoto = Readonly<{
  assetId: string;
  progettoId: string;
  url: string;
  aiAct: string;
  vista: VistaFoto;
  materiale: MaterialeFoto;
  livello: LivelloFoto;
  impronta: string;
  costo: number;
  modello: string;
  replayed: boolean;
}>;

/** The PNG maps of the request, as `rendiMappe` gives them once encoded. */
export type MappePng = Readonly<{
  ombreggiata: Uint8Array;
  profondita: Uint8Array;
  normali: Uint8Array;
  bordi: Uint8Array;
}>;

/** A photo request: one view, one material, one level, the fingerprint, the maps and the cost the person saw. */
export type RichiestaFoto = Readonly<{
  requestId: string;
  maxCreditCost: number;
  cadModelId: string;
  versionNumber: number | null;
  vista: VistaFoto;
  materiale: MaterialeFoto;
  livello: LivelloFoto;
  impronta: string;
  mappe: MappePng;
}>;

const base64 = (bytes: Uint8Array): string => {
  let testo = '';
  for (let indice = 0; indice < bytes.length; indice += 0x80_00) {
    testo += String.fromCodePoint(...bytes.subarray(indice, indice + 0x80_00));
  }
  return btoa(testo);
};

const png = (bytes: Uint8Array): { mediaType: 'image/png'; data: string } => ({
  mediaType: 'image/png',
  data: base64(bytes),
});

/**
 * Ask Sinopia for one sample photo.
 *
 * @param richiesta - The request.
 * @param opzioni - Abort signal, injected fetch and API base for tests.
 * @returns The photo as the function saved it.
 */
export async function generaFotoCampione(
  richiesta: RichiestaFoto,
  opzioni: Readonly<{ segnale?: AbortSignal; fetch?: typeof fetch; base?: string }> = {},
): Promise<EsitoFoto> {
  const base = (opzioni.base ?? requireClientEnvironment('TAU_API_URL')).replace(/\/$/u, '');
  const { token } = await requireSinopiaUser();
  let risposta: Response;
  try {
    risposta = await (opzioni.fetch ?? globalThis.fetch)(`${base}/v1/photo`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: richiesta.requestId,
        maxCreditCost: richiesta.maxCreditCost,
        cadModelId: richiesta.cadModelId,
        versionNumber: richiesta.versionNumber,
        vista: richiesta.vista,
        materiale: richiesta.materiale,
        livello: richiesta.livello,
        impronta: richiesta.impronta,
        mappe: {
          ombreggiata: png(richiesta.mappe.ombreggiata),
          profondita: png(richiesta.mappe.profondita),
          normali: png(richiesta.mappe.normali),
          bordi: png(richiesta.mappe.bordi),
        },
      }),
      ...(opzioni.segnale ? { signal: opzioni.segnale } : {}),
    });
  } catch (error) {
    if (opzioni.segnale?.aborted) {
      throw error;
    }
    throw new ErroreFoto('NETWORK', 0, 'Sinopia non risponde.');
  }
  const corpo: unknown = await risposta.json().catch(() => undefined);
  if (!risposta.ok) {
    const errore = (corpo as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
    const tipo = typeof errore?.type === 'string' ? errore.type : '';
    throw new ErroreFoto(
      codici.has(tipo as CodiceErroreFoto) ? (tipo as CodiceErroreFoto) : 'PROVIDER_UNAVAILABLE',
      risposta.status,
      typeof errore?.message === 'string' ? errore.message : `HTTP ${risposta.status}`,
    );
  }
  const letto = rispostaSchema.safeParse(corpo);
  if (!letto.success) {
    throw new ErroreFoto('PROVIDER_UNAVAILABLE', risposta.status, 'La risposta della foto non è valida.');
  }
  const { assetId, progettoId, url, aiAct, vista, materiale, livello, impronta, costo, modello, replayed } = letto.data;
  return {
    assetId,
    progettoId,
    url,
    aiAct,
    vista,
    materiale: materiale as MaterialeFoto,
    livello,
    impronta,
    costo,
    modello,
    replayed,
  };
}

/** The `credit_costs` rows of SinopiaCAD. */
export const prezziCad = ['cad_photo', 'cad_photo_fedele', 'cad_recognize'] as const;
export type PrezzoCad = (typeof prezziCad)[number];

/* eslint-disable @typescript-eslint/naming-convention -- These validation objects describe Supabase wire column names verbatim. */
const prezzoSchema = z.object({
  operation_type: z.string(),
  credits_required: z.number().int().nonnegative(),
});
const fotoSchema = z.object({
  id: z.uuid(),
  storage_bucket: z.string().nullable(),
  storage_path: z.string().nullable(),
  created_at: z.string(),
  metadata: z
    .object({
      vista: z.enum(vistePhoto),
      materiale: materialeSchema,
      livello: z.enum(livelliFoto),
      impronta: improntaSchema,
      aiAct: z.object({ label: z.string() }).loose().optional(),
    })
    .loose(),
});
const versioneSchema = z.object({ version_number: z.number().int().positive().nullable() });
/* eslint-enable @typescript-eslint/naming-convention -- Domain names stay camelCase. */

type ClientFactory = typeof getSinopiaDataClient;

/**
 * The active prices of SinopiaCAD's paid operations, in credits; a missing row means «not priced yet».
 *
 * @param getClient - The Sinopia data client (a seam for tests).
 * @returns The prices that exist.
 */
export async function leggiPrezziCad(
  getClient: ClientFactory = getSinopiaDataClient,
): Promise<Partial<Record<PrezzoCad, number>>> {
  const { client } = await getClient();
  const { data, error } = await client
    .from('credit_costs')
    .select('operation_type,credits_required')
    .in('operation_type', [...prezziCad])
    .eq('is_active', true);
  if (error) {
    throw new Error('Sinopia prices: unreadable');
  }
  const prezzi: Partial<Record<PrezzoCad, number>> = {};
  for (const riga of z.array(prezzoSchema).parse(data)) {
    if ((prezziCad as readonly string[]).includes(riga.operation_type)) {
      prezzi[riga.operation_type as PrezzoCad] = riga.credits_required;
    }
  }
  return prezzi;
}

/**
 * The sample photos of this CAD model in its Sinopia project, newest first. A malformed row is left out.
 *
 * @param link - The model's Sinopia link.
 * @param getClient - The Sinopia data client.
 * @returns The photos.
 */
export async function elencaFotoCampione(
  link: SinopiaCadLink,
  getClient: ClientFactory = getSinopiaDataClient,
): Promise<FotoCampione[]> {
  const { client, userId } = await getClient();
  if (userId !== link.userId) {
    throw new Error('SINOPIA_OWNER_MISMATCH');
  }
  const { data, error } = await client
    .from('assets')
    .select('id,storage_bucket,storage_path,created_at,metadata')
    .eq('user_id', link.userId)
    .eq('project_id', link.projectId)
    .eq('type', 'ai_render')
    // eslint-disable-next-line @typescript-eslint/naming-convention -- The containment predicate uses the persisted JSON fields.
    .contains('metadata', { cad_model_id: link.modelId, source: 'sinopiacad' })
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) {
    throw new Error('Sinopia photos: unreadable');
  }
  const foto: FotoCampione[] = [];
  for (const riga of Array.isArray(data) ? data : []) {
    const letta = fotoSchema.safeParse(riga);
    if (!letta.success || !letta.data.storage_path) {
      continue;
    }
    const { id, storage_bucket: bucket, storage_path: path, created_at: creata, metadata } = letta.data;
    foto.push({
      id,
      vista: metadata.vista,
      materiale: metadata.materiale as MaterialeFoto,
      livello: metadata.livello,
      impronta: metadata.impronta,
      creata: Date.parse(creata),
      sorgente: { tipo: 'storage', bucket: bucket ?? 'creator-private', path },
      ...(metadata.aiAct ? { aiAct: metadata.aiAct.label } : {}),
    });
  }
  return foto;
}

/**
 * The number of the last version of this model sent to Sinopia (`assets` `cad_model`), or `null` before the first.
 *
 * @param link - The model's Sinopia link.
 * @param getClient - The Sinopia data client.
 * @returns The version number, or `null`.
 */
export async function ultimaVersioneConsegnata(
  link: SinopiaCadLink,
  getClient: ClientFactory = getSinopiaDataClient,
): Promise<number | null> {
  const { client } = await getClient();
  const { data, error } = await client
    .from('assets')
    .select('version_number')
    .eq('user_id', link.userId)
    .eq('project_id', link.projectId)
    .eq('type', 'cad_model')
    // eslint-disable-next-line @typescript-eslint/naming-convention -- The containment predicate uses the persisted JSON field.
    .contains('metadata', { cad_model_id: link.modelId })
    .order('version_number', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error('Sinopia versions: unreadable');
  }
  return data === null ? null : versioneSchema.parse(data).version_number;
}

/**
 * The bytes of a photo kept in Sinopia's storage (the owner's own `creator-private` object).
 *
 * @param sorgente - Bucket and path of the asset.
 * @param getClient - The Sinopia data client.
 * @returns The image bytes.
 */
export async function scaricaFoto(
  sorgente: Readonly<{ bucket: string; path: string }>,
  getClient: ClientFactory = getSinopiaDataClient,
): Promise<Uint8Array<ArrayBuffer>> {
  const { client } = await getClient();
  const { data, error } = await client.storage.from(sorgente.bucket).download(sorgente.path);
  if (error || !data) {
    throw new Error('Sinopia photo: not downloadable');
  }
  return new Uint8Array(await data.arrayBuffer());
}
