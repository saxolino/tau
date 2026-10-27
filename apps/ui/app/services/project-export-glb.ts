import { WebIO } from '@gltf-transform/core';
import type { Material, Primitive } from '@gltf-transform/core';
import { allExtensions } from '@taucad/geometry-core';
import type { ExportFile, GeometryComponentNode } from '@taucad/types';

/** The material a delivered piece carries in the GLB: the engine's key, its name, colour and finish. */
export type GlbPieceMaterial = Readonly<{
  chiave: string;
  nome: string;
  colore: string;
  metalness?: number;
  roughness?: number;
  /** The process the piece is made with, as the producibility checks name it. */
  processo?: string;
}>;

const triangles = 4;

/**
 * An sRGB hex colour as glTF's linear base colour factor (RGBA).
 * @param hex - `#rrggbb`.
 * @returns The linear factor.
 */
function linearColor(hex: string): [number, number, number, number] {
  const digits = hex.replace('#', '').padEnd(6, '0');
  const channel = (start: number): number => {
    const srgb = Number.parseInt(digits.slice(start, start + 2), 16) / 255;
    return srgb <= 4045e-5 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(2), channel(4), 1];
}

/**
 * Write each piece's material into the delivered GLB (E3a): a glTF material named after it, with its colour and
 * finish, on the piece's triangle primitives, and `extras.sinopiacad` (material and process) on the piece's nodes.
 * Edge lines keep their own colour. A mesh shared with a piece of another material is left as it is rather than
 * repainting both.
 *
 * @param file - The GLB as prepared for download (already reduced to the chosen pieces).
 * @param pieces - The pieces in the file, with their node indices.
 * @param materials - The material of each piece, by piece name; pieces without one stay as modelled.
 * @returns The GLB with the materials.
 */
export async function annotateGlbMaterials(
  file: ExportFile,
  pieces: readonly GeometryComponentNode[],
  materials: ReadonlyMap<string, GlbPieceMaterial>,
): Promise<ExportFile> {
  if (materials.size === 0) {
    return file;
  }
  const io = new WebIO().registerExtensions(allExtensions);
  const document = await io.readBinary(file.bytes);
  const nodes = document.getRoot().listNodes();
  const owner = new Map<Primitive, string>();
  for (const piece of pieces) {
    for (const index of piece.meshNodeIndices) {
      for (const primitive of nodes[index]?.getMesh()?.listPrimitives() ?? []) {
        const previous = owner.get(primitive);
        // A primitive two pieces share is marked as such and keeps its modelled material.
        owner.set(primitive, previous === undefined || previous === piece.name ? piece.name : '');
      }
    }
  }
  const created = new Map<string, Material>();
  const materialFor = (material: GlbPieceMaterial): Material => {
    const existing = created.get(material.chiave);
    if (existing) {
      return existing;
    }
    const made = document
      .createMaterial(material.nome)
      .setBaseColorFactor(linearColor(material.colore))
      .setMetallicFactor(material.metalness ?? 0)
      .setRoughnessFactor(material.roughness ?? 0.5)
      .setExtras({ sinopiacad: { materiale: material.chiave, nome: material.nome } });
    created.set(material.chiave, made);
    return made;
  };
  for (const piece of pieces) {
    const material = materials.get(piece.name);
    if (!material) {
      continue;
    }
    for (const index of piece.meshNodeIndices) {
      const node = nodes[index];
      if (!node) {
        continue;
      }
      node.setExtras({
        ...node.getExtras(),
        sinopiacad: {
          pezzo: piece.name,
          materiale: material.chiave,
          nomeMateriale: material.nome,
          ...(material.processo === undefined ? {} : { processo: material.processo }),
        },
      });
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        if (primitive.getMode() === triangles && owner.get(primitive) === piece.name) {
          primitive.setMaterial(materialFor(material));
        }
      }
    }
  }
  return { ...file, bytes: new Uint8Array(await io.writeBinary(document)) };
}
