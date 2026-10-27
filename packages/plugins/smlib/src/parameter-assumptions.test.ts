import { describe, expect, it } from 'vitest';
import type { JSONSchema7 } from '@taucad/runtime/types';
import { annotateParameterAssumptions } from '#parameter-assumptions.js';
const schema: JSONSchema7 = {
  type: 'object',
  properties: {
    stelo: { type: 'object', properties: { spessore: { type: 'number' }, lunghezza: { type: 'number' } } },
    'a/b': { type: 'number' },
  },
};
describe('authored parameter assumptions', () => {
  it('should carry reasons and escaped JSON pointers without mutating the source schema', () => {
    expect(
      annotateParameterAssumptions(schema, { ipotesi: { 'stelo.spessore': 'Hidden thickness', '/a~1b': 'Estimated' } }),
    ).toMatchObject({
      properties: {
        stelo: { properties: { spessore: { description: '[sinopia:assumed] Hidden thickness' } } },
        'a/b': { description: '[sinopia:assumed] Estimated' },
      },
    });
    expect(schema).not.toHaveProperty('properties.stelo.properties.spessore.description');
  });
  it('should accept a key list and ignore unknown or malformed annotations', () => {
    expect(
      annotateParameterAssumptions(schema, { ipotesi: ['stelo.lunghezza', 'missing', 'stelo', 12] }),
    ).toMatchObject({ properties: { stelo: { properties: { lunghezza: { description: '[sinopia:assumed] ' } } } } });
    expect(annotateParameterAssumptions(schema, { ipotesi: { 'stelo.spessore': 5 } })).toEqual(schema);
    expect(annotateParameterAssumptions(schema, undefined)).toEqual(schema);
  });
});

describe('extended assumption marker (D2 §2.7)', () => {
  it('should carry confidence, source and band inside the marker from a string or an object', async () => {
    const { parseAssumptionDescription } = await import('#parameter-assumptions.js');
    const annotated = annotateParameterAssumptions(schema, {
      ipotesi: {
        'stelo.spessore': '[c=0.62 f=proporzione min=78 max=92] Read on the visible part',
        'stelo.lunghezza': { motivo: 'Hidden', confidenza: 0.3, fonte: 'non_visibile' },
      },
    });
    const spessore = (annotated.properties?.['stelo'] as JSONSchema7).properties?.['spessore'] as JSONSchema7;
    const lunghezza = (annotated.properties?.['stelo'] as JSONSchema7).properties?.['lunghezza'] as JSONSchema7;
    expect(spessore.description).toBe('[sinopia:assumed c=0.62 f=proporzione min=78 max=92] Read on the visible part');
    expect(lunghezza.description).toBe('[sinopia:assumed c=0.3 f=non_visibile] Hidden');
    expect(parseAssumptionDescription(spessore.description)).toStrictEqual({
      confidence: 0.62,
      source: 'proporzione',
      min: 78,
      max: 92,
      reason: 'Read on the visible part',
    });
  });

  it('should read the plain marker as before and ignore malformed attributes', async () => {
    const { parseAssumptionDescription } = await import('#parameter-assumptions.js');
    expect(parseAssumptionDescription('[sinopia:assumed] Hidden thickness')).toStrictEqual({
      reason: 'Hidden thickness',
    });
    expect(parseAssumptionDescription('[sinopia:assumed c=7 f=Nope min=x] Why')).toStrictEqual({ reason: 'Why' });
    expect(parseAssumptionDescription('[sinopia:assumedX] no')).toBeUndefined();
    expect(parseAssumptionDescription('An ordinary description')).toBeUndefined();
    expect(parseAssumptionDescription(undefined)).toBeUndefined();
  });
});
