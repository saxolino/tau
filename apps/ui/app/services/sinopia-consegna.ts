/* eslint-disable @typescript-eslint/naming-convention -- Supabase rows, RPC arguments and storage metadata keep their wire names. */
/* oxlint-disable typescript/no-restricted-types -- Supabase nullable columns are part of its wire contract. */
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUuid } from '@taucad/utils/id';
import type { ExportFile } from '@taucad/types';
import type { Ingombro } from '@taucad/smlib/consegna';
import { getSinopiaDataClient, requireSinopiaUser } from '#lib/sinopia-data-client.js';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';

/**
 * SinopiaCAD's delivery towards Sinopia (E3a) besides «Invia a Sinopia»: «Salva in Libreria» (a `library_components`
 * row of the account with the STEP and the GLB) and «Chiedi preventivo» (the existing Sinopia path to a supplier: the
 * single inbox, a network conversation started with `start_network_conversation` as «Contatta» does, the first message
 * with the project as context and the sheet and photo as references through `send_contextual_network_message`).
 *
 * Every call runs with the admitted account's JWT and RLS; nothing here uses a service key or touches another account.
 */

/** The `supplier_products.part_type` codes a SinopiaCAD part can be quoted as (`src/lib/parts/part-types.ts` of Sinopia). */
export const tipiPezzoPreventivo = [
  'heel',
  'top_lift',
  'sole',
  'midsole_wedge',
  'welt',
  'insole',
  'shank',
  'buckle',
  'eyelet',
  'stud',
  'ornament',
  'zipper',
  'other_accessory',
] as const;
export type TipoPezzo = (typeof tipiPezzoPreventivo)[number];

export const isTipoPezzo = (value: unknown): value is TipoPezzo =>
  typeof value === 'string' && (tipiPezzoPreventivo as readonly string[]).includes(value);

/**
 * The Library type (`library_components_type_check`) of a part type: heels, soles and insoles as themselves, buckles
 * and zips as closures, eyelets and studs as hardware, everything else (ornaments, jewellery) as an accessory.
 * @param tipo - The part type, if known.
 * @returns A type the constraint admits.
 */
export function tipoLibreria(
  tipo: TipoPezzo | undefined,
): 'heel' | 'sole' | 'insole' | 'closure' | 'hardware' | 'accessory' {
  switch (tipo) {
    case 'heel':
    case 'top_lift': {
      return 'heel';
    }
    case 'sole':
    case 'midsole_wedge':
    case 'welt': {
      return 'sole';
    }
    case 'insole':
    case 'shank': {
      return 'insole';
    }
    case 'buckle':
    case 'zipper': {
      return 'closure';
    }
    case 'eyelet':
    case 'stud': {
      return 'hardware';
    }
    default: {
      return 'accessory';
    }
  }
}

/** The Library verticals (`library_components_vertical_check`). */
const verticali = ['footwear', 'leather_goods', 'atelier', 'accessories'] as const;
type Verticale = (typeof verticali)[number];

/** Problems the delivery to Sinopia reports, never a raw service message. */
export type ProblemaSinopia = 'session' | 'columns' | 'files' | 'failed' | 'destination' | 'project';

export class SinopiaConsegnaError extends Error {
  public readonly problema: ProblemaSinopia;
  public constructor(problema: ProblemaSinopia) {
    super(`Sinopia delivery: ${problema}`);
    this.name = 'SinopiaConsegnaError';
    this.problema = problema;
  }
}

type Client = Pick<SupabaseClient, 'from' | 'storage' | 'rpc' | 'functions'>;
type Sessione = { client: Client; userId: string };
type ApriSessione = () => Promise<Sessione>;

const uuid = z.uuid();

/**
 * Whether the Library can hold CAD files: the `file_path` and `glb_path` columns exist (migration
 * `20261027163400_libreria_file_cad.sql`, applied only with Marko's OK). Fail-closed: any error, a missing column or
 * no session hides «Salva in Libreria».
 *
 * @param apri - The admitted session.
 * @returns True only when the columns answer.
 */
export async function libreriaConFileCad(apri: ApriSessione = getSinopiaDataClient): Promise<boolean> {
  try {
    const { client } = await apri();
    const { error } = await client.from('library_components').select('id,file_path,glb_path').limit(0);
    return error === null;
  } catch {
    return false;
  }
}

/** A Library row of a SinopiaCAD part, as it is inserted. */
export type RigaLibreria = {
  id: string;
  user_id: string;
  name: string;
  name_it: string;
  description: string | null;
  type: ReturnType<typeof tipoLibreria>;
  vertical: Verticale;
  catalog_section: 'structure';
  thumbnail_url: string;
  image_url: string;
  material: string | null;
  color: string | null;
  width_mm: number;
  height_mm: number;
  is_public: false;
  is_premium: false;
  tags: string[];
  usage_count: 0;
  file_path: string;
  glb_path: string | null;
  metadata: Record<string, unknown>;
};

/** What «Salva in Libreria» saves. */
export type DatiLibreria = Readonly<{
  id: string;
  userId: string;
  nome: string;
  tipo: TipoPezzo | undefined;
  vertical: string | undefined;
  immagine: string;
  materiale?: Readonly<{ chiave: string; nome: string; colore: string }>;
  larghezza: number;
  altezza: number;
  ingombro: Ingombro;
  filePath: string;
  glbPath: string | null;
  link: SinopiaCadLink;
  pezzi: ReadonlyArray<Readonly<{ nome: string; materiale?: string; processo?: string; pesoGrammi?: number }>>;
}>;

/**
 * The Library row: the account's own, private, typed by the part type, measured from the solid, the image the photo of
 * the part, the files in `creator-private/components/<account>/cad/<id>/`.
 * @param dati - What is saved.
 * @returns The row.
 */
export function rigaLibreria(dati: DatiLibreria): RigaLibreria {
  const nome = dati.nome.trim().slice(0, 200) || 'SinopiaCAD';
  return {
    id: dati.id,
    user_id: dati.userId,
    name: nome,
    name_it: nome,
    description: null,
    type: tipoLibreria(dati.tipo),
    vertical: (verticali as readonly string[]).includes(dati.vertical ?? '')
      ? (dati.vertical as Verticale)
      : 'accessories',
    catalog_section: 'structure',
    thumbnail_url: dati.immagine,
    image_url: dati.immagine,
    material: dati.materiale?.nome ?? null,
    color: dati.materiale?.colore ?? null,
    width_mm: dati.larghezza,
    height_mm: dati.altezza,
    is_public: false,
    is_premium: false,
    tags: ['sinopiacad', ...(dati.tipo ? [dati.tipo] : [])],
    usage_count: 0,
    file_path: dati.filePath,
    glb_path: dati.glbPath,
    metadata: {
      source: 'sinopiacad',
      cad_model_id: dati.link.modelId,
      project_id: dati.link.projectId,
      ...(dati.tipo ? { part_type: dati.tipo } : {}),
      ingombro_mm: dati.ingombro.map((valore) => Math.round(valore * 1000) / 1000),
      pezzi: dati.pezzi.map((pezzo) => ({
        nome: pezzo.nome,
        ...(pezzo.materiale === undefined ? {} : { materiale: pezzo.materiale }),
        ...(pezzo.processo === undefined ? {} : { processo: pezzo.processo }),
        ...(pezzo.pesoGrammi === undefined ? {} : { peso_g: Math.round(pezzo.pesoGrammi * 100) / 100 }),
      })),
    },
  };
}

/**
 * Where a SinopiaCAD part's files go in `creator-private`: the account's own `components/` namespace, photo included
 * (the part of a private model is never in a public bucket).
 */
export const percorsiLibreria = (userId: string, id: string): { step: string; glb: string; foto: string } => ({
  step: `components/${userId}/cad/${id}/model.step`,
  glb: `components/${userId}/cad/${id}/model.glb`,
  foto: `components/${userId}/cad/${id}/foto.png`,
});

const fileValido = (file: ExportFile | undefined, mime: string): file is ExportFile =>
  file !== undefined && file.bytes.length > 0 && file.mimeType === mime;

/**
 * The vertical of the model's Sinopia project, as the project says it: never assumed.
 *
 * @param client - The admitted client.
 * @param projectId - The model's Sinopia project.
 * @returns The vertical, or `undefined` when the project names none.
 */
async function verticaleDelProgetto(client: Sessione['client'], projectId: string): Promise<string | undefined> {
  const progetto = await client.from('projects').select('vertical').eq('id', projectId).maybeSingle();
  if (progetto.error !== null) {
    console.error('[sinopia-consegna] the project’s vertical cannot be read', progetto.error);
    throw new SinopiaConsegnaError('failed');
  }
  if (progetto.data === null) {
    throw new SinopiaConsegnaError('project');
  }
  const { vertical } = progetto.data as { vertical?: unknown };
  return typeof vertical === 'string' ? vertical : undefined;
}

/**
 * Save the part in the account's Library: the vertical of the model's Sinopia project first (read, never assumed), then
 * photo, STEP and GLB in the account's private folder, then the row. The row names the photo by the «public» address of
 * its private path, as Sinopia names private media: Sinopia's media service worker serves it with the session, and the
 * CAD reads it from the bucket (`sinopiaImageLocation`). A failed row removes the files it uploaded.
 *
 * @param input - Link, files and the row's data.
 * @param apri - The admitted session.
 * @returns The new component's id.
 */
export async function salvaInLibreria(
  input: Readonly<{
    link: SinopiaCadLink;
    step: ExportFile | undefined;
    glb: ExportFile | undefined;
    foto: ExportFile | undefined;
    nome: string;
    tipo: TipoPezzo | undefined;
    materiale?: DatiLibreria['materiale'];
    larghezza: number;
    altezza: number;
    ingombro: Ingombro;
    pezzi: DatiLibreria['pezzi'];
    signal?: AbortSignal;
  }>,
  apri: ApriSessione = getSinopiaDataClient,
): Promise<string> {
  const { link, step, glb, foto, signal } = input;
  if (
    !fileValido(step, 'application/step') ||
    !fileValido(foto, 'image/png') ||
    (glb && !fileValido(glb, 'model/gltf-binary'))
  ) {
    throw new SinopiaConsegnaError('files');
  }
  let sessione: Sessione;
  try {
    sessione = await apri();
  } catch {
    throw new SinopiaConsegnaError('session');
  }
  if (sessione.userId !== link.userId || !uuid.safeParse(link.userId).success) {
    throw new SinopiaConsegnaError('session');
  }
  if (!(await libreriaConFileCad(async () => sessione))) {
    throw new SinopiaConsegnaError('columns');
  }
  signal?.throwIfAborted();
  const { client, userId } = sessione;
  // Read before anything is uploaded: a failed read or a missing project stops the save.
  const vertical = await verticaleDelProgetto(client, link.projectId);
  signal?.throwIfAborted();
  const id = randomUuid();
  const percorsi = percorsiLibreria(userId, id);
  const caricati: Array<{ bucket: string; path: string }> = [];
  const carica = async (bucket: string, path: string, file: ExportFile): Promise<void> => {
    await requireSinopiaUser(userId);
    signal?.throwIfAborted();
    const { error } = await client.storage.from(bucket).upload(path, file.bytes, {
      contentType: file.mimeType,
      upsert: false,
    });
    if (error) {
      throw new SinopiaConsegnaError('failed');
    }
    caricati.push({ bucket, path });
  };
  let fatto = false;
  try {
    await carica('creator-private', percorsi.foto, foto);
    await carica('creator-private', percorsi.step, step);
    if (glb) {
      await carica('creator-private', percorsi.glb, glb);
    }
    const indirizzoFoto = client.storage.from('creator-private').getPublicUrl(percorsi.foto).data.publicUrl;
    await requireSinopiaUser(userId);
    const riga = rigaLibreria({
      id,
      userId,
      nome: input.nome,
      tipo: input.tipo,
      vertical,
      immagine: indirizzoFoto,
      ...(input.materiale ? { materiale: input.materiale } : {}),
      larghezza: input.larghezza,
      altezza: input.altezza,
      ingombro: input.ingombro,
      filePath: percorsi.step,
      glbPath: glb ? percorsi.glb : null,
      link,
      pezzi: input.pezzi,
    });
    const { error } = await client.from('library_components').insert(riga);
    if (error) {
      throw new SinopiaConsegnaError(error.code === '42703' ? 'columns' : 'failed');
    }
    fatto = true;
    return id;
  } catch (error) {
    throw error instanceof SinopiaConsegnaError ? error : new SinopiaConsegnaError('failed');
  } finally {
    if (!fatto) {
      for (const bucket of new Set(caricati.map((file) => file.bucket))) {
        const paths = caricati.filter((file) => file.bucket === bucket).map((file) => file.path);
        try {
          // oxlint-disable-next-line no-await-in-loop -- One removal per bucket, only this attempt's own files.
          await client.storage.from(bucket).remove(paths);
        } catch {
          console.error('[sinopia-consegna] unused library files need cleanup');
        }
      }
    }
  }
}

/** A supplier that publishes parts of a type. */
export type FornitorePezzo = Readonly<{
  id: string;
  nome: string;
  luogo: string | null;
  prodotti: number;
  demo: boolean;
}>;

const rigaFornitore = z.object({
  supplier_id: z.uuid(),
  supplier: z
    .object({
      id: z.uuid(),
      company_name: z.string().nullable(),
      city: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      is_demo: z.boolean().nullable().optional(),
    })
    .nullable(),
});

/**
 * The admitted suppliers that publish active products of a part type, most products first: the same rows
 * Sinopia's Library reads (RLS decides who is visible), grouped by supplier.
 *
 * @param tipo - The part type.
 * @param apri - The admitted session.
 * @returns The suppliers.
 */
export async function fornitoriPerTipo(
  tipo: TipoPezzo,
  apri: ApriSessione = getSinopiaDataClient,
): Promise<FornitorePezzo[]> {
  if (!isTipoPezzo(tipo)) {
    return [];
  }
  const { client } = await apri();
  const { data, error } = await client
    .from('supplier_products')
    .select('supplier_id, supplier:supplier_profiles!inner(id, company_name, city, country, is_demo)')
    .eq('is_active', true)
    .eq('is_public', true)
    .eq('part_type', tipo)
    .order('id', { ascending: true })
    .limit(500);
  if (error) {
    throw new SinopiaConsegnaError('failed');
  }
  const perFornitore = new Map<string, { nome: string; luogo: string | null; prodotti: number; demo: boolean }>();
  for (const grezza of data) {
    const riga = rigaFornitore.safeParse(grezza);
    if (!riga.success || !riga.data.supplier) {
      continue;
    }
    const { supplier } = riga.data;
    const voce = perFornitore.get(riga.data.supplier_id) ?? {
      nome: (supplier.company_name ?? '').trim() || '—',
      luogo: [supplier.city, supplier.country].filter(Boolean).join(', ') || null,
      prodotti: 0,
      demo: supplier.is_demo === true,
    };
    voce.prodotti += 1;
    perFornitore.set(riga.data.supplier_id, voce);
  }
  return [...perFornitore.entries()]
    .map(([id, voce]) => ({ id, ...voce }))
    .toSorted((a, b) => b.prodotti - a.prodotti || a.nome.localeCompare(b.nome));
}

/** What the quote request says. */
export type DatiPreventivo = Readonly<{
  progetto: string;
  tipo: string;
  quantita: number | undefined;
  nota: string;
  pezzi: ReadonlyArray<
    Readonly<{ nome: string; materiale?: string; processo?: string; pesoGrammi?: number; ingombro?: Ingombro }>
  >;
  misure: readonly string[];
  allegati: readonly string[];
  /** Overall size of the chosen pieces together, read from the verified STEP. */
  ingombroTotale?: Ingombro;
  /** Weight of the chosen pieces together (g), when every one is known. */
  pesoTotaleGrammi?: number;
  /** Finish the person asked for, if any (free text, as written). */
  finitura?: string;
  /** Tolerances the person asked for, if any (free text, as written). */
  tolleranze?: string;
  /**
   * What the manufacturability checks said when the request was prepared: `verificata: false` when they were missing or
   * not up to date with the model; `righe` are the blocks and warnings only (worst first).
   */
  producibilita?: Readonly<{
    verificata: boolean;
    righe: ReadonlyArray<Readonly<{ livello: 'blocco' | 'avviso' | 'info' | 'ok'; testo: string }>>;
  }>;
  /** The Sinopia delivery the STEP and GLB are in, when the model was sent. */
  versione?: number;
  /** The verified STEP travels with the message (the inbox admits CAD files and the server checked it). */
  stepAllegato?: boolean;
  lingua: 'it' | 'en';
}>;

/** What the message says of the 3D files: the attached STEP, or where STEP and GLB are. */
const righeFile = ({ lingua, versione, stepAllegato }: DatiPreventivo): string => {
  const it = lingua === 'it';
  if (stepAllegato) {
    if (versione === undefined) {
      return it
        ? 'Lo STEP allegato è quello verificato da SinopiaCAD (riletto prima dell’invio). Il GLB su richiesta.'
        : 'The attached STEP is the one SinopiaCAD verified (read back before sending). GLB on request.';
    }
    return it
      ? `Lo STEP allegato è quello verificato da SinopiaCAD; il GLB è nella versione ${String(versione)} del CAD nel progetto Sinopia.`
      : `The attached STEP is the one SinopiaCAD verified; the GLB is version ${String(versione)} of the CAD in the Sinopia project.`;
  }
  if (versione === undefined) {
    return it
      ? 'STEP e GLB su richiesta, esportati da SinopiaCAD.'
      : 'STEP and GLB on request, exported from SinopiaCAD.';
  }
  return it
    ? `STEP e GLB nella versione ${String(versione)} del CAD nel progetto Sinopia: te li giro qui se ti servono.`
    : `STEP and GLB are version ${String(versione)} of the CAD in the Sinopia project: I can forward them here.`;
};

/** Most checks the message lists by name; the rest are counted. */
const righeProducibilitaMassime = 8;

/** What the message says of manufacturability: measured outcome with its threshold source, or «not verified». */
const righeProducibilita = (dati: DatiPreventivo): string[] => {
  const it = dati.lingua === 'it';
  const titolo = it
    ? 'Producibilità (controlli di SinopiaCAD sul solido; soglie di mestiere da confermare con te):'
    : 'Manufacturability (SinopiaCAD checks on the solid; trade thresholds to confirm with you):';
  if (!dati.producibilita?.verificata) {
    return [
      titolo,
      it
        ? '· Non verificata: i controlli non erano pronti o non descrivevano la versione inviata.'
        : '· Not verified: the checks were not ready or did not describe the version sent.',
    ];
  }
  const { righe } = dati.producibilita;
  const blocchi = righe.filter(({ livello }) => livello === 'blocco').length;
  const avvisi = righe.filter(({ livello }) => livello === 'avviso').length;
  const sintesi =
    blocchi + avvisi === 0
      ? it
        ? '· Nessun blocco né avviso sui controlli eseguiti. Non è un’approvazione: tolleranze, finitura e costi non sono verificati.'
        : '· No blocks or warnings on the checks run. This is not an approval: tolerances, finish and cost are not verified.'
      : it
        ? `· ${String(blocchi)} blocchi, ${String(avvisi)} avvisi.`
        : `· ${String(blocchi)} blocks, ${String(avvisi)} warnings.`;
  const elenco = righe.slice(0, righeProducibilitaMassime).map(({ livello, testo }) => {
    const etichetta = livello === 'blocco' ? (it ? 'BLOCCO' : 'BLOCK') : it ? 'Avviso' : 'Warning';
    return `  - ${etichetta}: ${testo}`;
  });
  const altri = righe.length - elenco.length;
  return [
    titolo,
    sintesi,
    ...elenco,
    ...(altri > 0 ? [it ? `  - … e altri ${String(altri)}.` : `  - … and ${String(altri)} more.`] : []),
  ];
};

/**
 * The first message of the quote request: what the part is, of what, how big and heavy, how many, the manufacturability
 * outcome with its warnings, finish and tolerances, which files. It says what it did not verify.
 * @param dati - The request.
 * @returns Plain text (at most 4000 characters).
 */
export function testoPreventivo(dati: DatiPreventivo): string {
  const it = dati.lingua === 'it';
  const numero = (valore: number, cifre = 2): string =>
    new Intl.NumberFormat(it ? 'it-IT' : 'en-GB', { maximumFractionDigits: cifre }).format(valore);
  const righe = [
    it
      ? `Richiesta di preventivo · ${dati.tipo} · progetto «${dati.progetto}»`
      : `Quote request · ${dati.tipo} · project "${dati.progetto}"`,
    ...(dati.quantita === undefined
      ? []
      : [it ? `Quantità: ${numero(dati.quantita, 0)} pz` : `Quantity: ${numero(dati.quantita, 0)} pcs`]),
    '',
    it ? 'Pezzi:' : 'Parts:',
    ...dati.pezzi.map((pezzo) =>
      [
        `· ${pezzo.nome}`,
        pezzo.materiale,
        pezzo.processo,
        pezzo.ingombro ? `${pezzo.ingombro.map((valore) => numero(valore)).join(' × ')} mm` : undefined,
        pezzo.pesoGrammi === undefined ? undefined : `${numero(pezzo.pesoGrammi, 1)} g`,
      ]
        .filter(Boolean)
        .join(' — '),
    ),
    ...(dati.ingombroTotale || dati.pesoTotaleGrammi !== undefined
      ? [
          `${it ? 'Insieme:' : 'Overall:'} ${[
            dati.ingombroTotale ? `${dati.ingombroTotale.map((valore) => numero(valore)).join(' × ')} mm` : undefined,
            dati.pesoTotaleGrammi === undefined ? undefined : `${numero(dati.pesoTotaleGrammi, 1)} g`,
          ]
            .filter(Boolean)
            .join(' — ')}`,
        ]
      : []),
    ...(dati.misure.length > 0
      ? ['', it ? 'Misure principali:' : 'Main dimensions:', ...dati.misure.map((riga) => `· ${riga}`)]
      : []),
    '',
    ...righeProducibilita(dati),
    '',
    it
      ? `Finitura: ${dati.finitura?.trim() || 'non indicata'}. Tolleranze: ${dati.tolleranze?.trim() || 'non indicate'}.`
      : `Finish: ${dati.finitura?.trim() || 'not specified'}. Tolerances: ${dati.tolleranze?.trim() || 'not specified'}.`,
    '',
    it ? `Allegati: ${dati.allegati.join(', ')}.` : `Attached: ${dati.allegati.join(', ')}.`,
    righeFile(dati),
    ...(dati.nota.trim() ? ['', dati.nota.trim()] : []),
  ];
  return righe.join('\n').slice(0, 4000);
}

/** A file attached to a network message, as `send_contextual_network_message` stores it. */
export type AllegatoRete = Readonly<{ path: string; name: string; type: string; size_bytes: number }>;

/**
 * The network reference formats (`network-references` bucket): images and PDF, 10 MB, five per message; the STEP once
 * the inbox admits CAD files (migration `20261027163500_posta_allegati_cad.sql`) and the server has read it.
 */
const mimeAllegati = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/step']);
const pesoMassimoAllegato = 10_485_760;

/**
 * Whether a STEP can travel with a message at all: the inbox's 10 MB limit (the server may still refuse it).
 * @param step - The verified STEP, if any.
 * @returns True when it is within the limit.
 */
export const stepAllegabile = (step: ExportFile | undefined): boolean =>
  step !== undefined && step.bytes.length > 0 && step.bytes.length <= pesoMassimoAllegato;

/**
 * The calls of «Chiedi preventivo», in order: start (or reopen) the conversation, upload the references in the
 * account's own folder, send the first message with the project as context.
 *
 * @param input - Account, supplier, project, text and files.
 * @returns The three calls' arguments.
 */
export function chiamatePreventivo(
  input: Readonly<{
    userId: string;
    fornitoreId: string;
    progettoId: string;
    file: readonly ExportFile[];
    clientId: string;
    idFile: () => string;
  }>,
): {
  avvia: { p_expected_actor: string; p_other: string };
  allegati: Array<{ allegato: AllegatoRete; file: ExportFile }>;
  invia: (
    conversazione: string,
    messaggio: Readonly<{ testo: string; allegati: readonly AllegatoRete[] }>,
  ) => {
    p_expected_actor: string;
    p_conversation: string;
    p_client_id: string;
    p_content: string;
    p_context: { source_project_id: string };
    p_attachments: AllegatoRete[];
  };
} {
  if (![input.userId, input.fornitoreId, input.progettoId, input.clientId].every((id) => uuid.safeParse(id).success)) {
    throw new SinopiaConsegnaError('destination');
  }
  if (input.fornitoreId === input.userId) {
    throw new SinopiaConsegnaError('destination');
  }
  const allegati = input.file.slice(0, 5).map((file) => {
    if (!mimeAllegati.has(file.mimeType) || file.bytes.length === 0 || file.bytes.length > pesoMassimoAllegato) {
      throw new SinopiaConsegnaError('files');
    }
    return {
      file,
      allegato: {
        path: `${input.userId}/${input.idFile()}`,
        name: file.name.slice(0, 200),
        type: file.mimeType,
        size_bytes: file.bytes.length,
      },
    };
  });
  return {
    avvia: { p_expected_actor: input.userId, p_other: input.fornitoreId },
    allegati,
    invia: (conversazione, messaggio) => {
      const testo = messaggio.testo.trim().slice(0, 10_000);
      if (!testo) {
        throw new SinopiaConsegnaError('files');
      }
      return {
        p_expected_actor: input.userId,
        p_conversation: conversazione,
        p_client_id: input.clientId,
        p_content: testo,
        p_context: { source_project_id: input.progettoId },
        p_attachments: [...messaggio.allegati],
      };
    },
  };
}

/**
 * Whether the inbox admits CAD files: the probe of migration `20261027163500_posta_allegati_cad.sql` answers `true`.
 * Fail-closed: a missing function, any error or no session means «no».
 *
 * @param apri - The admitted session.
 * @returns True only when the probe answers.
 */
export async function allegatiCadAmmessi(apri: ApriSessione = getSinopiaDataClient): Promise<boolean> {
  try {
    const { client } = await apri();
    const risposta: { data: unknown; error: unknown } = await client.rpc('network_cad_attachments_enabled');
    return risposta.error === null && risposta.data === true;
  } catch {
    return false;
  }
}

/**
 * «Chiedi preventivo»: the existing Sinopia path to a supplier (single inbox), with the sheet and photo attached, and
 * the verified STEP when the inbox admits CAD files and the server's check (`verifica-allegato-cad`) reads it as a
 * STEP. Without either, the message goes as before and says where the STEP is.
 *
 * @param input - Link (account and project), supplier, the text for «STEP attached» or not, files, the STEP.
 * @param apri - The admitted session.
 * @returns The conversation to open in Sinopia, and whether the STEP went with the message.
 */
export async function chiediPreventivo(
  input: Readonly<{
    link: SinopiaCadLink;
    fornitoreId: string;
    testo: (stepAllegato: boolean) => string;
    file: readonly ExportFile[];
    step?: ExportFile;
    clientId: string;
    signal?: AbortSignal;
  }>,
  apri: ApriSessione = getSinopiaDataClient,
): Promise<{ conversazione: string; stepAllegato: boolean }> {
  let sessione: Sessione;
  try {
    sessione = await apri();
  } catch {
    throw new SinopiaConsegnaError('session');
  }
  if (sessione.userId !== input.link.userId) {
    throw new SinopiaConsegnaError('session');
  }
  const { client, userId } = sessione;
  const step =
    input.step?.mimeType === 'application/step' &&
    input.step.bytes.length > 0 &&
    input.step.bytes.length <= pesoMassimoAllegato &&
    (await allegatiCadAmmessi(async () => sessione))
      ? input.step
      : undefined;
  const chiamate = chiamatePreventivo({
    userId,
    fornitoreId: input.fornitoreId,
    progettoId: input.link.projectId,
    file: [...input.file, ...(step ? [step] : [])],
    clientId: input.clientId,
    idFile: randomUuid,
  });
  const avviata = await client.rpc('start_network_conversation', chiamate.avvia);
  const conversazione = uuid.safeParse(avviata.data);
  if (avviata.error !== null || !conversazione.success) {
    throw new SinopiaConsegnaError('destination');
  }
  const caricati: string[] = [];
  const inclusi: AllegatoRete[] = [];
  let stepAllegato = false;
  let inviato = false;
  try {
    for (const { allegato, file } of chiamate.allegati) {
      // oxlint-disable-next-line no-await-in-loop -- Serial uploads give cleanup the exact list of this attempt's files.
      await requireSinopiaUser(userId);
      input.signal?.throwIfAborted();
      // oxlint-disable-next-line no-await-in-loop -- See above.
      const { error } = await client.storage
        .from('network-references')
        .upload(allegato.path, file.bytes, { contentType: allegato.type, upsert: false });
      if (error) {
        throw new SinopiaConsegnaError('failed');
      }
      caricati.push(allegato.path);
      if (file === step) {
        // The server reads the file before a message may carry it; a refused STEP stays out of the message.
        // oxlint-disable-next-line no-await-in-loop -- The check belongs to this upload.
        const verifica = await client.functions.invoke('verifica-allegato-cad', { body: { path: allegato.path } });
        stepAllegato = verifica.error === null;
        if (!stepAllegato) {
          continue;
        }
      }
      inclusi.push(allegato);
    }
    await requireSinopiaUser(userId);
    const { error } = await client.rpc(
      'send_contextual_network_message',
      chiamate.invia(conversazione.data, { testo: input.testo(stepAllegato), allegati: inclusi }),
    );
    if (error) {
      throw new SinopiaConsegnaError('failed');
    }
    inviato = true;
    return { conversazione: conversazione.data, stepAllegato };
  } catch (error) {
    throw error instanceof SinopiaConsegnaError ? error : new SinopiaConsegnaError('failed');
  } finally {
    // Files the message does not carry go: all of them when it was not sent, a refused STEP when it was.
    const daTogliere = inviato
      ? caricati.filter((path) => !inclusi.some((allegato) => allegato.path === path))
      : caricati;
    if (daTogliere.length > 0) {
      try {
        await client.storage.from('network-references').remove(daTogliere);
      } catch {
        console.error('[sinopia-consegna] unused message references need cleanup');
      }
    }
  }
}
