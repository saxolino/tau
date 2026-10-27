import { findPieceMaterial } from '@taucad/viewer/cad/piece-materials';
import type { ImmagineRaster } from '@taucad/smlib/verifica';
import type { LivelloFoto, MaterialeFoto } from '#lib/foto-campione/impronta.js';
import type { MappeFoto } from '#lib/foto-campione/mappe.js';

/**
 * The fake generator of the development trial (`?prova=foto`, development builds only): no Sinopia, no model call, no
 * credit. It paints the shaded map in the material's colour on white — a stand-in for the photo, so the gallery, the
 * states and the IoU check run as they will with the real one. «Standard» drifts 4 % larger around the centre, the way
 * an image model may: its IoU falls under 0.95 and the warning shows; «Fedele» keeps the silhouette.
 */
export function fotoDiProva(mappe: MappeFoto, materiale: MaterialeFoto, livello: LivelloFoto): ImmagineRaster {
  const { lato, ombreggiata, sagoma } = mappe;
  const voce = findPieceMaterial(materiale.id);
  const esadecimale = (voce?.color ?? '#b3a895').replace('#', '');
  const base = [0, 2, 4].map((k) => Number.parseInt(esadecimale.slice(k, k + 2), 16));
  const metallo = voce?.kind === 'metal';
  const deriva = livello === 'standard' ? 1.04 : 1;
  const dati = new Uint8Array(lato * lato * 3).fill(255);
  for (let y = 0; y < lato; y++) {
    const sy = Math.floor((y + 0.5 - lato / 2) / deriva + lato / 2);
    for (let x = 0; x < lato; x++) {
      const sx = Math.floor((x + 0.5 - lato / 2) / deriva + lato / 2);
      if (sx < 0 || sy < 0 || sx >= lato || sy >= lato) {
        continue;
      }
      const sorgente = sy * lato + sx;
      if (sagoma.dati[sorgente] !== 1) {
        continue;
      }
      const tono = ombreggiata.dati[sorgente]! / 255;
      const lucentezza = metallo ? tono ** 6 * 0.55 : 0;
      for (let c = 0; c < 3; c++) {
        const valore = base[c]! * (0.25 + 1.05 * tono) + 255 * lucentezza;
        dati[(y * lato + x) * 3 + c] = Math.round(Math.min(250, Math.max(6, valore)));
      }
    }
  }
  return { larghezza: lato, altezza: lato, canali: 3, dati };
}
