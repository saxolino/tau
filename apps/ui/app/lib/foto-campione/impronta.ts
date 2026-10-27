import type { PieceFinish, PieceMaterialId } from '@taucad/viewer/cad/piece-materials';
import { findPieceMaterial } from '@taucad/viewer/cad/piece-materials';
import { improntaFotoCampione } from '#lib/foto-campione/mappe-condivise.js';
import type { VistaFoto } from '#lib/foto-campione/mappe-condivise.js';

/** The two levels of the sample photo: Standard (Nano Banana 2.1) and Fedele (FLUX with depth control). */
export const livelliFoto = ['standard', 'fedele'] as const;
export type LivelloFoto = (typeof livelliFoto)[number];

/** The material of a photo: a piece material and, for a metal, its finish. */
export type MaterialeFoto = Readonly<{ id: PieceMaterialId; finitura?: PieceFinish }>;

/**
 * A finish only means something on a metal, and a metal without one is polished: the same look gives the same
 * fingerprint whichever way it was written.
 *
 * @param materiale - The chosen material.
 * @returns The normalised material.
 */
export function materialeNormale(materiale: MaterialeFoto): MaterialeFoto {
  return findPieceMaterial(materiale.id)?.kind === 'metal'
    ? { id: materiale.id, finitura: materiale.finitura ?? 'polished' }
    : { id: materiale.id };
}

/**
 * The fingerprint of a sample photo, the cache key the Creator's `input-hash.ts` is for its nodes: everything that
 * changes the picture and only that. `glb` is the SHA-256 of the GLB of the version sent to Sinopia — the bytes Sinopia
 * renders the maps from — so a new delivery turns the photos of the old one «da rifare». Sinopia computes the same
 * fingerprint with the same twin function (`mappe-condivise.ts`) from the same bytes.
 *
 * @param ingresso - GLB fingerprint, view, material and level.
 * @returns 64 lowercase hexadecimal digits.
 */
export async function improntaFoto(
  ingresso: Readonly<{ glb: string; vista: VistaFoto; materiale: MaterialeFoto; livello: LivelloFoto }>,
): Promise<string> {
  return improntaFotoCampione({ ...ingresso, materiale: materialeNormale(ingresso.materiale) });
}
