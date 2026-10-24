import { describe, expect, it } from 'vitest';
import { getSettingsSections, searchSettings, tauSettingsSections } from '#components/settings/settings-registry.js';
import { bindTranslate } from '#i18n/translate.js';

describe.each(['it', 'en'] as const)('Sinopia settings in %s', (language) => {
  const sections = getSettingsSections(bindTranslate(language));
  it('should expose only operative designer preferences and preserve the hidden Tau catalogue', () => {
    expect(sections.map(({ id }) => id)).toEqual(['general', 'models', 'tools']);
    expect(sections.flatMap(({ entries }) => entries.map(({ id }) => id))).toEqual([
      'theme',
      'language',
      'pointer-cursors',
      'units',
      // Tau functions a designer may switch on; 3D printing waits for the printers feature.
      'tool-convert',
      'tool-import',
      'tool-pieces',
      'tool-kinematics',
      'tool-details',
      'tool-code',
    ]);
    expect(tauSettingsSections.some(({ id }) => id === 'security')).toBe(true);
    for (const query of ['GitHub', 'credits', 'telemetry', 'filesystem', 'API keys', 'machines', 'cloud']) {
      expect(searchSettings(query, sections)).toEqual([]);
    }
  });
  it('should find a tool by its designer name', () => {
    const query = language === 'it' ? 'cerniere' : 'hinges';
    expect(searchSettings(query, sections).flatMap(({ entries }) => entries.map(({ id }) => id))).toEqual([
      'tool-kinematics',
    ]);
  });
  it('should search translated names, normalize punctuation and find fixed millimetres', () => {
    const query = language === 'it' ? 'UNITÀ---MILLIMETRI' : 'UNITS---MILLIMETRES';
    expect(searchSettings(query, sections).flatMap(({ entries }) => entries.map(({ id }) => id))).toEqual(['units']);
    expect(searchSettings('mm', sections)).toHaveLength(1);
    expect(searchSettings('  ', sections)).toEqual([]);
    expect(searchSettings('theme storage', sections)).toEqual([]);
  });
});
