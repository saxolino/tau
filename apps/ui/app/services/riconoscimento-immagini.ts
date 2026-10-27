import { uint8ArrayToBase64 } from 'uint8array-extras';
import type { MascheraBinaria } from '@taucad/smlib/riconoscimento';
import { readSinopiaConfig } from '#lib/sinopia-session.js';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
import type { StrumentiParti } from '#services/sinopia-parts.js';

/**
 * The browser half of the recognition's images (canvas): read sizes and masks, encode a mask, and prepare the two
 * pictures the classifier reads (D2 §2.4): the part cropped (box + 15 %, long side 1024 px, the mask outline in red)
 * and the whole picture at 512 px with the box outlined.
 */

/**
 * The colour of the marks drawn INTO the model's input pictures (the mask outline and the box): pure red is what the
 * prompt names. Not an interface colour: nothing on screen is drawn with it.
 */
const coloreTracciaModello = 'rgb(255 0 0)';

/** The crop's margin around the part's box, per side (§2.4: box + 15 %). */
const margineRitaglio = 0.15;
/** Long side of the crop the model reads. */
const latoRitaglio = 1024;
/** Long side of the whole picture the model reads. */
const latoIntera = 512;

const tela = (larghezza: number, altezza: number): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(larghezza, altezza);
  }
  const canvas = document.createElement('canvas');
  canvas.width = larghezza;
  canvas.height = altezza;
  return canvas;
};

const contesto2d = (
  canvas: OffscreenCanvas | HTMLCanvasElement,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas 2D unavailable');
  }
  return context;
};

const inBlob = async (canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  canvas instanceof HTMLCanvasElement
    ? new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas encoding failed'));
            }
          },
          type,
          quality,
        );
      })
    : canvas.convertToBlob({ type, ...(quality === undefined ? {} : { quality }) });

/**
 * Base64 of a blob, without the data-URI prefix.
 *
 * @param blob - The bytes.
 * @returns Base64.
 */
export async function blobInBase64(blob: Blob): Promise<string> {
  return uint8ArrayToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Image decoding and encoding with the browser's canvas, for `caricaSchedaParte`. */
export const strumentiBrowser: StrumentiParti = {
  dimensioni: async (immagine) => {
    const bitmap = await createImageBitmap(immagine);
    const dimensioni = { larghezza: bitmap.width, altezza: bitmap.height };
    bitmap.close();
    return dimensioni;
  },
  decodificaMaschera: async (png, larghezza, altezza) => {
    const bitmap = await createImageBitmap(png);
    const canvas = tela(larghezza, altezza);
    const context = contesto2d(canvas);
    context.drawImage(bitmap, 0, 0, larghezza, altezza);
    bitmap.close();
    const { data } = context.getImageData(0, 0, larghezza, altezza);
    const dati = new Uint8Array(larghezza * altezza);
    for (let indice = 0; indice < dati.length; indice++) {
      // SAM: white = part. An alpha mask (transparent background) reads the same way.
      dati[indice] = data[indice * 4]! > 127 && data[indice * 4 + 3]! > 127 ? 1 : 0;
    }
    return { larghezza, altezza, dati };
  },
  codificaMaschera: async (maschera) => {
    const canvas = tela(maschera.larghezza, maschera.altezza);
    const context = contesto2d(canvas);
    const immagine = context.createImageData(maschera.larghezza, maschera.altezza);
    for (let indice = 0; indice < maschera.dati.length; indice++) {
      const valore = maschera.dati[indice] ? 255 : 0;
      immagine.data.set([valore, valore, valore, 255], indice * 4);
    }
    context.putImageData(immagine, 0, 0);
    return inBlob(canvas, 'image/png');
  },
  pixel: async (immagine, latoMassimo) => {
    const intero = await createImageBitmap(immagine);
    const fattore = Math.min(1, latoMassimo / Math.max(intero.width, intero.height));
    const larghezza = Math.max(2, Math.round(intero.width * fattore));
    const altezza = Math.max(2, Math.round(intero.height * fattore));
    const canvas = tela(larghezza, altezza);
    const context = contesto2d(canvas);
    context.drawImage(intero, 0, 0, larghezza, altezza);
    intero.close();
    return { larghezza, altezza, rgba: context.getImageData(0, 0, larghezza, altezza).data };
  },
  segmenta: async (immagine, query) => {
    // S-04: Sinopia's `segment-part` (SAM-3) with the shared session; same JWT, same storage rules as in the Studio.
    const config = readSinopiaConfig();
    if (!config || !query) {
      return undefined;
    }
    const { token } = await requireSinopiaUser();
    const response = await fetch(`${config.url.replace(/\/$/u, '')}/functions/v1/segment-part`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, apikey: config.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        image: { data: await blobInBase64(immagine), mimeType: immagine.type || 'image/png' },
        query,
      }),
    });
    if (!response.ok) {
      return undefined;
    }
    const corpo = (await response.json()) as { maskDataUrl?: unknown };
    if (typeof corpo.maskDataUrl !== 'string' || !corpo.maskDataUrl.startsWith('data:image/')) {
      return undefined;
    }
    const maschera = await fetch(corpo.maskDataUrl);
    return maschera.blob();
  },
};

/** The two pictures for the classifier and the crop's scale. */
export type ImmaginiRiconoscimento = Readonly<{
  ritaglio: Readonly<{ mediaType: 'image/jpeg'; data: string }>;
  intera: Readonly<{ mediaType: 'image/jpeg'; data: string }>;
  /** Crop pixels per original pixel. */
  fattoreRitaglio: number;
}>;

/**
 * The crop's rectangle in original pixels: the box (0–1000) with 15 % of its size added on each side, inside the
 * picture.
 *
 * @param box - The part's box, x0 y0 x1 y1 in 0–1000.
 * @param larghezza - Picture width.
 * @param altezza - Picture height.
 * @returns Left, top, width and height in pixels.
 */
export function rettangoloRitaglio(
  box: readonly [number, number, number, number],
  larghezza: number,
  altezza: number,
): Readonly<{ x: number; y: number; w: number; h: number }> {
  const [x0, y0, x1, y1] = [
    (box[0] * larghezza) / 1000,
    (box[1] * altezza) / 1000,
    (box[2] * larghezza) / 1000,
    (box[3] * altezza) / 1000,
  ];
  const mx = (x1 - x0) * margineRitaglio;
  const my = (y1 - y0) * margineRitaglio;
  const x = Math.max(0, Math.floor(x0 - mx));
  const y = Math.max(0, Math.floor(y0 - my));
  return {
    x,
    y,
    w: Math.max(1, Math.min(larghezza, Math.ceil(x1 + mx)) - x),
    h: Math.max(1, Math.min(altezza, Math.ceil(y1 + my)) - y),
  };
}

/**
 * Prepare the two pictures of the request (§2.4).
 *
 * @param immagine - The original picture.
 * @param maschera - The part's mask at the picture's size.
 * @param box - The part's box in 0–1000.
 * @returns The JPEG pictures in base64 and the crop's scale.
 */
export async function preparaImmaginiRiconoscimento(
  immagine: Blob,
  maschera: MascheraBinaria,
  box: readonly [number, number, number, number],
): Promise<ImmaginiRiconoscimento> {
  const bitmap = await createImageBitmap(immagine);
  const { width: larghezza, height: altezza } = bitmap;
  const rettangolo = rettangoloRitaglio(box, larghezza, altezza);
  const fattore = latoRitaglio / Math.max(rettangolo.w, rettangolo.h);
  const w = Math.max(1, Math.round(rettangolo.w * fattore));
  const h = Math.max(1, Math.round(rettangolo.h * fattore));
  const ritaglio = tela(w, h);
  const context = contesto2d(ritaglio);
  context.drawImage(bitmap, rettangolo.x, rettangolo.y, rettangolo.w, rettangolo.h, 0, 0, w, h);
  // The mask outline, about 2 px wide at the crop's resolution.
  const acceso = (cx: number, cy: number): boolean => {
    const sx = Math.floor(rettangolo.x + (cx + 0.5) / fattore);
    const sy = Math.floor(rettangolo.y + (cy + 0.5) / fattore);
    return (
      sx >= 0 &&
      sy >= 0 &&
      sx < maschera.larghezza &&
      sy < maschera.altezza &&
      maschera.dati[sy * maschera.larghezza + sx] === 1
    );
  };
  const pixel = context.getImageData(0, 0, w, h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      if (
        acceso(cx, cy) &&
        (!acceso(cx - 1, cy) || !acceso(cx + 1, cy) || !acceso(cx, cy - 1) || !acceso(cx, cy + 1))
      ) {
        pixel.data.set([255, 0, 0, 255], (cy * w + cx) * 4);
      }
    }
  }
  context.putImageData(pixel, 0, 0);
  const scalaIntera = latoIntera / Math.max(larghezza, altezza);
  const intera = tela(Math.max(1, Math.round(larghezza * scalaIntera)), Math.max(1, Math.round(altezza * scalaIntera)));
  const contestoIntera = contesto2d(intera);
  contestoIntera.drawImage(bitmap, 0, 0, intera.width, intera.height);
  contestoIntera.strokeStyle = coloreTracciaModello;
  contestoIntera.lineWidth = 2;
  contestoIntera.strokeRect(
    (box[0] / 1000) * intera.width,
    (box[1] / 1000) * intera.height,
    ((box[2] - box[0]) / 1000) * intera.width,
    ((box[3] - box[1]) / 1000) * intera.height,
  );
  bitmap.close();
  return {
    ritaglio: { mediaType: 'image/jpeg', data: await blobInBase64(await inBlob(ritaglio, 'image/jpeg', 0.9)) },
    intera: { mediaType: 'image/jpeg', data: await blobInBase64(await inBlob(intera, 'image/jpeg', 0.9)) },
    fattoreRitaglio: Number(fattore.toFixed(4)),
  };
}
