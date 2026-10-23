import { describe, expect, it } from 'vitest';
import { turnModelChanges } from '#lib/turn-model-changes.js';
const record = (wall: number, units?: Record<string, string>): string =>
  JSON.stringify({
    activeGroup: 'default',
    groups: { default: { values: { castone: { parete: wall } }, ...(units ? { units } : {}) } },
  });
describe('turn model differences', () => {
  it('should compare exact values with authored units in either language', () => {
    const input = {
      original: record(0.3, { '/castone/parete': 'mm' }),
      modified: record(0.4, { '/castone/parete': 'mm' }),
    };
    expect(turnModelChanges({ ...input, language: 'it' })).toEqual([
      {
        id: '/castone/parete',
        name: 'Castone',
        pieceId: undefined,
        field: 'Parete',
        before: '0,3 mm',
        after: '0,4 mm',
        owned: false,
      },
    ]);
    expect(turnModelChanges({ ...input, language: 'en' })[0]?.after).toBe('0.4 mm');
  });
  it('should never infer manual provenance or millimetres from record presence', () => {
    expect(turnModelChanges({ original: record(0), modified: record(0.4), language: 'it' })[0]).toMatchObject({
      before: '0',
      after: '0,4',
      owned: false,
    });
  });
  it('should retain a manually fixed unchanged value only with write evidence', () => {
    expect(turnModelChanges({ original: record(0.4), modified: record(0.4), language: 'it' })).toEqual([]);
    expect(
      turnModelChanges({
        original: record(0.4),
        modified: record(0.4),
        language: 'it',
        manualPointers: new Set(['/castone/parete']),
      })[0],
    ).toMatchObject({ before: '0,4', after: '0,4', owned: true });
  });
  it('should leave unknown, invalid and unsupported evidence to the honest fallback', () => {
    expect(turnModelChanges({ original: 'broken', modified: record(0.4), language: 'it' })).toEqual([]);
    expect(turnModelChanges({ original: record(0.4), modified: '{}', language: 'it' })).toEqual([]);
    expect(turnModelChanges({ original: '', modified: record(0.4), language: 'it' })[0]?.before).toBeUndefined();
  });
});
