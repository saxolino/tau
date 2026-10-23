import { useMemo } from 'react';
import type { MessageTree } from '#i18n/define-messages.js';
import { catalog } from '#i18n/catalog.js';
import type { ItalianMessages } from '#i18n/catalog.js';
import { languageLocales, useLanguage } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';

/** Every dotted path to a string in a message tree: `project.topBar.versions`. */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

/** The text at a dotted path. */
type PathValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? PathValue<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/** The `{name}` placeholders a message carries. */
type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;

/** Any message key, from the Italian catalog (the English one has the same keys by construction). */
export type MessageKey = Paths<ItalianMessages>;

/** No arguments at all. */
type NoParameters = Parameters<() => void>;

/** What one message needs filled in: nothing, or one value per placeholder. */
export type MessageParameters<K extends MessageKey> = [Placeholders<PathValue<ItalianMessages, K>>] extends [never]
  ? NoParameters
  : [parameters: Readonly<Record<Placeholders<PathValue<ItalianMessages, K>>, string | number>>];

/** A message without placeholders, for tables that store a key and translate it at render. */
export type PlainMessageKey = {
  [K in MessageKey]: [Placeholders<PathValue<ItalianMessages, K>>] extends [never] ? K : never;
}[MessageKey];

/**
 * A bound translator: a key and, when the message has placeholders, their values. A key read from a table
 * ({@link PlainMessageKey}) needs none.
 */
export type Translate = {
  (key: PlainMessageKey): string;
  <K extends MessageKey>(key: K, ...parameters: MessageParameters<K>): string;
};

const lookup = (tree: MessageTree, key: string): string | undefined => {
  let node: MessageTree | string | undefined = tree;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') {
      return undefined;
    }
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
};

const fill = (text: string, parameters: Readonly<Record<string, string | number>> | undefined): string =>
  parameters === undefined
    ? text
    : text.replaceAll(/{(\w+)}/g, (match, name: string) => {
        const value = parameters[name];
        return value === undefined ? match : String(value);
      });

/**
 * One message in one language, for code outside React. Components use {@link useTranslation}.
 *
 * @param language - The language to write in.
 * @param key - The message.
 * @param parameters - The values of its placeholders, when it has any.
 * @returns The text.
 */
export function translate<K extends MessageKey>(
  language: Language,
  key: K,
  ...parameters: MessageParameters<K>
): string {
  const text = lookup(catalog[language], key) ?? lookup(catalog.it, key) ?? key;
  return fill(text, parameters[0]);
}

/**
 * A translator bound to one language, for code outside React and for tests.
 *
 * @param language - The language to write in.
 * @returns `t` for that language.
 */
export function bindTranslate(language: Language): Translate {
  return ((key: MessageKey, ...parameters: unknown[]): string =>
    translate(language, key, ...(parameters as MessageParameters<typeof key>))) as Translate;
}

/**
 * The current language and a translator bound to it; both change together when the person switches language.
 *
 * @returns `t` for messages and the language for formatting.
 */
export function useTranslation(): { readonly t: Translate; readonly language: Language } {
  const language = useLanguage();
  const t = useMemo(() => bindTranslate(language), [language]);
  return useMemo(() => ({ t, language }), [language, t]);
}

/**
 * A number the way the language writes it: IT `0,9`, EN `0.9`.
 *
 * @param value - The number.
 * @param language - The language.
 * @param options - Digits and the like, as `Intl.NumberFormat` takes them.
 * @returns The formatted number.
 */
export function formatNumber(value: number, language: Language, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(languageLocales[language], options).format(value);
}

/**
 * A time of day the way the language writes it: IT `14:02`, EN `2:02 PM`.
 *
 * @param date - The moment.
 * @param language - The language.
 * @returns Hours and minutes.
 */
export function formatTime(date: Date | number, language: Language): string {
  return new Intl.DateTimeFormat(languageLocales[language], { hour: 'numeric', minute: '2-digit' }).format(date);
}
