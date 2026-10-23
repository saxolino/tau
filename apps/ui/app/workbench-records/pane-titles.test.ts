import { describe, expect, it } from 'vitest';
import { paneTabTitle, paneTitle } from '#workbench-records/pane-titles.js';

// SinopiaCAD: the panes a designer meets carry their names in the interface language.
describe('pane titles', () => {
  it.each([
    ['it', ['Misure', 'Versioni', 'Esporta']],
    ['en', ['Measures', 'Versions', 'Export']],
  ] as const)('should name Misure, Versions and Export tabs in %s', (language, names) => {
    expect([
      paneTabTitle('parameters', language),
      paneTabTitle('revisions', language),
      paneTabTitle('export', language),
    ]).toEqual(names);
  });

  it('should keep the stored titles the layouts were saved with', () => {
    expect(paneTitle('parameters')).toBe('Misure');
    expect(paneTitle('revisions')).toBe('Revisions');
  });

  it('should leave a file tab its own title', () => {
    expect(paneTabTitle('editor', 'it')).toBeUndefined();
  });
});
