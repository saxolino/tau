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
