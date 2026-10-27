import { Color } from 'three';
import type { Material } from 'three';
import { resolvePieceMaterialAppearance } from '#cad/piece-materials.js';
import type { PieceMaterialChoice } from '#cad/piece-materials.js';
import {
  getOrCaptureModelMaterialAppearance,
  updateCapturedModelMaterialBaseColor,
} from '#graphics/three/materials/model-component-appearance.js';

type PbrMaterial = Material & { color: Color; metalness: number; roughness: number };

type AuthoredPbr = Readonly<{ color: Color; metalness: number; roughness: number }>;

/** The model's own look of a surface a person has dressed in another material, kept to undo the choice. */
const authoredLooks = new WeakMap<Material, AuthoredPbr>();
const scratchColor = new Color();

function isPbrMaterial(material: Material): material is PbrMaterial {
  return (
    'color' in material &&
    material.color instanceof Color &&
    'metalness' in material &&
    typeof material.metalness === 'number' &&
    'roughness' in material &&
    typeof material.roughness === 'number'
  );
}

/**
 * Dress one surface material in a piece's chosen material, or give it back the model's own. The captured appearance
 * snapshot takes the new base colour, so hover, dimming and section caps restore to the chosen material rather than
 * the authored one. A matcap or other non-PBR material is left alone: its look is a viewing aid, not a material.
 *
 * @param material - A surface material of the piece.
 * @param choice - The chosen material, or `undefined` for the model's own.
 * @returns Whether the material changed.
 * @public
 */
export function applyPieceMaterialChoice(material: Material, choice: PieceMaterialChoice | undefined): boolean {
  if (!isPbrMaterial(material)) {
    return false;
  }
  const appearance = choice ? resolvePieceMaterialAppearance(choice) : undefined;
  const authored = authoredLooks.get(material);
  if (!appearance) {
    if (!authored) {
      return false;
    }
    authoredLooks.delete(material);
    material.metalness = authored.metalness;
    material.roughness = authored.roughness;
    updateCapturedModelMaterialBaseColor(material, authored.color.getHex());
    return true;
  }
  if (!authored) {
    const snapshot = getOrCaptureModelMaterialAppearance(material);
    authoredLooks.set(material, {
      color: (snapshot.color ?? material.color).clone(),
      metalness: material.metalness,
      roughness: material.roughness,
    });
  }
  const hex = scratchColor.set(appearance.color).getHex();
  const changed =
    material.metalness !== appearance.metalness ||
    material.roughness !== appearance.roughness ||
    getOrCaptureModelMaterialAppearance(material).color?.getHex() !== hex;
  material.metalness = appearance.metalness;
  material.roughness = appearance.roughness;
  updateCapturedModelMaterialBaseColor(material, hex);
  return changed;
}

/**
 * Whether a surface currently shows a chosen material instead of the model's own.
 *
 * @param material - A surface material.
 * @returns Whether a choice dresses it.
 * @public
 */
export function hasPieceMaterialChoice(material: Material): boolean {
  return authoredLooks.has(material);
}
