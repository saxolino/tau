import { describe, expect, it } from 'vitest';
import { bindTranslate } from '#i18n/translate.js';
import type { GeometryComponentManifest } from '@taucad/types';
import {
  groupVersionDays,
  parameterChangeSentence,
  versionChangeLine,
  versionChangeSentences,
  versionSummary,
} from '#routes/w.$workspace.$project/revision-history.js';

const record = (wall: number, unit = 'mm') =>
  JSON.stringify({
    activeGroup: 'Castone marquise',
    groups: { 'Castone marquise': { values: { wall }, units: { '/wall': unit } } },
  });

describe('readable versions', () => {
  it('should group local calendar days across daylight saving time without renumbering revisions', () => {
    const now = new Date(2026, 9, 26, 0, 30);
    const rows = [
      { id: 'a', createdAt: now.getTime() },
      { id: 'b', createdAt: new Date(2026, 9, 25, 0, 5).getTime() },
      { id: 'c', createdAt: new Date(2026, 9, 24, 23, 30).getTime() },
    ];
    const days = groupVersionDays(rows, 'it', now);
    expect(days.map((day) => day.label)).toEqual(['Oggi', 'Ieri', '24 ott 2026']);
    expect(days.flatMap((day) => day.rows)).toEqual(rows);
    expect(groupVersionDays(rows, 'en', now).map((day) => day.label)).toEqual(['Today', 'Yesterday', 'Oct 24, 2026']);
  });

  it.each(['it', 'en'] as const)('should describe actual stored parameter differences in %s', (language) => {
    expect(parameterChangeSentence({ original: record(0.3), modified: record(0.4), language })).toBe(
      language === 'it' ? 'Castone marquise: 0,3 → 0,4 mm' : 'Castone marquise: 0.3 → 0.4 mm',
    );
  });

  it('should retain both units when a measure changes units', () => {
    expect(parameterChangeSentence({ original: record(1, 'in'), modified: record(25.4), language: 'it' })).toBe(
      'Castone marquise: 1 in → 25,4 mm',
    );
  });

  it('should use an honest fallback for invalid records or structural changes', () => {
    expect(parameterChangeSentence({ original: '{broken', modified: record(2), language: 'it' })).toBeUndefined();
    expect(parameterChangeSentence({ original: record(1), modified: record(1), language: 'it' })).toBeUndefined();
    expect(versionSummary({ summary: 'main.ts: OpenSCAD using gpt-5', trigger: 'save' }, bindTranslate('it'))).toBe(
      'Modifiche al modello',
    );
    expect(versionSummary({ summary: 'Updated render.svg', trigger: 'turn' }, bindTranslate('en'))).toBe(
      'Model changes',
    );
    expect(versionSummary({ summary: 'Autosave', trigger: 'idle' }, bindTranslate('en'))).toBe('Model changes');
  });

  it('should not mislabel the saved dirty base before a restore as a restored version', () => {
    expect(versionSummary({ summary: 'Autosave', trigger: 'restore' }, bindTranslate('it'))).toBe(
      'Modifiche al modello',
    );
    expect(versionSummary({ summary: 'Parete 0.3 → 0.4 mm', trigger: 'turn' }, bindTranslate('en'))).toBe(
      'Parete 0.3 → 0.4 mm',
    );
  });

  it('should keep meaningful authored summaries and name restored revisions from the graph', () => {
    expect(versionSummary({ summary: 'Castone adattato', trigger: 'agent' }, bindTranslate('it'))).toBe(
      'Castone adattato',
    );
    expect(versionSummary({ summary: '', trigger: 'restore', restoredFrom: 'old' }, bindTranslate('it'), 2)).toBe(
      'Ripristinata la Rev 2',
    );
  });
});

describe('speaking versions', () => {
  const capabilities = {
    canHide: true,
    canIsolate: true,
    canFocus: true,
    canAdjustOpacity: true,
    hasDrawings: false,
    hasPreciseTopology: true,
    exports: [],
  };
  const manifest: GeometryComponentManifest = {
    schemaVersion: 1,
    sourceFile: 'main.ts',
    rootId: 'frame',
    nodeOrder: ['frame'],
    capabilities,
    nodesById: {
      frame: {
        id: 'frame',
        name: 'Telaio fibbia',
        kind: 'part',
        selector: 'frame',
        childIds: [],
        depth: 0,
        path: [],
        meshNodeIndices: [],
        primitiveIndices: [],
        materialIndices: [],
        capabilities,
      },
    },
  };
  const parameters = (spessore: number): string =>
    JSON.stringify({
      activeGroup: 'default',
      groups: { default: { values: { telaioFibbia: { spessore } }, units: { '/telaioFibbia/spessore': 'mm' } } },
    });
  const manual = (size: number): string =>
    JSON.stringify({
      version: 1,
      operations: [{ id: 'f1', type: 'fillet', target: { name: 'Telaio fibbia' }, size, edges: { kind: 'all' } }],
    });

  it('should name the piece and the measure with its values before → after, then each manual operation', () => {
    const sentences = versionChangeSentences({
      files: [
        { path: '.tau/parameters/main.ts.json', original: parameters(4), modified: parameters(5) },
        { path: 'main.ts.manual.json', original: manual(0.5), modified: manual(0.8) },
        { path: 'main.ts', original: 'a', modified: 'b' },
      ],
      manifests: new Map([['main.ts', manifest]]),
      language: 'it',
    });
    expect(sentences).toEqual([
      'Telaio fibbia · spessore: 4 mm → 5 mm',
      'Raccordo r 0,8 mm · tutti gli spigoli · Telaio fibbia (prima: Raccordo r 0,5 mm · tutti gli spigoli · Telaio fibbia)',
    ]);
    expect(versionChangeLine(sentences, 'it')).toBe('Telaio fibbia · spessore: 4 mm → 5 mm · e un’altra modifica');
    expect(versionChangeLine([], 'it')).toBeUndefined();
  });

  it('should describe a first manual operation even without an earlier history', () => {
    expect(
      versionChangeSentences({
        files: [{ path: 'main.ts.manual.json', original: '', modified: manual(0.5) }],
        manifests: new Map(),
        language: 'en',
      }),
    ).toEqual(['Fillet r 0.5 mm · all edges · Telaio fibbia']);
  });
});
