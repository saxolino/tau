import { describe, expect, it } from 'vitest';
import { Color, MeshMatcapMaterial, MeshStandardMaterial } from 'three';
import { applyPieceMaterialChoice, hasPieceMaterialChoice } from '#graphics/three/materials/piece-material-override.js';
import {
  applyModelMaterialAppearance,
  getOrCaptureModelMaterialAppearance,
} from '#graphics/three/materials/model-component-appearance.js';

describe('applyPieceMaterialChoice', () => {
  it('should dress a surface in the chosen material and give the model its own back', () => {
    const material = new MeshStandardMaterial({ color: new Color('#c29149'), metalness: 0.4, roughness: 0.7 });
    getOrCaptureModelMaterialAppearance(material);

    expect(applyPieceMaterialChoice(material, { material: 'silver-925', finish: 'satin' })).toBe(true);
    applyModelMaterialAppearance(material, getOrCaptureModelMaterialAppearance(material), 1);
    expect(material.metalness).toBe(1);
    expect(material.roughness).toBe(0.32);
    expect(material.color.getHexString()).toBe('f4f2ee');
    expect(hasPieceMaterialChoice(material)).toBe(true);

    // The same choice again changes nothing.
    expect(applyPieceMaterialChoice(material, { material: 'silver-925', finish: 'satin' })).toBe(false);

    expect(applyPieceMaterialChoice(material, undefined)).toBe(true);
    applyModelMaterialAppearance(material, getOrCaptureModelMaterialAppearance(material), 1);
    expect(material.metalness).toBe(0.4);
    expect(material.roughness).toBe(0.7);
    expect(material.color.getHexString()).toBe('c29149');
    expect(hasPieceMaterialChoice(material)).toBe(false);
  });

  it('should leave a matcap alone: it is a viewing aid, not a material', () => {
    const matcap = new MeshMatcapMaterial({ color: new Color('#ffffff') });
    expect(applyPieceMaterialChoice(matcap, { material: 'brass' })).toBe(false);
    expect(matcap.color.getHexString()).toBe('ffffff');
  });
});
