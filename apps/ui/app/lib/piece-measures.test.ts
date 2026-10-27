import { describe, expect, it } from 'vitest';
import type { RJSFSchema } from '@rjsf/utils';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import {
  flatMeasurePiece,
  groupPieceMeasures,
  isStonePiece,
  modelMeasureSummary,
  assumptionState,
  parameterAssumption,
  pieceKeyValue,
  pieceParameterSchema,
  readablePieceName,
  valueAtPath,
} from '#lib/piece-measures.js';
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
const stone = piece('marquise');
const bezel = piece('castone_marquise');
const branch = piece('rametto_sx');
const manifest: GeometryComponentManifest = {
  schemaVersion: 1,
  rootId: 'root',
  nodeOrder: [stone.id, bezel.id, branch.id],
  nodesById: { [stone.id]: stone, [bezel.id]: bezel, [branch.id]: branch },
  capabilities,
};
describe('piece measures', () => {
  it('should give a pair of pieces built from one group (Tacco DX / Tacco SX) that group on both sides', () => {
    const destro = piece('Tacco DX');
    const sinistro = piece('Tacco SX');
    const tappo = piece('Tappo DX');
    const coppia: GeometryComponentManifest = {
      ...manifest,
      nodeOrder: [destro.id, sinistro.id, tappo.id],
      nodesById: { [destro.id]: destro, [sinistro.id]: sinistro, [tappo.id]: tappo },
    };
    expect(
      groupPieceMeasures(coppia, { tacco: { altezza: 85 }, tappo: { altezza: 4 }, costruzione: { parete: 2 } }).map(
        ({ id, keys }) => ({ id, keys }),
      ),
    ).toEqual([
      { id: destro.id, keys: ['tacco'] },
      { id: sinistro.id, keys: ['tacco'] },
      { id: tappo.id, keys: ['tappo'] },
      { id: 'general', keys: ['costruzione'] },
    ]);
  });
  it('should group exact names, retain pieces without parameters and put unmatched measures in General', () => {
    expect(
      groupPieceMeasures(manifest, {
        marquise: { lunghezza: 10 },
        castoneMarquise: { parete: 0.4 },
        finiture: true,
      }).map(({ id, keys }) => ({ id, keys })),
    ).toEqual([
      { id: stone.id, keys: ['marquise'] },
      { id: bezel.id, keys: ['castoneMarquise'] },
      { id: branch.id, keys: [] },
      { id: 'general', keys: ['finiture'] },
    ]);
    expect(
      groupPieceMeasures(manifest, { ramettoSinistro: { diametro: 1 } }).find(({ id }) => id === branch.id)?.keys,
    ).toEqual(['ramettoSinistro']);
    expect(groupPieceMeasures(undefined, { diametro: 3 })).toEqual([{ id: 'general', keys: ['diametro'] }]);
  });
  it.each([
    ['castone_marquise', 'it', 'Castone marquise'],
    ['rametto_sx', 'it', 'Rametto sinistro'],
    ['rametto_dx', 'it', 'Rametto destro'],
    ['pietrina_sx', 'it', 'Pietrina sinistra'],
    ['branch_sx', 'en', 'Branch left'],
    ['branch_dx', 'en', 'Branch right'],
    ['Custom Pearl', 'en', 'Custom Pearl'],
  ] as const)('should make %s readable in %s', (name, language, expected) => {
    expect(readablePieceName(name, language)).toBe(expected);
  });
  it('should show localized current dimensions and preserve zero', () => {
    const group = { id: stone.id, node: stone, keys: ['marquise'] };
    expect(
      pieceKeyValue({
        group,
        defaults: { marquise: { lunghezza: 10, larghezza: 4.5 } },
        values: { marquise: { lunghezza: 0 } },
        language: 'it',
      }),
    ).toBe('0 × 4,5 mm');
    expect(pieceKeyValue({ group, defaults: { marquise: { diametro: 2.2 } }, values: {}, language: 'en' })).toBe(
      '⌀ 2.2 mm',
    );
  });
  it('should count stones without classifying bezels as stones', () => {
    expect(modelMeasureSummary([stone, bezel, branch])).toEqual({ pieces: 3, stones: 1 });
    expect(isStonePiece(piece('opaque', { ruolo: 'pietra' }))).toBe(true);
  });
  it('should omit mass for incomplete evidence and mixed metals', () => {
    const gold = piece('stelo', { density: 15.5, volumeMm3: 200, massGrams: 3.1 });
    expect(modelMeasureSummary([gold, stone])).toEqual({ pieces: 2, stones: 1, goldMass: 3.1 });
    expect(modelMeasureSummary([gold, bezel]).goldMass).toBeUndefined();
    expect(modelMeasureSummary([gold, piece('argento', { density: 10.4, massGrams: 2 })]).goldMass).toBeUndefined();
  });
  it('should recognize stored overrides even when zero or false', () => {
    expect(valueAtPath({ stelo: { spessore: 0 } }, ['stelo', 'spessore'])).toBe(0);
    expect(valueAtPath({ finiture: false }, ['finiture'])).toBe(false);
    expect(valueAtPath({}, ['stelo', 'spessore'])).toBeUndefined();
  });
  it('should preserve canonical schema paths and read only explicit assumptions', () => {
    const schema: RJSFSchema = {
      type: 'object',
      properties: {
        stelo: {
          type: 'object',
          properties: { spessore: { type: 'number', description: '[sinopia:assumed] Hidden in the image' } },
        },
        lunghezza: { type: 'number' },
      },
      required: ['stelo', 'lunghezza'],
    };
    const projected = pieceParameterSchema(schema, ['stelo']);
    expect(Object.keys(projected?.properties ?? {})).toEqual(['stelo']);
    expect(projected?.required).toEqual(['stelo']);
    expect(parameterAssumption(projected, ['stelo', 'spessore'])).toStrictEqual({ reason: 'Hidden in the image' });
    expect(parameterAssumption(projected, ['stelo', 'other'])).toBeUndefined();
  });
  it('should read a recognition’s confidence, source and band from the extended marker, in three states', () => {
    const schema: RJSFSchema = {
      type: 'object',
      properties: {
        larghezza: { type: 'number', description: '[sinopia:assumed c=0.52 f=proporzione min=18 max=21] Coperto' },
        apertura: { type: 'number', description: '[sinopia:assumed c=0.72 f=proporzione] Prospettiva' },
        sezione: { type: 'number', description: '[sinopia:assumed c=0.9 f=catalogo] Dal catalogo' },
      },
    };
    const larghezza = parameterAssumption(schema, ['larghezza']);
    expect(larghezza).toStrictEqual({ confidence: 0.52, source: 'proporzione', min: 18, max: 21, reason: 'Coperto' });
    expect(assumptionState(larghezza)).toBe('assumed');
    expect(assumptionState(parameterAssumption(schema, ['apertura']))).toBe('estimated');
    expect(assumptionState(parameterAssumption(schema, ['sezione']))).toBeUndefined();
    expect(assumptionState({ reason: 'Senza attributi' })).toBe('assumed');
  });
});

describe('flat measures written before measures were nested per piece', () => {
  const piece = (id: string, name: string): GeometryComponentNode =>
    ({ id, name, kind: 'part', capabilities: {} }) as unknown as GeometryComponentNode;
  const pieces = [
    piece('a', 'Marquise'),
    piece('b', 'Castone marquise'),
    piece('c', 'Stelo'),
    piece('d', 'Castone sinistro'),
    piece('e', 'Castone destro'),
  ];
  const manifest = {
    nodeOrder: pieces.map((node) => node.id),
    nodesById: Object.fromEntries(pieces.map((node) => [node.id, node])),
  } as unknown as GeometryComponentManifest;

  it('joins a flat measure to the one piece its leading words name', () => {
    expect(flatMeasurePiece('marquiseLarghezza', pieces)).toEqual({ node: pieces[0], measure: 'Larghezza' });
    expect(flatMeasurePiece('steloDiametro', pieces)?.node.name).toBe('Stelo');
  });

  it('keeps a prefix shared by several pieces, or by none, out of every piece', () => {
    expect(flatMeasurePiece('castoneParete', pieces)).toBeUndefined();
    expect(flatMeasurePiece('granulatura', pieces)).toBeUndefined();
  });

  it('groups flat measures with their piece and reads the key value from them', () => {
    const defaults = { marquiseLunghezza: 10, marquiseLarghezza: 4, steloDiametro: 1.4, castoneParete: 0.4 };
    const groups = groupPieceMeasures(manifest, defaults);
    expect(groups.find((group) => group.id === 'a')?.keys).toEqual(['marquiseLunghezza', 'marquiseLarghezza']);
    expect(groups.find((group) => group.id === 'general')?.keys).toEqual(['castoneParete']);
    const marquise = groups.find((group) => group.id === 'a')!;
    expect(pieceKeyValue({ group: marquise, defaults, values: { marquiseLunghezza: 12 }, language: 'it' })).toBe(
      '12 × 4 mm',
    );
    const stelo = groups.find((group) => group.id === 'c')!;
    expect(pieceKeyValue({ group: stelo, defaults, values: {}, language: 'it' })).toBe('⌀ 1,4 mm');
  });
});
