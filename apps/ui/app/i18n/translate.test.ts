import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { areas } from '#i18n/catalog.js';
import type { MessageTree } from '#i18n/define-messages.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { formatNumber, formatTime, translate, useTranslation } from '#i18n/translate.js';

const leaves = (tree: MessageTree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`),
  );

const placeholders = (text: string): string[] => [...text.matchAll(/{(\w+)}/g)].map((match) => match[1] ?? '').sort();

// ── The catalog ─────────────────────────────────────────────────────────────

describe('message catalog', () => {
  it.each(Object.entries(areas))(
    'should give every %s message a non-empty text in both languages',
    (_area, messages) => {
      const italian = leaves(messages.it);
      const english = new Map(leaves(messages.en as MessageTree));

      expect(italian.length).toBeGreaterThan(0);
      expect([...english.keys()].sort()).toEqual(italian.map(([key]) => key).sort());
      for (const [key, text] of italian) {
        expect(text.trim(), `it ${key}`).not.toBe('');
        expect(english.get(key)?.trim(), `en ${key}`).not.toBe('');
      }
    },
  );

  it.each(Object.entries(areas))('should keep the same placeholders in both languages for %s', (_area, messages) => {
    const english = new Map(leaves(messages.en as MessageTree));
    for (const [key, text] of leaves(messages.it)) {
      expect(placeholders(english.get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });
});

// ── Translating ─────────────────────────────────────────────────────────────

describe('translate', () => {
  it('should write the same key in each language', () => {
    expect(translate('it', 'project.topBar.versions')).toBe('Versioni');
    expect(translate('en', 'project.topBar.versions')).toBe('Versions');
  });

  it('should fill placeholders', () => {
    expect(translate('it', 'project.saveStatus.savedAt', { time: '14:02' })).toBe('Salvato su questo computer · 14:02');
    expect(translate('en', 'project.saveStatus.savedAt', { time: '2:02 PM' })).toBe('Saved on this computer · 2:02 PM');
  });
});

describe('useTranslation', () => {
  afterEach(() => {
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });

  it('should switch every message when the language switches', () => {
    act(() => {
      setLanguage('it');
    });
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('project.topBar.sendToSinopia')).toBe('Invia a Sinopia');

    act(() => {
      setLanguage('en');
    });

    expect(result.current.language).toBe('en');
    expect(result.current.t('project.topBar.sendToSinopia')).toBe('Send to Sinopia');
  });
});

// ── Formatting ──────────────────────────────────────────────────────────────

describe('formatting', () => {
  it('should write decimals with a comma in Italian and a point in English', () => {
    expect(formatNumber(0.9, 'it')).toBe('0,9');
    expect(formatNumber(0.9, 'en')).toBe('0.9');
  });

  it('should write the time of day in each language’s clock', () => {
    const moment = new Date(2026, 9, 23, 14, 2);
    expect(formatTime(moment, 'it')).toBe('14:02');
    expect(formatTime(moment, 'en')).toBe('2:02 PM');
  });
});
