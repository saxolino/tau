import { describe, expect, it } from 'vitest';
import {
  estimatePieceWeightGrams,
  findPieceMaterial,
  normalizePieceMaterialChoice,
  pieceMaterials,
  resolvePieceMaterialAppearance,
} from '#cad/piece-materials.js';

describe('piece materials', () => {
  it('should carry the densities the weight is estimated with', () => {
    const densities = Object.fromEntries(pieceMaterials.map(({ id, density }) => [id, density]));
    expect(densities).toEqual({
      'gold-18k-yellow': 15.5,
      'gold-18k-rose': 15,
      'gold-18k-white': 15.9,
      'silver-925': 10.36,
      brass: 8.5,
      zamak: 6.6,
      'stainless-steel': 7.9,
      'palladium-plated': 6.6,
      'gunmetal-plated': 6.6,
      leather: 0.9,
      rubber: 1.15,
      tr: 0.98,
      tpu: 1.2,
      abs: 1.05,
    });
    // A galvanic finish is weighed as the zamak it covers.
    expect(findPieceMaterial('gunmetal-plated')?.platedOn).toBe('zamak');
    expect(findPieceMaterial('gunmetal-plated')?.density).toBe(findPieceMaterial('zamak')?.density);
  });

  it('should weigh a solid as volume × density, in grams', () => {
    // The fixture buckle's frame: 2366 mm³.
    expect(estimatePieceWeightGrams(2366, 'gold-18k-yellow')).toBeCloseTo(36.673, 3);
    expect(estimatePieceWeightGrams(2366, 'silver-925')).toBeCloseTo(24.512, 3);
    expect(estimatePieceWeightGrams(2366, 'brass')).toBeCloseTo(20.111, 3);
    expect(estimatePieceWeightGrams(1000, 'leather')).toBeCloseTo(0.9, 6);
    expect(estimatePieceWeightGrams(0, 'brass')).toBeUndefined();
    expect(estimatePieceWeightGrams(Number.NaN, 'brass')).toBeUndefined();
    expect(estimatePieceWeightGrams(undefined, 'brass')).toBeUndefined();
    expect(estimatePieceWeightGrams(100, 'unobtainium')).toBeUndefined();
  });

  it('should map the three finishes to roughness on metals only', () => {
    const roughness = (finish: 'polished' | 'satin' | 'sandblasted'): number | undefined =>
      resolvePieceMaterialAppearance({ material: 'gold-18k-yellow', finish })?.roughness;
    expect(roughness('polished')).toBeLessThan(roughness('satin')!);
    expect(roughness('satin')).toBeLessThan(roughness('sandblasted')!);
    expect(resolvePieceMaterialAppearance({ material: 'brass' })).toMatchObject({ metalness: 1, roughness: 0.1 });
    // A finish on leather is ignored: its own roughness, no metal.
    expect(resolvePieceMaterialAppearance({ material: 'leather', finish: 'polished' })).toEqual({
      color: '#8a5a3b',
      metalness: 0,
      roughness: 0.62,
    });
    expect(resolvePieceMaterialAppearance({ material: 'unknown' as 'brass' })).toBeUndefined();
  });

  it('should normalize stored choices', () => {
    expect(normalizePieceMaterialChoice({ material: 'brass', finish: 'satin' })).toEqual({
      material: 'brass',
      finish: 'satin',
    });
    expect(normalizePieceMaterialChoice({ material: 'brass', finish: 'mirror' })).toEqual({ material: 'brass' });
    expect(normalizePieceMaterialChoice({ material: 'rubber', finish: 'satin' })).toEqual({ material: 'rubber' });
    expect(normalizePieceMaterialChoice({ material: 'gold' })).toBeUndefined();
    expect(normalizePieceMaterialChoice('brass')).toBeUndefined();
    expect(normalizePieceMaterialChoice(undefined)).toBeUndefined();
  });
});
