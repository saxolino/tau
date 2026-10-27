/**
 * The materials a piece can be shown and weighed in: precious and base alloys for jewellery and shoe hardware, and the
 * non-metals of shoe components. One table owns the look (physically based: a metal's colour is its reflectance) and
 * the density the weight is estimated with, so the picture and the grams never disagree.
 */

/**
 * The finish of a metal surface. Non-metals keep their own roughness.
 *
 * @public
 */
export type PieceFinish = 'polished' | 'satin' | 'sandblasted';

/**
 * Every finish in the order an interface offers them.
 *
 * @public
 */
export const pieceFinishes: readonly PieceFinish[] = ['polished', 'satin', 'sandblasted'];

/**
 * Identifies one entry of {@link pieceMaterials}.
 *
 * @public
 */
export type PieceMaterialId =
  | 'gold-18k-yellow'
  | 'gold-18k-rose'
  | 'gold-18k-white'
  | 'silver-925'
  | 'brass'
  | 'zamak'
  | 'stainless-steel'
  | 'palladium-plated'
  | 'gunmetal-plated'
  | 'leather'
  | 'rubber'
  | 'tr'
  | 'tpu'
  | 'abs';

/**
 * A material a person picks for a piece.
 *
 * @public
 */
export type PieceMaterial = Readonly<{
  id: PieceMaterialId;
  kind: 'metal' | 'non-metal';
  /** Hex colour in sRGB. For a metal this is its reflectance at normal incidence, not a paint colour. */
  color: string;
  /** Density in g/cm³, the value the weight is estimated with. */
  density: number;
  /** Roughness of a non-metal; a metal's comes from its finish. */
  roughness?: number;
  /** The base alloy whose density a galvanic finish is weighed with. */
  platedOn?: PieceMaterialId;
}>;

/**
 * A piece's chosen material and, for a metal, its finish.
 *
 * @public
 */
export type PieceMaterialChoice = Readonly<{
  material: PieceMaterialId;
  finish?: PieceFinish;
}>;

/**
 * The material table. Densities: 18 kt gold yellow 15.5, rose 15.0, white (palladium) 15.9 g/cm³; sterling silver
 * 10.36; brass 8.5; zamak 6.6; stainless steel 7.9; leather 0.9; rubber 1.15; TR 0.98; TPU 1.2; ABS 1.05. Galvanic
 * finishes are weighed as the zamak they cover, the usual base of plated shoe hardware.
 *
 * @public
 */
export const pieceMaterials: readonly PieceMaterial[] = [
  { id: 'gold-18k-yellow', kind: 'metal', color: '#f6cf86', density: 15.5 },
  { id: 'gold-18k-rose', kind: 'metal', color: '#f1c0a6', density: 15 },
  { id: 'gold-18k-white', kind: 'metal', color: '#e4e2de', density: 15.9 },
  { id: 'silver-925', kind: 'metal', color: '#f4f2ee', density: 10.36 },
  { id: 'brass', kind: 'metal', color: '#e2c98f', density: 8.5 },
  { id: 'zamak', kind: 'metal', color: '#c4c6c7', density: 6.6 },
  { id: 'stainless-steel', kind: 'metal', color: '#c9cbcd', density: 7.9 },
  { id: 'palladium-plated', kind: 'metal', color: '#d9d5ce', density: 6.6, platedOn: 'zamak' },
  { id: 'gunmetal-plated', kind: 'metal', color: '#80848b', density: 6.6, platedOn: 'zamak' },
  { id: 'leather', kind: 'non-metal', color: '#8a5a3b', density: 0.9, roughness: 0.62 },
  { id: 'rubber', kind: 'non-metal', color: '#2c2a28', density: 1.15, roughness: 0.86 },
  { id: 'tr', kind: 'non-metal', color: '#3b3734', density: 0.98, roughness: 0.72 },
  { id: 'tpu', kind: 'non-metal', color: '#d3cfc7', density: 1.2, roughness: 0.42 },
  { id: 'abs', kind: 'non-metal', color: '#ebe7df', density: 1.05, roughness: 0.48 },
];

const materialsById = new Map<string, PieceMaterial>(pieceMaterials.map((material) => [material.id, material]));

/** Polished reflects the studio's soft boxes; satin blurs them; sandblasted keeps only the light's direction. */
const finishRoughness: Readonly<Record<PieceFinish, number>> = {
  polished: 0.1,
  satin: 0.32,
  sandblasted: 0.56,
};

/**
 * Find a material by id.
 *
 * @param id - A material id, possibly from a stored record.
 * @returns The material, or `undefined` for an unknown id.
 * @public
 */
export function findPieceMaterial(id: string | undefined): PieceMaterial | undefined {
  return id === undefined ? undefined : materialsById.get(id);
}

/**
 * Whether a value names a material in the table.
 *
 * @param id - The value to check.
 * @returns Whether it is a {@link PieceMaterialId}.
 * @public
 */
export function isPieceMaterialId(id: unknown): id is PieceMaterialId {
  return typeof id === 'string' && materialsById.has(id);
}

/**
 * Whether a value names a finish.
 *
 * @param finish - The value to check.
 * @returns Whether it is a {@link PieceFinish}.
 * @public
 */
export function isPieceFinish(finish: unknown): finish is PieceFinish {
  return finish === 'polished' || finish === 'satin' || finish === 'sandblasted';
}

/**
 * The physically based look of a choice: colour, metalness and roughness. A metal without a finish is polished; a
 * finish on a non-metal is ignored.
 *
 * @param choice - The piece's material and finish.
 * @returns The appearance, or `undefined` for an unknown material.
 * @public
 */
export function resolvePieceMaterialAppearance(
  choice: PieceMaterialChoice,
): Readonly<{ color: string; metalness: number; roughness: number }> | undefined {
  const material = findPieceMaterial(choice.material);
  if (!material) {
    return undefined;
  }
  if (material.kind === 'non-metal') {
    return { color: material.color, metalness: 0, roughness: material.roughness ?? 0.6 };
  }
  return { color: material.color, metalness: 1, roughness: finishRoughness[choice.finish ?? 'polished'] };
}

/**
 * Estimate a piece's weight from its solid volume and its material's density.
 *
 * @param volumeMm3 - The solid's volume in cubic millimetres.
 * @param material - The material id.
 * @returns Grams, or `undefined` when the volume is not a positive finite number or the material is unknown.
 * @public
 */
export function estimatePieceWeightGrams(
  volumeMm3: number | undefined,
  material: string | undefined,
): number | undefined {
  const density = findPieceMaterial(material)?.density;
  if (density === undefined || volumeMm3 === undefined || !Number.isFinite(volumeMm3) || volumeMm3 <= 0) {
    return undefined;
  }
  // 1 cm³ = 1000 mm³.
  return (volumeMm3 / 1000) * density;
}

/**
 * Normalize a stored choice: an unknown material is dropped, and a finish only stays on a metal.
 *
 * @param value - A choice from a record or an event.
 * @returns The valid choice, or `undefined`.
 * @public
 */
export function normalizePieceMaterialChoice(value: unknown): PieceMaterialChoice | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { material, finish } = value as { material?: unknown; finish?: unknown };
  if (!isPieceMaterialId(material)) {
    return undefined;
  }
  return findPieceMaterial(material)?.kind === 'metal' && isPieceFinish(finish) ? { material, finish } : { material };
}
