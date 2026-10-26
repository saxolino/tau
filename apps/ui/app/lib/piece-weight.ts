import type { GeometryComponentNode } from '@taucad/types';
import { estimatePieceWeightGrams, findPieceMaterial } from '@taucad/viewer/cad/piece-materials';
import type { PieceMaterialChoice, PieceMaterialId } from '@taucad/viewer/cad/piece-materials';
import { isStonePiece } from '#lib/piece-measures.js';

/**
 * A piece's estimated weight and what it rests on: the exact solid volume the kernel measured and a density, either
 * of the material the person picked or the one written in the model.
 */
export type PieceWeight = Readonly<{
  grams: number;
  volumeMm3: number;
  density: number;
  source: 'chosen' | 'model';
}>;

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/** The solid volume the kernel measured for a piece, in mm³. */
export const pieceVolumeMm3 = (node: GeometryComponentNode): number | undefined => positive(node.extras?.['volumeMm3']);

/**
 * Weigh one piece: the chosen material's density first, then the model's own.
 *
 * @param node - The piece.
 * @param choice - The material the person picked, if any.
 * @returns The weight, or `undefined` without a volume or a density.
 */
export const pieceWeight = (
  node: GeometryComponentNode,
  choice: PieceMaterialChoice | undefined,
): PieceWeight | undefined => {
  const volumeMm3 = pieceVolumeMm3(node);
  if (volumeMm3 === undefined) {
    return undefined;
  }
  const chosen = findPieceMaterial(choice?.material);
  if (chosen) {
    const grams = estimatePieceWeightGrams(volumeMm3, chosen.id);
    return grams === undefined ? undefined : { grams, volumeMm3, density: chosen.density, source: 'chosen' };
  }
  const density = positive(node.extras?.['density']);
  return density === undefined
    ? undefined
    : { grams: (volumeMm3 / 1000) * density, volumeMm3, density, source: 'model' };
};

/**
 * The model's total weight, only when every piece that is not a stone can be weighed; with the material when they all
 * share one picked material.
 *
 * @param pieces - The model's pieces.
 * @param materials - The picked material per piece id.
 * @returns The total and the shared material, or `undefined`.
 */
export const modelWeight = (
  pieces: readonly GeometryComponentNode[],
  materials: Readonly<Record<string, PieceMaterialChoice>>,
): { grams: number; material?: PieceMaterialId } | undefined => {
  const metals = pieces.filter((node) => !isStonePiece(node));
  if (metals.length === 0) {
    return undefined;
  }
  let grams = 0;
  for (const node of metals) {
    const weight = pieceWeight(node, materials[node.id]);
    if (!weight) {
      return undefined;
    }
    grams += weight.grams;
  }
  const picked = new Set(metals.map((node) => materials[node.id]?.material));
  const [shared] = picked;
  return picked.size === 1 && shared !== undefined ? { grams, material: shared } : { grams };
};
