import { z } from 'zod';
import { scegliScala, schedaParteSchema } from '@taucad/smlib/riconoscimento';
import type { MascheraBinaria } from '@taucad/smlib/riconoscimento';
import { getSinopiaDataClient } from '#lib/sinopia-data-client.js';
import { sinopiaImageLocation } from '#services/sinopia-references.js';
import { ErroreParte, improntaDeiByte, partTypeDaParole } from '#services/sinopia-parts.js';
import type { ParametriPezzo, ParteCaricata, StrumentiParti } from '#services/sinopia-parts.js';
import { ENV } from '#environment.config.js';

/**
 * «/cad/nuovo» for a piece of the Library or of the supplier catalogue (`?library=` / `?supplier=`): no project, no
 * asset, no saved part list. The card is read with the account's session (RLS decides what is readable), the picture
 * is downloaded, and the mask comes from the photo itself.
 *
 * Mask: a catalogue photo is a product on a plain (or transparent) background, so the part is cut out from the
 * background for free, locally ({@link mascheraDaSfondo}). Only when the photo has no plain background does it fall
 * back to Sinopia's `segment-part` (SAM-3), as the project flow does; with neither, the page says the mask is missing.
 * The cut-out is approximate (holes are filled, shadows can stay) and the page labels it so.
 *
 * Convention for the part sheet, whose schema (`schedaParteSchema`, shared with Sinopia's function) is not widened:
 * `progetto.id` is the card's id, `immagine.path` / `maschera.path` are `libreria/<id>…` or `fornitore/<id>…`
 * references (the recognition reads the pictures from the request body, never from the path), the vertical is
 * `accessories` for both (a card has no project to ask).
 */

/* eslint-disable @typescript-eslint/naming-convention -- Supabase column names verbatim. */
const libreriaSchema = z.object({
  id: z.string(),
  name: z.string(),
  name_it: z.string().nullable().optional(),
  type: z.string(),
  image_url: z.string(),
  width_mm: z.number().nullable(),
  height_mm: z.number().nullable(),
});
const prodottoSchema = z.object({ id: z.string(), name: z.string(), part_type: z.string().nullable() });
const fotoSchema = z.array(
  z.object({ url: z.string(), is_primary: z.boolean().nullable(), sort_order: z.number().nullable() }),
);
/* eslint-enable @typescript-eslint/naming-convention -- Back to camelCase for the domain. */

/** Colour distance (squared, RGB) under which a pixel is «the background». */
const sogliaSfondo = 40 * 40;
/** At least this share of the border must be the background colour for the background to count as plain. */
const quotaBordoUniforme = 0.85;
/** The part must cover between these shares of the picture, or the cut-out is not believable. */
const quotaMinima = 0.01;
const quotaMassima = 0.92;
const maxByte = 20 * 1024 * 1024;
/** A picture declaring more pixels than this is refused (a small file can declare a decompression bomb). */
export const maxPixel = 40_000_000;
/** Long side at which the background is read and grown: a silhouette needs no more, and memory stays small. */
const latoAnalisi = 1024;

/**
 * The part's mask cut out from a plain or transparent background: the background is the colour of the border,
 * grown from the border inwards; everything it does not reach is the part (so holes inside the part are filled).
 *
 * @param rgba - The picture's pixels, RGBA row by row.
 * @param larghezza - Width in pixels.
 * @param altezza - Height in pixels.
 * @returns The mask, or undefined when the background is not plain or the result is not believable.
 */
export function mascheraDaSfondo(
  rgba: ArrayLike<number>,
  larghezza: number,
  altezza: number,
): MascheraBinaria | undefined {
  const totale = larghezza * altezza;
  if (larghezza < 2 || altezza < 2 || rgba.length < totale * 4) {
    return undefined;
  }
  const bordo: number[] = [];
  for (let x = 0; x < larghezza; x++) {
    bordo.push(x, (altezza - 1) * larghezza + x);
  }
  for (let y = 1; y < altezza - 1; y++) {
    bordo.push(y * larghezza, y * larghezza + larghezza - 1);
  }
  const trasparente = (indice: number): boolean => rgba[indice * 4 + 3]! < 128;
  const dati = new Uint8Array(totale);
  const quotaTrasparente = bordo.filter((indice) => trasparente(indice)).length / bordo.length;
  let sfondo: (indice: number) => boolean;
  if (quotaTrasparente >= quotaBordoUniforme) {
    sfondo = trasparente;
  } else {
    // The background colour: the border's median per channel (robust to a few pixels of the part touching the edge).
    const mediana = (canale: number): number => {
      const valori = bordo.map((indice) => rgba[indice * 4 + canale]!).toSorted((a, b) => a - b);
      return valori[Math.floor(valori.length / 2)]!;
    };
    const [r, g, b] = [mediana(0), mediana(1), mediana(2)];
    const vicino = (indice: number): boolean => {
      if (trasparente(indice)) {
        return true;
      }
      const dr = rgba[indice * 4]! - r;
      const dg = rgba[indice * 4 + 1]! - g;
      const db = rgba[indice * 4 + 2]! - b;
      return dr * dr + dg * dg + db * db <= sogliaSfondo;
    };
    if (bordo.filter((indice) => vicino(indice)).length / bordo.length < quotaBordoUniforme) {
      return undefined;
    }
    sfondo = vicino;
  }
  // 4-connected growth of the background from the border.
  const visto = new Uint8Array(totale);
  const coda = new Int32Array(totale);
  let testa = 0;
  let fine = 0;
  for (const indice of bordo) {
    if (visto[indice] === 0 && sfondo(indice)) {
      visto[indice] = 1;
      coda[fine++] = indice;
    }
  }
  while (testa < fine) {
    const indice = coda[testa++]!;
    const x = indice % larghezza;
    const vicini = [
      x > 0 ? indice - 1 : -1,
      x < larghezza - 1 ? indice + 1 : -1,
      indice >= larghezza ? indice - larghezza : -1,
      indice < totale - larghezza ? indice + larghezza : -1,
    ];
    for (const vicino of vicini) {
      if (vicino >= 0 && visto[vicino] === 0 && sfondo(vicino)) {
        visto[vicino] = 1;
        coda[fine++] = vicino;
      }
    }
  }
  let parte = 0;
  for (let indice = 0; indice < totale; indice++) {
    if (visto[indice] === 0) {
      dati[indice] = 1;
      parte++;
    }
  }
  const quota = parte / totale;
  return quota < quotaMinima || quota > quotaMassima ? undefined : { larghezza, altezza, dati };
}

/** The mask's box in 0–1000 (x0, y0, x1, y1), as the part sheet wants it. */
export function riquadroDellaMaschera(maschera: MascheraBinaria): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < maschera.altezza; y++) {
    for (let x = 0; x < maschera.larghezza; x++) {
      if (maschera.dati[y * maschera.larghezza + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < x0) {
    return [0, 0, 1000, 1000];
  }
  const nelMille = (valore: number, lato: number): number => Math.round((valore / lato) * 1000);
  return [
    nelMille(x0, maschera.larghezza),
    nelMille(y0, maschera.altezza),
    nelMille(x1 + 1, maschera.larghezza),
    nelMille(y1 + 1, maschera.altezza),
  ];
}

type ClientSinopia = Awaited<ReturnType<typeof getSinopiaDataClient>>['client'];

/** What the card gives: name, picture address, declared type and size. */
type Scheda = Readonly<{
  nome: string;
  immagineUrl: string;
  partType?: string;
  fonteTipo: 'libreria' | 'catalogo';
  larghezzaMm?: number;
  altezzaMm?: number;
}>;

async function leggiLibreria(client: ClientSinopia, id: string): Promise<Scheda> {
  const riga = await client
    .from('library_components')
    .select('id,name,name_it,type,image_url,width_mm,height_mm')
    .eq('id', id)
    .maybeSingle();
  const componente = libreriaSchema.safeParse(riga.data);
  if (riga.error !== null || !componente.success) {
    throw new ErroreParte('pezzoAssente');
  }
  const {
    name,
    name_it: nomeIt,
    type,
    image_url: immagineUrl,
    width_mm: larghezza,
    height_mm: altezza,
  } = componente.data;
  return {
    nome: (nomeIt?.trim() || name).slice(0, 200),
    immagineUrl,
    partType: type,
    fonteTipo: 'libreria',
    ...(larghezza === null ? {} : { larghezzaMm: larghezza }),
    ...(altezza === null ? {} : { altezzaMm: altezza }),
  };
}

async function leggiProdotto(client: ClientSinopia, id: string): Promise<Scheda> {
  const riga = await client.from('supplier_products').select('id,name,part_type').eq('id', id).maybeSingle();
  const prodotto = prodottoSchema.safeParse(riga.data);
  if (riga.error !== null || !prodotto.success) {
    throw new ErroreParte('pezzoAssente');
  }
  const foto = await client
    .from('supplier_product_images')
    .select('url,is_primary,sort_order')
    .eq('product_id', id)
    .order('sort_order', { ascending: true });
  const elenco = fotoSchema.safeParse(foto.data);
  const scelta = elenco.success ? (elenco.data.find((voce) => voce.is_primary) ?? elenco.data[0]) : undefined;
  if (foto.error !== null || scelta === undefined) {
    throw new ErroreParte('immagineAssente');
  }
  return {
    nome: prodotto.data.name.slice(0, 200),
    immagineUrl: scelta.url,
    ...(prodotto.data.part_type ? { partType: prodotto.data.part_type } : {}),
    fonteTipo: 'catalogo',
  };
}

/**
 * The card's picture: through Storage with the session; when the bucket is a public one the session may not list it,
 * so the public address of THIS Supabase project is tried as a second chance. No other origin is ever fetched.
 */
async function scaricaImmagine(client: ClientSinopia, indirizzo: string): Promise<Blob> {
  const posto = sinopiaImageLocation(indirizzo);
  if (posto === undefined) {
    throw new ErroreParte('immagineAssente');
  }
  const accettabile = (blob: Blob | null | undefined): blob is Blob =>
    !!blob && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(blob.type) && blob.size <= maxByte;
  const dalloStorage = await client.storage.from(posto.bucket).download(posto.path);
  if (dalloStorage.error === null && accettabile(dalloStorage.data)) {
    return dalloStorage.data;
  }
  const base = ENV.SINOPIA_SUPABASE_URL;
  if (posto.bucket !== 'creator-private' && base) {
    try {
      const url = `${base.replace(/\/$/u, '')}/storage/v1/object/public/${encodeURIComponent(posto.bucket)}/${posto.path
        .split('/')
        .map((parte) => encodeURIComponent(parte))
        .join('/')}`;
      const risposta = await fetch(url);
      const blob = risposta.ok ? await risposta.blob() : undefined;
      if (accettabile(blob)) {
        return blob;
      }
    } catch {
      // Falls through to the error below.
    }
  }
  throw new ErroreParte('immagineAssente');
}

/**
 * Build the part sheet of a Library or supplier-catalogue piece: its card, its picture, the mask cut out of the
 * photo, the declared type and the Library's declared size as the known scale.
 *
 * @param parametri - Which card (and an optional measure the designer knows).
 * @param strumenti - Image decoding and encoding, pixel reading, and SAM as a last resort.
 * @returns The sheet, the picture and the mask.
 */
export async function caricaSchedaPezzo(parametri: ParametriPezzo, strumenti: StrumentiParti): Promise<ParteCaricata> {
  const { client } = await getSinopiaDataClient();
  const scheda =
    parametri.origine === 'libreria'
      ? await leggiLibreria(client, parametri.id)
      : await leggiProdotto(client, parametri.id);
  const immagine = await scaricaImmagine(client, scheda.immagineUrl);
  const sha256 = await improntaDeiByte(await immagine.arrayBuffer());
  const { larghezza, altezza } = await strumenti.dimensioni(immagine);
  if (larghezza * altezza > maxPixel) {
    throw new ErroreParte('immagineTroppoGrande');
  }
  const prefisso = `${parametri.origine === 'libreria' ? 'libreria' : 'fornitore'}/${parametri.id}`;

  let maschera: MascheraBinaria | undefined;
  let png: Blob | undefined;
  let daSfondo = false;
  if (strumenti.pixel) {
    // Read at reduced size, then the mask PNG is drawn back at the picture's size (as every other mask is).
    const pixel = await strumenti.pixel(immagine, latoAnalisi);
    const piccola = mascheraDaSfondo(pixel.rgba, pixel.larghezza, pixel.altezza);
    if (piccola) {
      png = await strumenti.codificaMaschera(piccola);
      maschera = await strumenti.decodificaMaschera(png, larghezza, altezza);
      daSfondo = true;
    }
  }
  if (!maschera && strumenti.segmenta) {
    const daSam = await strumenti.segmenta(immagine, scheda.nome.toLowerCase());
    if (daSam) {
      png = daSam;
      maschera = await strumenti.decodificaMaschera(daSam, larghezza, altezza);
    }
  }
  if (!maschera || !png) {
    throw new ErroreParte('mascheraAssente');
  }

  const suggerito =
    scheda.partType ?? partTypeDaParole({ id: parametri.origine, etichetta: scheda.nome, nome: scheda.nome });
  const tipo = suggerito
    ? { partType: suggerito, fonte: scheda.partType ? scheda.fonteTipo : ('riconosci_parti' as const) }
    : undefined;
  const libreria =
    scheda.larghezzaMm === undefined && scheda.altezzaMm === undefined
      ? undefined
      : {
          ...(scheda.larghezzaMm === undefined ? {} : { larghezzaMm: scheda.larghezzaMm }),
          ...(scheda.altezzaMm === undefined ? {} : { altezzaMm: scheda.altezzaMm }),
        };
  const scala = scegliScala(
    {
      ...(parametri.misura ? { misura: parametri.misura } : {}),
      ...(libreria ? { libreria } : {}),
    },
    maschera,
  );
  const schedaParte = schedaParteSchema.parse({
    versione: 1,
    progetto: { id: parametri.id, verticale: 'accessories' },
    immagine: { bucket: 'creator-private', path: prefisso, sha256, larghezzaPx: larghezza, altezzaPx: altezza },
    parte: {
      id: parametri.origine,
      nome: scheda.nome,
      etichetta: scheda.nome,
      box: riquadroDellaMaschera(maschera),
    },
    maschera: {
      bucket: 'creator-private',
      path: `${prefisso}.${daSfondo ? 'sfondo' : 'sam'}.png`,
      origine: daSfondo ? 'contorno' : 'sam',
    },
    ...(tipo ? { tipo } : {}),
    ...(scala ? { scala } : {}),
    altreParti: [],
  });
  return { schedaParte, immagine, maschera, mascheraPng: png, ...(daSfondo ? { scontornoDaSfondo: true } : {}) };
}
