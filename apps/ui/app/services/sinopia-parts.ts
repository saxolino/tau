import { z } from 'zod';
import { scegliScala, schedaParteSchema } from '@taucad/smlib/riconoscimento';
import type { MascheraBinaria, SchedaParte } from '@taucad/smlib/riconoscimento';
import { searchParameterName } from '#constants/search-parameter.constants.js';
import { getSinopiaDataClient } from '#lib/sinopia-data-client.js';
import { downloadSinopiaReferenceImage, sinopiaImageLocation } from '#services/sinopia-references.js';
import type { SinopiaImageLocation } from '#services/sinopia-references.js';

/**
 * «/cad/nuovo» (SinopiaCAD D2, T-D2-04): from the address of Sinopia's «Apri nel CAD» on an isolated part to the part
 * sheet the recognition needs. Only ids travel in the address; the image, the saved part list and the mask are read
 * with the shared session from the account's own private storage (`creator-private`), as `sinopia-references.ts` does.
 */

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
/** The ids `riconosci-parti` writes (`_shared/parti-salvate.ts`: clean snake_case, `_2` on duplicates). */
const partIdPattern = /^[\d_a-z]{1,200}$/u;
const partTypePattern = /^[_a-z]{2,40}$/u;

/** The parameters of «/cad/nuovo», read and checked. */
export type ParametriNuovo = Readonly<{
  progetto: string;
  asset: string;
  parte: string;
  maschera?: string;
  partType?: string;
  libreria?: string;
  misura?: Readonly<{ valoreMm: number; cosa: string }>;
}>;

/**
 * A piece that has no project, asset or part: a Library component (`?library=<uuid>`) or a supplier-catalogue
 * product (`?supplier=<uuid>`). Only its card is read: picture, type and, for the Library, the declared size.
 */
export type ParametriPezzo = Readonly<{
  origine: 'libreria' | 'fornitore';
  id: string;
  misura?: Readonly<{ valoreMm: number; cosa: string }>;
}>;

/** What the address asks for: a part to read, a catalogue piece, the development trial, or not enough to start. */
export type LetturaNuovo =
  | Readonly<{ stato: 'parte'; parametri: ParametriNuovo }>
  | Readonly<{ stato: 'pezzo'; parametri: ParametriPezzo }>
  | Readonly<{ stato: 'prova'; famigliaIncerta: boolean }>
  | Readonly<{ stato: 'incompleto' }>;

/**
 * A measure the designer knows, as the home's «Una misura che conosci» and Sinopia's links write it: `20:larghezza`,
 * `20,5 mm:luce`, or a bare number (then it measures the part's long side).
 *
 * @param testo - The `measure` parameter.
 * @returns Millimetres and what they measure, or undefined.
 */
export function leggiMisura(testo: string | undefined): ParametriNuovo['misura'] {
  if (!testo) {
    return undefined;
  }
  const separatore = testo.indexOf(':');
  const numero = (separatore === -1 ? testo : testo.slice(0, separatore)).replace(/mm/iu, '').trim().replace(',', '.');
  const valoreMm = Number(numero);
  if (!/^\d+(?:\.\d+)?$/u.test(numero) || !(valoreMm > 0) || valoreMm > 2000) {
    return undefined;
  }
  const cosa =
    separatore === -1
      ? ''
      : testo
          .slice(separatore + 1)
          .trim()
          .slice(0, 80);
  return { valoreMm, cosa: cosa || 'lato lungo' };
}

/**
 * Read «/cad/nuovo». Project, asset and part are required; everything else is optional and dropped when malformed.
 *
 * @param parametri - The address's search parameters.
 * @param opzioni - Whether the development trial (`?prova=fibbia`) is admitted.
 * @returns What to start.
 */
export function leggiParametriNuovo(parametri: URLSearchParams, opzioni: Readonly<{ prove: boolean }>): LetturaNuovo {
  const prova = opzioni.prove ? parametri.get(searchParameterName.recognitionTrial) : undefined;
  if (prova === 'fibbia' || prova === 'fibbia-incerta') {
    return { stato: 'prova', famigliaIncerta: prova === 'fibbia-incerta' };
  }
  const progetto = parametri.get(searchParameterName.sinopiaProject) ?? '';
  const asset = parametri.get(searchParameterName.sinopiaAsset) ?? '';
  const parte = parametri.get(searchParameterName.sinopiaPart) ?? '';
  if (!uuidPattern.test(progetto) || !uuidPattern.test(asset) || !partIdPattern.test(parte)) {
    // No part of a project: the piece of a Library or supplier card (the Library wins when both are given).
    const pezzoLibreria = parametri.get(searchParameterName.sinopiaLibrary) ?? '';
    const pezzoFornitore = parametri.get(searchParameterName.sinopiaSupplier) ?? '';
    const misuraPezzo = leggiMisura(parametri.get(searchParameterName.sinopiaMeasure) ?? undefined);
    const origine = uuidPattern.test(pezzoLibreria)
      ? ({ origine: 'libreria', id: pezzoLibreria.toLowerCase() } as const)
      : uuidPattern.test(pezzoFornitore)
        ? ({ origine: 'fornitore', id: pezzoFornitore.toLowerCase() } as const)
        : undefined;
    return origine
      ? { stato: 'pezzo', parametri: { ...origine, ...(misuraPezzo ? { misura: misuraPezzo } : {}) } }
      : { stato: 'incompleto' };
  }
  const maschera = parametri.get(searchParameterName.sinopiaMask) ?? undefined;
  const partType = parametri.get(searchParameterName.sinopiaPartType) ?? undefined;
  const libreria = parametri.get(searchParameterName.sinopiaLibrary) ?? undefined;
  const misura = leggiMisura(parametri.get(searchParameterName.sinopiaMeasure) ?? undefined);
  return {
    stato: 'parte',
    parametri: {
      progetto: progetto.toLowerCase(),
      asset: asset.toLowerCase(),
      parte,
      ...(maschera &&
      /^users\/[\da-f-]{36}\/maschere-parti\/[\da-f]{64}\/[^\\]+\.png$/u.test(maschera) &&
      !maschera.includes('..')
        ? { maschera }
        : {}),
      ...(partType && partTypePattern.test(partType) ? { partType } : {}),
      ...(libreria && uuidPattern.test(libreria) ? { libreria: libreria.toLowerCase() } : {}),
      ...(misura ? { misura } : {}),
    },
  };
}

type Riquadro = readonly [number, number, number, number];

const bboxDi = (contorno: ReadonlyArray<readonly [number, number]>): [number, number, number, number] => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of contorno) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
};

const iouRiquadri = (a: Riquadro, b: Riquadro): number => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  const area = (r: Riquadro): number => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const unione = area(a) + area(b) - inter;
  return unione <= 0 ? 0 : inter / unione;
};

/** Below this IoU with the box an outline is unusable (`SOGLIA_CONTORNO_SU_RIQUADRO` in Sinopia). */
export const sogliaContornoSuRiquadro = 0.5;

/**
 * Copy of Sinopia's `orientaContorno` (`src/lib/parts/parti-riconosciute.ts`): Gemini writes outline points mostly as
 * [y, x], sometimes [x, y], inconsistently from part to part. The box is reliable: keep the version (as is or swapped)
 * whose bounds overlap it more; on a tie, as is. Under the threshold the outline is unusable.
 *
 * @param contorno - Outline in 0–1000.
 * @param box - The part's box, x0 y0 x1 y1 in 0–1000.
 * @returns The outline as [x, y], or undefined.
 */
export function orientaContorno(contorno: Array<[number, number]>, box: Riquadro): Array<[number, number]> | undefined {
  if (contorno.length === 0) {
    return undefined;
  }
  const scambiato = contorno.map(([a, b]): [number, number] => [b, a]);
  const iouCosi = iouRiquadri(bboxDi(contorno), box);
  const iouScambiato = iouRiquadri(bboxDi(scambiato), box);
  const scelto = iouScambiato > iouCosi ? scambiato : contorno;
  return Math.max(iouCosi, iouScambiato) < sogliaContornoSuRiquadro ? undefined : scelto;
}

/**
 * Rasterise an outline (0–1000) into a mask of the picture's size, even–odd scanline fill at pixel centres.
 *
 * @param contorno - Outline as [x, y] in 0–1000.
 * @param larghezza - Picture width in pixels.
 * @param altezza - Picture height in pixels.
 * @returns The mask (1 = part).
 */
export function rasterizzaContorno(
  contorno: ReadonlyArray<readonly [number, number]>,
  larghezza: number,
  altezza: number,
): MascheraBinaria {
  const dati = new Uint8Array(larghezza * altezza);
  const punti = contorno.map(([x, y]) => [(x * larghezza) / 1000, (y * altezza) / 1000] as const);
  if (punti.length < 3) {
    return { larghezza, altezza, dati };
  }
  for (let riga = 0; riga < altezza; riga++) {
    const y = riga + 0.5;
    const incroci: number[] = [];
    for (let indice = 0; indice < punti.length; indice++) {
      const [ax, ay] = punti[indice]!;
      const [bx, by] = punti[(indice + 1) % punti.length]!;
      if (ay <= y === by > y) {
        incroci.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    incroci.sort((a, b) => a - b);
    for (let coppia = 0; coppia + 1 < incroci.length; coppia += 2) {
      const da = Math.max(0, Math.ceil(incroci[coppia]! - 0.5));
      const a = Math.min(larghezza - 1, Math.floor(incroci[coppia + 1]! - 0.5));
      dati.fill(1, riga * larghezza + da, riga * larghezza + a + 1);
    }
  }
  return { larghezza, altezza, dati };
}

/** Copy of Sinopia's `segmentoSicuro` (`deposito-maschere.ts`): a Storage-safe path segment without dots. */
export const segmentoSicuro = (testo: string): string =>
  encodeURIComponent(testo)
    .replaceAll(/[!'()*.~]/gu, (carattere) => `%${carattere.codePointAt(0)!.toString(16).toUpperCase()}`)
    .replaceAll('%', '_');

/** Copy of Sinopia's `chiaveRiconosciuta`: id + rounded box, the mask's name in the deposit. */
export const chiaveRiconosciuta = (parte: Readonly<{ id: string; box: readonly number[] }>): string =>
  `${segmentoSicuro(parte.id)}.${parte.box.map((numero) => Math.round(numero)).join('-')}`;

const pesoOrigine = { sam: 3, contorno: 2, vuota: 1 } as const;

/**
 * The best saved mask for a part among a folder's file names (`<key>.<origin>.png`): SAM over outline over «empty»,
 * as `PESO_ORIGINE` in Sinopia. An «empty» file means SAM found nothing: no mask.
 *
 * @param nomi - File names of `users/<uid>/maschere-parti/<sha>/riconosciute/`.
 * @param chiave - The part's key ({@link chiaveRiconosciuta}).
 * @returns The file and its origin, or undefined.
 */
export function scegliFileMaschera(
  nomi: readonly string[],
  chiave: string,
): Readonly<{ nome: string; origine: 'sam' | 'contorno' }> | undefined {
  let migliore: { nome: string; origine: keyof typeof pesoOrigine } | undefined;
  for (const nome of nomi) {
    if (!nome.startsWith(`${chiave}.`) || !nome.endsWith('.png')) {
      continue;
    }
    const origine = nome.slice(chiave.length + 1, -'.png'.length);
    if (origine !== 'sam' && origine !== 'contorno' && origine !== 'vuota') {
      continue;
    }
    if (migliore === undefined || pesoOrigine[origine] > pesoOrigine[migliore.origine]) {
      migliore = { nome, origine };
    }
  }
  return migliore === undefined || migliore.origine === 'vuota'
    ? undefined
    : { nome: migliore.nome, origine: migliore.origine };
}

/** Words of a part's id or label → Sinopia `part_type`, as a suggestion of the part analysis (§2.2). */
const tipiDaParole: ReadonlyArray<readonly [RegExp, string]> = [
  [/tappo|top.?lift/u, 'top_lift'],
  [/tacc|heel/u, 'heel'],
  [/zepp|wedge/u, 'midsole_wedge'],
  [/suol|fondo|sole/u, 'sole'],
  [/fibbi|buckle/u, 'buckle'],
  [/occhiell|eyelet/u, 'eyelet'],
  [/borchi|stud|rivet/u, 'stud'],
  [/placc|logo|plate|ornament/u, 'ornament'],
  [/tomai|upper|vamp|fodera|lining|lacc|lace|cerniera|zip/u, 'leather'],
];

/**
 * The part type a part's words suggest, for parts that arrive without a declared type.
 *
 * @param parte - Id and label of the recognised part.
 * @returns A Sinopia `part_type`, or undefined.
 */
export function partTypeDaParole(parte: Readonly<{ id: string; etichetta: string; nome: string }>): string | undefined {
  const testo = `${parte.id} ${parte.nome} ${parte.etichetta}`.toLowerCase();
  return tipiDaParole.find(([parole]) => parole.test(testo))?.[1];
}

/**
 * SHA-256 hex of the original bytes: the same fingerprint as Sinopia's `impronta-immagine.ts`, so the saved part
 * list and the masks are found again.
 *
 * @param byte - The image bytes.
 * @returns Lowercase hex.
 */
export async function improntaDeiByte(byte: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', byte);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* eslint-disable @typescript-eslint/naming-convention -- Supabase column names verbatim. */
const assetSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  project_id: z.string(),
  type: z.enum(['ai_render', 'ai_edit', 'approved_design', 'paper_upload', 'canvas_snapshot']),
  storage_bucket: z.string().nullable(),
  storage_path: z.string().nullable(),
  public_url: z.string().nullable().optional(),
});
const parteSalvataSchema = z.object({
  id: z.string(),
  nome: z.string(),
  etichetta: z.string(),
  materiale: z.string().optional(),
  colore: z.string().optional(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  contorno: z.array(z.tuple([z.number(), z.number()])).optional(),
});
const rigaPartiSchema = z.object({
  parts: z.array(z.unknown()),
  vertical: z.string(),
  language: z.string(),
});
const libreriaSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  type: z.string(),
  width_mm: z.number().nullable(),
  height_mm: z.number().nullable(),
});
/* eslint-enable @typescript-eslint/naming-convention -- Back to camelCase for the domain. */

/** Browser capabilities the reading needs, injected so it runs in tests without a canvas. */
export type StrumentiParti = Readonly<{
  /** Width and height of an image in pixels. */
  dimensioni: (immagine: Blob) => Promise<Readonly<{ larghezza: number; altezza: number }>>;
  /** A mask PNG (white = part) drawn at the picture's size, thresholded. */
  decodificaMaschera: (png: Blob, larghezza: number, altezza: number) => Promise<MascheraBinaria>;
  /** A mask PNG from a binary mask (for an outline rasterised here). */
  codificaMaschera: (maschera: MascheraBinaria) => Promise<Blob>;
  /** Sinopia's `segment-part` (SAM-3), when neither a saved mask nor an outline exist. */
  segmenta?: (immagine: Blob, query: string) => Promise<Blob | undefined>;
  /** The picture's pixels (RGBA), for the plain background cut-out of a catalogue photo. */
  pixel?: (immagine: Blob) => Promise<Readonly<{ larghezza: number; altezza: number; rgba: Uint8ClampedArray }>>;
}>;

/** A part ready for the recognition. */
export type ParteCaricata = Readonly<{
  schedaParte: SchedaParte;
  immagine: Blob;
  maschera: MascheraBinaria;
  mascheraPng: Blob;
  /** The mask is a plain cut-out from the background (catalogue photo), not SAM: the page says it is approximate. */
  scontornoDaSfondo?: boolean;
}>;

/** Why a part could not be read; the page says it in words. */
export class ErroreParte extends Error {
  public readonly codice:
    | 'progettoAssente'
    | 'immagineAssente'
    | 'partiAssenti'
    | 'parteAssente'
    | 'mascheraAssente'
    | 'pezzoAssente';

  public constructor(codice: ErroreParte['codice']) {
    super(codice);
    this.name = 'ErroreParte';
    this.codice = codice;
  }
}

const verticali = new Set(['footwear', 'leather_goods', 'atelier', 'accessories']);

type ClientSinopia = Awaited<ReturnType<typeof getSinopiaDataClient>>['client'];
type ParteSalvata = z.infer<typeof parteSalvataSchema>;
type Lettura = Readonly<{ client: ClientSinopia; userId: string; parametri: ParametriNuovo }>;

/** The project's vertical, checked to belong to the account. */
async function leggiVerticale({ client, userId, parametri }: Lettura): Promise<SchedaParte['progetto']['verticale']> {
  const progetto = await client
    .from('projects')
    .select('id,vertical')
    .eq('id', parametri.progetto)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (progetto.error !== null || progetto.data === null) {
    throw new ErroreParte('progettoAssente');
  }
  const verticale: unknown = Reflect.get(progetto.data, 'vertical');
  return typeof verticale === 'string' && verticali.has(verticale)
    ? (verticale as SchedaParte['progetto']['verticale'])
    : 'footwear';
}

/** The asset's private picture and where it lives. */
async function leggiImmagine({
  client,
  userId,
  parametri,
}: Lettura): Promise<{ immagine: Blob; location: SinopiaImageLocation }> {
  const riga = await client
    .from('assets')
    .select('id,user_id,project_id,type,storage_bucket,storage_path,public_url')
    .eq('id', parametri.asset)
    .eq('user_id', userId)
    .eq('project_id', parametri.progetto)
    .is('deleted_at', null)
    .maybeSingle();
  const asset = assetSchema.safeParse(riga.data);
  if (riga.error !== null || !asset.success) {
    throw new ErroreParte('immagineAssente');
  }
  const { storage_bucket: bucket, storage_path: path, public_url: url } = asset.data;
  const location = bucket && path ? { bucket, path } : sinopiaImageLocation(url ?? undefined);
  if (location?.bucket !== 'creator-private') {
    throw new ErroreParte('immagineAssente');
  }
  try {
    return {
      immagine: await downloadSinopiaReferenceImage({ userId, projectId: parametri.progetto, location }),
      location,
    };
  } catch {
    throw new ErroreParte('immagineAssente');
  }
}

/** The saved analysis of the picture (own rows), the project's vertical and Italian first. */
async function leggiParti({ client, userId }: Lettura, sha256: string, verticale: string): Promise<ParteSalvata[]> {
  const righe = await client
    .from('recognized_parts_cache')
    .select('parts,vertical,language')
    .eq('user_id', userId)
    .eq('image_sha256', sha256);
  const lette = z.array(rigaPartiSchema).safeParse(righe.data);
  if (righe.error !== null || !lette.success || lette.data.length === 0) {
    throw new ErroreParte('partiAssenti');
  }
  const peso = (riga: z.infer<typeof rigaPartiSchema>): number =>
    Number(riga.vertical === verticale) * 2 + Number(riga.language === 'it');
  return lette.data
    .toSorted((a, b) => peso(b) - peso(a))
    .flatMap((riga) =>
      riga.parts.flatMap((valore) => {
        const parsed = parteSalvataSchema.safeParse(valore);
        return parsed.success ? [parsed.data] : [];
      }),
    );
}

type MascheraLetta = Readonly<{ png: Blob; binaria: MascheraBinaria; origine: 'sam' | 'contorno'; path: string }>;

/**
 * The part's mask: the one the address names, else the best one saved for the part, else its outline rasterised
 * here, else SAM. Undefined when there is none at all.
 */
async function leggiMaschera(
  lettura: Lettura,
  contesto: Readonly<{
    sha256: string;
    parte: ParteSalvata;
    contorno: Array<[number, number]> | undefined;
    immagine: Blob;
    dimensioni: Readonly<{ larghezza: number; altezza: number }>;
    strumenti: StrumentiParti;
  }>,
): Promise<MascheraLetta | undefined> {
  const { client, userId, parametri } = lettura;
  const { sha256, parte, contorno, immagine, strumenti } = contesto;
  const { larghezza, altezza } = contesto.dimensioni;
  const cartella = `users/${userId}/maschere-parti/${sha256}/riconosciute`;
  const scarica = async (path: string): Promise<Blob | undefined> => {
    try {
      return await downloadSinopiaReferenceImage({
        userId,
        projectId: parametri.progetto,
        location: { bucket: 'creator-private', path },
      });
    } catch {
      return undefined;
    }
  };
  const decodifica = async (png: Blob, origine: 'sam' | 'contorno', path: string): Promise<MascheraLetta> => ({
    png,
    binaria: await strumenti.decodificaMaschera(png, larghezza, altezza),
    origine,
    path,
  });
  if (parametri.maschera?.startsWith(`users/${userId}/maschere-parti/${sha256}/`)) {
    const png = await scarica(parametri.maschera);
    if (png) {
      return decodifica(png, parametri.maschera.endsWith('.contorno.png') ? 'contorno' : 'sam', parametri.maschera);
    }
  }
  const elenco = await client.storage.from('creator-private').list(cartella, { limit: 1000 });
  const scelto =
    elenco.error === null
      ? scegliFileMaschera(
          elenco.data.map((voce) => voce.name),
          chiaveRiconosciuta(parte),
        )
      : undefined;
  const salvata = scelto ? await scarica(`${cartella}/${scelto.nome}`) : undefined;
  if (scelto && salvata) {
    return decodifica(salvata, scelto.origine, `${cartella}/${scelto.nome}`);
  }
  const path = `${cartella}/${chiaveRiconosciuta(parte)}.contorno.png`;
  if (contorno) {
    const binaria = rasterizzaContorno(contorno, larghezza, altezza);
    return { png: await strumenti.codificaMaschera(binaria), binaria, origine: 'contorno', path };
  }
  const query = [parte.colore, parte.materiale, parte.nome].filter(Boolean).join(' ').toLowerCase();
  const daSam = strumenti.segmenta ? await strumenti.segmenta(immagine, query) : undefined;
  return daSam ? decodifica(daSam, 'sam', `${cartella}/${chiaveRiconosciuta(parte)}.sam.png`) : undefined;
}

/** The declared type (Library, catalogue, or the part's own words) and the Library's dimensions. */
async function leggiTipo(
  { client, userId, parametri }: Lettura,
  parte: ParteSalvata,
): Promise<{ tipo: SchedaParte['tipo']; libreria?: { larghezzaMm?: number; altezzaMm?: number } }> {
  if (parametri.libreria) {
    const riga = await client
      .from('library_components')
      .select('id,user_id,name,type,width_mm,height_mm')
      .eq('id', parametri.libreria)
      .eq('user_id', userId)
      .maybeSingle();
    const componente = libreriaSchema.safeParse(riga.data);
    if (riga.error === null && componente.success) {
      const { type, width_mm: larghezza, height_mm: altezza } = componente.data;
      return {
        tipo: { partType: type, fonte: 'libreria' },
        libreria: {
          ...(larghezza === null ? {} : { larghezzaMm: larghezza }),
          ...(altezza === null ? {} : { altezzaMm: altezza }),
        },
      };
    }
  }
  if (parametri.partType) {
    return { tipo: { partType: parametri.partType, fonte: 'catalogo' } };
  }
  const suggerito = partTypeDaParole(parte);
  return { tipo: suggerito === undefined ? undefined : { partType: suggerito, fonte: 'riconosci_parti' } };
}

/**
 * Rebuild the part sheet from «/cad/nuovo»: the project's vertical, the image (asset of the account, private), its
 * fingerprint, the part from the saved analysis (`recognized_parts_cache`, RLS: own rows), the outline oriented as
 * Sinopia's client does, the mask (the given one, else the best saved one, else the outline rasterised, else SAM),
 * the declared type and the known scale.
 *
 * @param parametri - The checked address parameters.
 * @param strumenti - Image decoding and encoding, and SAM.
 * @returns The sheet, the image and the mask.
 */
export async function caricaSchedaParte(parametri: ParametriNuovo, strumenti: StrumentiParti): Promise<ParteCaricata> {
  const { client, userId } = await getSinopiaDataClient();
  const lettura: Lettura = { client, userId, parametri };
  const verticale = await leggiVerticale(lettura);
  const { immagine, location } = await leggiImmagine(lettura);
  const sha256 = await improntaDeiByte(await immagine.arrayBuffer());
  const dimensioni = await strumenti.dimensioni(immagine);
  const tutte = await leggiParti(lettura, sha256, verticale);
  const parte = tutte.find((candidata) => candidata.id === parametri.parte);
  if (parte === undefined) {
    throw new ErroreParte('parteAssente');
  }
  const contorno = parte.contorno ? orientaContorno(parte.contorno, parte.box) : undefined;
  const maschera = await leggiMaschera(lettura, { sha256, parte, contorno, immagine, dimensioni, strumenti });
  if (maschera === undefined) {
    throw new ErroreParte('mascheraAssente');
  }
  const { tipo, libreria } = await leggiTipo(lettura, parte);
  const scala = scegliScala(
    { ...(parametri.misura ? { misura: parametri.misura } : {}), ...(libreria ? { libreria } : {}) },
    maschera.binaria,
  );
  const schedaParte = schedaParteSchema.parse({
    versione: 1,
    progetto: { id: parametri.progetto, verticale },
    immagine: {
      bucket: 'creator-private',
      path: location.path,
      sha256,
      larghezzaPx: dimensioni.larghezza,
      altezzaPx: dimensioni.altezza,
    },
    parte: {
      id: parte.id,
      nome: parte.nome,
      etichetta: parte.etichetta,
      ...(parte.materiale ? { materiale: parte.materiale } : {}),
      ...(parte.colore ? { colore: parte.colore } : {}),
      box: parte.box,
      ...(contorno ? { contorno } : {}),
    },
    maschera: { bucket: 'creator-private', path: maschera.path, origine: maschera.origine },
    ...(tipo ? { tipo } : {}),
    ...(scala ? { scala } : {}),
    altreParti: tutte
      .filter((altra) => altra.id !== parte.id)
      .slice(0, 50)
      .map((altra) => ({ id: altra.id, etichetta: altra.etichetta, box: altra.box })),
  });
  return { schedaParte, immagine, maschera: maschera.binaria, mascheraPng: maschera.png };
}
