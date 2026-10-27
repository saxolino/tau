import { describe, expect, it } from 'vitest';
import type { GeometryComponentBounds, GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import { pieceCaption, placeCallouts } from '#lib/montaggio.js';

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};

/** A piece whose glTF bounds (Y-up metres) measure `size` millimetres along X, Y and Z. */
const piece = (name: string, size?: readonly [number, number, number]): GeometryComponentNode => {
  const bounds: GeometryComponentBounds | undefined = size
    ? {
        min: [0, 0, 0],
        max: [size[0] / 1000, size[2] / 1000, size[1] / 1000],
        center: [size[0] / 2000, size[2] / 2000, size[1] / 2000],
        radius: 1,
      }
    : undefined;
  return {
    id: `component:${name}`,
    name,
    kind: 'part',
    selector: name,
    childIds: [],
    depth: 1,
    path: [name],
    meshNodeIndices: [],
    primitiveIndices: [],
    materialIndices: [],
    capabilities,
    ...(bounds ? { bounds } : {}),
  };
};

const manifestOf = (...nodes: GeometryComponentNode[]): GeometryComponentManifest => ({
  schemaVersion: 1,
  rootId: 'root',
  nodeOrder: nodes.map((node) => node.id),
  nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
  capabilities,
});

describe('pieceCaption', () => {
  const telaio = piece('Telaio', [38, 32, 3.5]);
  const ardiglione = piece('Ardiglione', [30, 2.5, 2.5]);
  const manifest = manifestOf(telaio, ardiglione);

  it('should give the measure the Measures pane shows for the piece', () => {
    const defaults = { telaio: { lunghezza: 38, larghezza: 32 }, ardiglione: { diametro: 2.5 } };

    expect(pieceCaption({ node: telaio, manifest, defaults, values: {}, language: 'it' })).toEqual({
      name: 'Telaio',
      measure: '38 × 32',
    });
    expect(pieceCaption({ node: ardiglione, manifest, defaults, values: {}, language: 'it' })).toEqual({
      name: 'Ardiglione',
      measure: '⌀ 2,5',
    });
  });

  it('should prefer the piece’s current value over its default', () => {
    const defaults = { ardiglione: { diametro: 2.5 } };

    expect(
      pieceCaption({ node: ardiglione, manifest, defaults, values: { ardiglione: { diametro: 3 } }, language: 'en' })
        .measure,
    ).toBe('⌀ 3');
  });

  it('should fall back to the two largest sides of the piece’s size', () => {
    expect(pieceCaption({ node: telaio, manifest, defaults: {}, values: {}, language: 'it' }).measure).toBe('38 × 32');
    expect(pieceCaption({ node: ardiglione, manifest, defaults: {}, values: {}, language: 'en' }).measure).toBe(
      '30 × 2.5',
    );
  });

  it('should name a piece without a measure when it has neither parameters nor size', () => {
    const traversa = piece('traversa_dx');

    expect(
      pieceCaption({ node: traversa, manifest: manifestOf(traversa), defaults: {}, values: {}, language: 'it' }),
    ).toEqual({ name: 'Traversa destra', measure: undefined });
  });
});

describe('placeCallouts', () => {
  const canvas = { width: 800, height: 600 };

  it('should place a label just right of its piece, centred on it', () => {
    expect(placeCallouts([{ id: 'a', x: 300, y: 200, width: 100, height: 40 }], canvas)).toEqual([
      { id: 'a', left: 310, top: 180 },
    ]);
  });

  it('should move a label down until it covers no label placed before it', () => {
    const placed = placeCallouts(
      [
        { id: 'telaio', x: 400, y: 300, width: 100, height: 40 },
        { id: 'traversa', x: 400, y: 300, width: 100, height: 40 },
        { id: 'ardiglione', x: 420, y: 310, width: 100, height: 40 },
      ],
      canvas,
    );

    expect(placed.map((label) => label.top)).toEqual([280, 324, 368]);
  });

  it('should keep labels on the canvas and above the viewer’s bar', () => {
    expect(placeCallouts([{ id: 'a', x: 790, y: 590, width: 100, height: 40 }], canvas)).toEqual([
      { id: 'a', left: 692, top: 504 },
    ]);
  });
});
