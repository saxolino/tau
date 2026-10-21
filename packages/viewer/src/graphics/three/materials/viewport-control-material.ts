import type { Texture } from 'three';
import { MeshBasicMaterial } from 'three';
import { positionLocal } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { ResolvedGraphicsBackend } from '#graphics/graphics-settings.js';

export function createViewportControlLabelMaterial({
  map,
  backend = 'webgl',
}: {
  readonly map: Texture;
  readonly backend?: ResolvedGraphicsBackend;
}): MeshBasicMaterial | MeshBasicNodeMaterial {
  const parameters = {
    map,
    color: 0x00_00_00,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 1,
    fog: false,
    toneMapped: false,
  };
  const material = backend === 'webgpu' ? new MeshBasicNodeMaterial(parameters) : new MeshBasicMaterial(parameters);
  if (material instanceof MeshBasicNodeMaterial) {
    // Three r184's observer can skip a shared label's transform refresh after
    // transparent draw order changes. Keep moving billboards on the node path,
    // as for the picker tiles. The revision/source guard lives with the picker.
    material.positionNode = positionLocal;
  }
  return material;
}

export function createViewportControlSelectorLabelMaterial({ map }: { readonly map: Texture }): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    color: 0x00_00_00,
    alphaTest: 0,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    opacity: 1,
    fog: false,
    toneMapped: false,
  });
}
