import { codificaPng, decodificaPng } from '@taucad/smlib/verifica';
import type { ImmagineRaster } from '@taucad/smlib/verifica';
import type { MappeFoto } from '#lib/foto-campione/mappe.js';
import type { MappePng } from '#services/sinopia-foto.js';

/**
 * Browser glue of the sample photo: the maps as PNG for the request, and a received photo (PNG, JPEG or WebP, as the
 * image model returned it) as pixels for the silhouette check.
 */

/**
 * Encode the four maps (grey, grey, RGB, grey): the colour types the function checks.
 *
 * @param mappe - The rendered maps.
 * @returns The PNG bytes.
 */
export async function mappeInPng(mappe: MappeFoto): Promise<MappePng> {
  const [ombreggiata, profondita, normali, bordi] = await Promise.all([
    codificaPng(mappe.ombreggiata),
    codificaPng(mappe.profondita),
    codificaPng(mappe.normali),
    codificaPng(mappe.bordi),
  ]);
  return { ombreggiata, profondita, normali, bordi };
}

const isPng = (bytes: Uint8Array): boolean => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;

/**
 * Decode a photo into pixels: PNG without a canvas, the other formats through the browser's decoder.
 *
 * @param bytes - The image file.
 * @returns RGBA (or the PNG's own channels).
 */
export async function decodificaFoto(bytes: Uint8Array<ArrayBuffer>): Promise<ImmagineRaster> {
  if (isPng(bytes)) {
    try {
      return await decodificaPng(bytes);
    } catch {
      /* An interlaced PNG: the browser's decoder below reads it. */
    }
  }
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const tela = new OffscreenCanvas(bitmap.width, bitmap.height);
    const contesto = tela.getContext('2d');
    if (!contesto) {
      throw new Error('Sample photo: no 2D context to decode the photo.');
    }
    contesto.drawImage(bitmap, 0, 0);
    const { data } = contesto.getImageData(0, 0, bitmap.width, bitmap.height);
    return { larghezza: bitmap.width, altezza: bitmap.height, canali: 4, dati: data };
  } finally {
    bitmap.close();
  }
}
