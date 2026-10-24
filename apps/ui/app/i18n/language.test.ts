import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectLanguage,
  getLanguage,
  languageStorageKey,
  resetLanguageForTests,
  setLanguage,
  useLanguage,
} from '#i18n/language.js';

// ── Detection order ─────────────────────────────────────────────────────────

describe('detectLanguage', () => {
  it('should prefer the choice saved on this device over the browser', () => {
    expect(detectLanguage({ stored: 'en', browserLanguages: ['it-IT'] })).toBe('en');
    expect(detectLanguage({ stored: 'it', browserLanguages: ['en-US'] })).toBe('it');
  });

  it('should ignore a saved value that is not a language', () => {
    expect(detectLanguage({ stored: 'fr', browserLanguages: ['en-GB'] })).toBe('en');
  });

  it('should read Italian from any it-* browser language', () => {
    expect(detectLanguage({ stored: undefined, browserLanguages: ['it-CH', 'en'] })).toBe('it');
    expect(detectLanguage({ stored: undefined, browserLanguages: ['IT'] })).toBe('it');
  });

  it('should take the first browser language SinopiaCAD speaks', () => {
    expect(detectLanguage({ stored: undefined, browserLanguages: ['de-DE', 'it-IT'] })).toBe('it');
    expect(detectLanguage({ stored: undefined, browserLanguages: ['fr-FR', 'en-US', 'it'] })).toBe('en');
  });

  it('should fall to English for a browser language it does not speak', () => {
    expect(detectLanguage({ stored: undefined, browserLanguages: ['de-DE', 'fr-FR'] })).toBe('en');
  });

  it('should fall back to Italian when the browser names no language', () => {
    expect(detectLanguage({ stored: undefined, browserLanguages: undefined })).toBe('it');
    expect(detectLanguage({ stored: undefined, browserLanguages: [] })).toBe('it');
  });
});

// ── The store ───────────────────────────────────────────────────────────────

describe('language store', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    vi.spyOn(globalThis.navigator, 'languages', 'get').mockReturnValue(['en-US']);
    resetLanguageForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });

  it('should start from the browser language when nothing is saved', () => {
    expect(getLanguage()).toBe('en');
  });

  it('should start from the saved choice', () => {
    globalThis.localStorage.setItem(languageStorageKey, 'it');
    resetLanguageForTests();
    expect(getLanguage()).toBe('it');
  });

  it('should save the switch on this device and set the document language', () => {
    setLanguage('it');
    expect(globalThis.localStorage.getItem(languageStorageKey)).toBe('it');
    expect(document.documentElement.lang).toBe('it');
    expect(getLanguage()).toBe('it');
  });

  it('should re-render readers when the language switches', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current).toBe('en');

    act(() => {
      setLanguage('it');
    });

    expect(result.current).toBe('it');
  });

  it('should follow a switch made in another tab', () => {
    const { result } = renderHook(() => useLanguage());

    act(() => {
      globalThis.localStorage.setItem(languageStorageKey, 'it');
      globalThis.dispatchEvent(new StorageEvent('storage', { key: languageStorageKey, newValue: 'it' }));
    });

    expect(result.current).toBe('it');
  });
});
