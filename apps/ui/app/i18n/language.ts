import { useSyncExternalStore } from 'react';
import { Topic } from '@taucad/events';

/**
 * SinopiaCAD speaks two languages: Italian and English. Every visible string exists in both.
 */
export const languages = ['it', 'en'] as const;

/** One of SinopiaCAD's two interface languages. */
export type Language = (typeof languages)[number];

/** Where this device remembers the language chosen in the account menu. */
export const languageStorageKey = 'sinopiacad-language';

/** The language before anything is known: the server render, and a browser that names no language. */
export const fallbackLanguage: Language = 'it';

/** The BCP 47 locale each language formats numbers, dates and times with (IT «0,9 mm · 14:02», EN "0.9 mm · 2:02 PM"). */
export const languageLocales: Readonly<Record<Language, string>> = { it: 'it-IT', en: 'en-US' };

/**
 * Whether a value is one of the two languages.
 *
 * @param value - Anything read back from storage or a message.
 * @returns Whether it is `it` or `en`.
 */
export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (languages as readonly string[]).includes(value);

/**
 * The interface language, in the design's order (UI-UX-SinopiaCAD §1.1): the choice saved on this device, then the
 * browser's own languages (`it*` is Italian, any other language is English), then Italian when the browser names none.
 * The Sinopia account's language comes first once Sinopia stores one.
 *
 * @param input - The saved choice, if any, and the browser's languages in preference order.
 * @returns The language to show.
 */
export function detectLanguage(input: {
  readonly stored: string | undefined;
  readonly browserLanguages: readonly string[] | undefined;
}): Language {
  if (isLanguage(input.stored)) {
    return input.stored;
  }
  const browserLanguages = (input.browserLanguages ?? []).filter((tag) => tag.trim() !== '');
  if (browserLanguages.length === 0) {
    return fallbackLanguage;
  }
  // The first language the person prefers that SinopiaCAD speaks wins; one it does not speak at all means English.
  for (const tag of browserLanguages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) {
      return primary;
    }
  }
  return 'en';
}

const readStoredLanguage = (): string | undefined => {
  try {
    return globalThis.localStorage.getItem(languageStorageKey) ?? undefined;
  } catch {
    // Storage blocked or absent: the browser's language decides.
    return undefined;
  }
};

const readBrowserLanguages = (): readonly string[] | undefined => {
  const { navigator } = globalThis as { navigator?: Navigator };
  if (navigator === undefined) {
    return undefined;
  }
  // Older engines and some embedders leave `languages` out.
  const preferred = navigator.languages as readonly string[] | undefined;
  if (preferred !== undefined && preferred.length > 0) {
    return preferred;
  }
  return navigator.language ? [navigator.language] : undefined;
};

const isBrowser = (): boolean => typeof document !== 'undefined';

let current: Language | undefined;
const changes = new Topic<void>({ name: 'sinopiacad-language' });

const applyDocumentLanguage = (language: Language): void => {
  if (isBrowser() && document.documentElement.lang !== language) {
    document.documentElement.lang = language;
  }
};

const notify = (): void => {
  changes.emit();
};

/** Another tab chose a language: follow it here too. */
const handleStorage = (event: StorageEvent): void => {
  if (event.key !== languageStorageKey) {
    return;
  }
  const next = detectLanguage({ stored: event.newValue ?? undefined, browserLanguages: readBrowserLanguages() });
  if (next !== current) {
    current = next;
    applyDocumentLanguage(next);
    notify();
  }
};

/**
 * The interface language now, for code outside React (toasts, messages built in a library). Components read it with
 * {@link useLanguage} so they re-render when it changes.
 *
 * @returns The current language; Italian on the server.
 */
export function getLanguage(): Language {
  if (!isBrowser()) {
    return fallbackLanguage;
  }
  current ??= detectLanguage({ stored: readStoredLanguage(), browserLanguages: readBrowserLanguages() });
  return current;
}

/**
 * Change the interface language: it applies at once in every tab of this browser and is remembered on this device.
 *
 * @param language - The language chosen in the account menu or in Settings.
 */
export function setLanguage(language: Language): void {
  try {
    globalThis.localStorage.setItem(languageStorageKey, language);
  } catch {
    // Remembering is best-effort; the switch still applies to this page.
  }
  applyDocumentLanguage(language);
  if (current === language) {
    return;
  }
  current = language;
  notify();
}

const subscribe = (listener: () => void): (() => void) => {
  if (changes.size === 0 && isBrowser()) {
    globalThis.addEventListener('storage', handleStorage);
  }
  const unsubscribe = changes.subscribe(listener);
  return () => {
    unsubscribe();
    if (changes.size === 0 && isBrowser()) {
      globalThis.removeEventListener('storage', handleStorage);
    }
  };
};

const getServerLanguage = (): Language => fallbackLanguage;

/**
 * The interface language, re-rendering when it changes. The server render and hydration use Italian; the browser's
 * resolved language follows right after hydration.
 *
 * @returns The current language.
 */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, getServerLanguage);
}

/**
 * Forget the resolved language so the next read detects it again. Tests only.
 *
 * @internal
 */
export function resetLanguageForTests(): void {
  current = undefined;
  notify();
}
