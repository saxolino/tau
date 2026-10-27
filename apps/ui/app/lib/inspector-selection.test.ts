import { describe, expect, it } from 'vitest';
import type { ManualDocument, ManualOperation } from '@taucad/smlib/manual-operations';
import type { GeometryComponentNode } from '@taucad/types';
import { bindTranslate } from '#i18n/translate.js';
import {
  contextualSuggestions,
  describeManualOperation,
  faceDirection,
  manualHistoryChanges,
  pieceDimensions,
  pieceExtentAlong,
} from '#lib/inspector-selection.js';

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const piece = (name: string, extras: GeometryComponentNode['extras'], bounds?: GeometryComponentNode['bounds']) =>
  ({
    id: name,
    name,
    kind: 'part',
    selector: name,
    childIds: [],
    depth: 0,
    path: [],
    meshNodeIndices: [],
    primitiveIndices: [],
    materialIndices: [],
    capabilities,
    extras,
    ...(bounds ? { bounds } : {}),
  }) satisfies GeometryComponentNode;

const frame = piece('Telaio fibbia', { manualBounds: { min: [-18, -12.5, -2], max: [18, 12.5, 2] } });
const it_ = bindTranslate('it');
const en = bindTranslate('en');

describe('pieceDimensions', () => {
  it('should read the exact native bounds in millimetres along X, Y and Z', () => {
    expect(pieceDimensions(frame)).toEqual({ length: 36, depth: 25, height: 4, exact: true });
  });

  it('should convert glTF bounds (Y-up metres) and mark them as not exact', () => {
    const mesh = piece('mesh', {}, { min: [0, 0, 0], max: [0.01, 0.002, 0.005], center: [0, 0, 0], radius: 0.01 });
    expect(pieceDimensions(mesh)).toEqual({ length: 10, depth: 5, height: 2, exact: false });
    expect(pieceExtentAlong(mesh, [0, 0, 1])).toBeUndefined();
  });

  it('should measure the thickness a through hole needs along a face normal', () => {
    expect(pieceExtentAlong(frame, [0, 0, 1])).toBe(4);
    expect(pieceExtentAlong(frame, [-1, 0, 0])).toBe(36);
  });
});

describe('faceDirection', () => {
  it.each([
    [[0, 0, 1], 'top'],
    [[0, 0, -1], 'bottom'],
    [[1, 0, 0], 'right'],
    [[-1, 0, 0], 'left'],
    [[0, 1, 0], 'back'],
    [[0, -1, 0], 'front'],
    [[0.7, 0, 0.7], 'slanted'],
  ] as const)('should name the face looking along %j «%s», never by index', (normal, direction) => {
    expect(faceDirection(normal)).toBe(direction);
  });
});

describe('contextualSuggestions', () => {
  it('should propose edits for the selected piece with numbers read from its geometry', () => {
    expect(contextualSuggestions({ kind: 'piece', node: frame }, it_, 'it')).toEqual([
      'Arrotonda gli spigoli di Telaio fibbia a r 0,6 mm',
      'Assottiglia Telaio fibbia di 1 mm',
      'Porta la lunghezza di Telaio fibbia a 39,5 mm',
    ]);
  });

  it('should bring a piece under the casting minimum up to it instead of thinning it', () => {
    const thin = piece('lamina', { manualBounds: { min: [0, 0, 0], max: [20, 10, 0.5] } });
    expect(contextualSuggestions({ kind: 'piece', node: thin }, it_, 'it')[1]).toBe(
      'Porta lo spessore di Lamina a 0,8 mm, il minimo per la fusione',
    );
  });

  it('should speak of the picked face or edges, and of the whole model without a selection', () => {
    expect(contextualSuggestions({ kind: 'face', node: frame, direction: 'top' }, it_, 'it')).toEqual([
      'Alza la faccia superiore di Telaio fibbia di 1 mm',
      'Fai un foro passante Ø 2 mm al centro della faccia superiore di Telaio fibbia',
      'Smussa il bordo della faccia superiore di Telaio fibbia di 0,4 mm',
    ]);
    expect(contextualSuggestions({ kind: 'edge', node: frame, edgeCount: 2 }, en, 'en')[0]).toBe(
      'Fillet the selected edges of Telaio fibbia to r 0.6 mm',
    );
    expect(contextualSuggestions({ kind: 'model', pieceCount: 2 }, it_, 'it')).toHaveLength(3);
  });

  it('should offer prongs for a stone', () => {
    const stone = piece('pietra', { role: 'stone', manualBounds: { min: [0, 0, 0], max: [6, 6, 4] } });
    expect(contextualSuggestions({ kind: 'piece', node: stone }, it_, 'it')[0]).toBe(
      'Aggiungi quattro griffe a Pietra',
    );
  });
});

const fillet: ManualOperation = {
  id: 'fillet-1',
  type: 'fillet',
  target: { name: 'ardiglione' },
  size: 0.5,
  edges: {
    kind: 'indices',
    indices: [1, 2, 3, 4],
    bodySignature: 'a'.repeat(64),
    replayWitness: 'b'.repeat(64),
    geometries: [],
  },
};

describe('describeManualOperation', () => {
  it('should say what, how much and on which piece, without indices', () => {
    expect(describeManualOperation(fillet, it_, 'it')).toBe('Raccordo r 0,5 mm · 4 spigoli · Ardiglione');
    expect(
      describeManualOperation(
        {
          id: 'face-1',
          type: 'faceExtrude',
          target: { name: 'Telaio fibbia' },
          face: { index: 13, bodySignature: 'a'.repeat(64), point: [0, 0, 2] },
          distance: -1.25,
        },
        it_,
        'it',
      ),
    ).toBe('Estrusione faccia −1,25 mm · Telaio fibbia');
    expect(
      describeManualOperation(
        {
          id: 'hole-1',
          type: 'hole',
          target: { name: 'Telaio fibbia' },
          center: [0, 0, 0],
          axis: [0, 0, -1],
          diameter: 2,
          depth: 4.2,
        },
        en,
        'en',
      ),
    ).toBe('Hole Ø 2 mm, 4.2 mm deep · Telaio fibbia');
  });
});

describe('manualHistoryChanges', () => {
  const document = (operations: ManualOperation[]): string =>
    JSON.stringify({ version: 1, operations } satisfies ManualDocument);
  // A history the schema accepts: picked edges carry their native witnesses, so this one rounds them all.
  const fillet: ManualOperation = {
    id: 'fillet-1',
    type: 'fillet',
    target: { name: 'ardiglione' },
    size: 0.5,
    edges: { kind: 'all' },
  };

  it('should describe added, edited (with the earlier value), switched off and removed operations', () => {
    const translate: ManualOperation = {
      id: 'move-1',
      type: 'translate',
      target: { name: 'ardiglione' },
      delta: [1, 0, 0],
    };
    expect(manualHistoryChanges({ original: '', modified: document([fillet]), t: it_, language: 'it' })).toEqual([
      'Raccordo r 0,5 mm · tutti gli spigoli · Ardiglione',
    ]);
    expect(
      manualHistoryChanges({
        original: document([fillet, translate]),
        modified: document([
          { ...fillet, size: 0.8 },
          { ...translate, enabled: false },
        ]),
        t: it_,
        language: 'it',
      }),
    ).toEqual([
      'Raccordo r 0,8 mm · tutti gli spigoli · Ardiglione (prima: Raccordo r 0,5 mm · tutti gli spigoli · Ardiglione)',
      'Disattivato: Sposta Ardiglione di 1; 0; 0 mm',
    ]);
    expect(
      manualHistoryChanges({ original: document([fillet]), modified: document([]), t: it_, language: 'it' }),
    ).toEqual(['Tolto: Raccordo r 0,5 mm · tutti gli spigoli · Ardiglione']);
  });

  it('should say nothing about an unreadable history', () => {
    expect(manualHistoryChanges({ original: '{', modified: document([fillet]), t: it_, language: 'it' })).toEqual([]);
  });
});
