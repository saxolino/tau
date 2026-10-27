import type { RasterFoto, SagomaFoto } from '#lib/foto-campione/mappe-condivise.js';

/**
 * The acceptance measure of the sample photo (SinopiaCAD D6): the photo's silhouette against the render's, as IoU. The
 * photos are asked on a pure white seamless background, so the silhouette is what differs from the background: the
 * median colour of the picture's border ring, with a tolerance that keeps a faint contact shadow out.
 */

/** Below this the photo's shape may differ from the model: the gallery says so next to the photo. */
export const sogliaIouFoto = 0.95;

/** A pixel belongs to the object when one channel differs from the background by more than this (0–255). */
const tolleranzaFondo = 40;

const mediana = (valori: number[]): number => {
  const ordinati = [...valori].sort((a, b) => a - b);
  return ordinati[Math.floor(ordinati.length / 2)] ?? 255;
};

/**
 * The silhouette of a photo, brought to the side of the render's maps (nearest pixel: the photo is square like them).
 *
 * @param immagine - The decoded photo (1–4 channels).
 * @param lato - The side of the render's silhouette.
 * @returns The binary silhouette at `lato` × `lato`.
 */
export function sagomaDaFoto(immagine: RasterFoto, lato: number): SagomaFoto {
  const { larghezza, altezza, canali, dati } = immagine;
  const colore = canali >= 3 ? 3 : 1;
  const alfa = canali === 2 || canali === 4 ? canali - 1 : undefined;
  const anello: number[][] = Array.from({ length: colore }, () => []);
  const campiona = (x: number, y: number): void => {
    const p = (y * larghezza + x) * canali;
    for (let c = 0; c < colore; c++) {
      anello[c]!.push(dati[p + c]!);
    }
  };
  for (let x = 0; x < larghezza; x++) {
    campiona(x, 0);
    campiona(x, altezza - 1);
  }
  for (let y = 1; y < altezza - 1; y++) {
    campiona(0, y);
    campiona(larghezza - 1, y);
  }
  const fondo = anello.map(mediana);
  const uscita = new Uint8Array(lato * lato);
  for (let y = 0; y < lato; y++) {
    const sy = Math.min(altezza - 1, Math.floor(((y + 0.5) * altezza) / lato));
    for (let x = 0; x < lato; x++) {
      const sx = Math.min(larghezza - 1, Math.floor(((x + 0.5) * larghezza) / lato));
      const p = (sy * larghezza + sx) * canali;
      if (alfa !== undefined && dati[p + alfa]! < 128) {
        continue;
      }
      let diversa = false;
      for (let c = 0; c < colore && !diversa; c++) {
        diversa = Math.abs(dati[p + c]! - fondo[c]!) > tolleranzaFondo;
      }
      uscita[y * lato + x] = diversa ? 1 : 0;
    }
  }
  return { larghezza: lato, altezza: lato, dati: uscita };
}
