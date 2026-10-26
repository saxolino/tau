import { describe, expect, it } from 'vitest';
import type { GeometryComponentNode } from '@taucad/types';
import { modelWeight, pieceVolumeMm3, pieceWeight } from '#lib/piece-weight.js';

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const piece = (name: string, extras?: GeometryComponentNode['extras']): GeometryComponentNode => ({
  id: `component:${name}`,
  name,
  kind: 'part',
  extras,
  selector: name,
  childIds: [],
  depth: 1,
  path: [name],
  meshNodeIndices: [],
  primitiveIndices: [],
  materialIndices: [],
  capabilities,
});

describe('pieceWeight', () => {
  it('should weigh the solid volume with the chosen material first', () => {
    const frame = piece('telaio', { volumeMm3: 2366, density: 8.5 });
    expect(pieceWeight(frame, { material: 'gold-18k-yellow' })).toEqual({
      grams: (2366 / 1000) * 15.5,
      volumeMm3: 2366,
      density: 15.5,
      source: 'chosen',
    });
    // Without a choice, the density written in the model.
    expect(pieceWeight(frame, undefined)).toMatchObject({ grams: (2366 / 1000) * 8.5, source: 'model' });
  });

  it('should say nothing without a volume or a density', () => {
    expect(pieceWeight(piece('a'), { material: 'brass' })).toBeUndefined();
    expect(pieceWeight(piece('b', { volumeMm3: 100 }), undefined)).toBeUndefined();
    expect(pieceWeight(piece('c', { volumeMm3: -3 }), { material: 'brass' })).toBeUndefined();
    expect(pieceVolumeMm3(piece('d', { volumeMm3: '12' }))).toBeUndefined();
  });
});

describe('modelWeight', () => {
  const frame = piece('telaio', { volumeMm3: 2366 });
  const pin = piece('ardiglione', { volumeMm3: 167 });
  const stone = piece('pietra', { role: 'stone', volumeMm3: 30 });

  it('should total every piece and name the material they share', () => {
    const shared = { [frame.id]: { material: 'silver-925' }, [pin.id]: { material: 'silver-925' } } as const;
    expect(modelWeight([frame, pin, stone], shared)).toEqual({
      grams: ((2366 + 167) / 1000) * 10.36,
      material: 'silver-925',
    });
    const mixed = { [frame.id]: { material: 'brass' }, [pin.id]: { material: 'stainless-steel' } } as const;
    expect(modelWeight([frame, pin], mixed)).toEqual({ grams: 2.366 * 8.5 + 0.167 * 7.9 });
  });

  it('should give no total while a piece cannot be weighed', () => {
    expect(modelWeight([frame, pin], { [frame.id]: { material: 'brass' } })).toBeUndefined();
    expect(modelWeight([stone], {})).toBeUndefined();
  });
});
