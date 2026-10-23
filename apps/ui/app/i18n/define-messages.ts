/**
 * A tree of messages: camelCase keys grouping the strings of one area, leaves are the text. Placeholders are written
 * `{name}` and filled by `t`.
 */
export type MessageTree = { readonly [key: string]: string | MessageTree };

/** The same keys as `T`, any text: the English side must name every key the Italian side does, and no other. */
export type SameShape<T> = { readonly [K in keyof T]: T[K] extends string ? string : SameShape<T[K]> };

/** Both languages of one area's messages. */
export type MessageCatalog<T extends MessageTree> = Readonly<{ it: T; en: SameShape<T> }>;

/**
 * Declare one area's messages in both languages. Italian is the source the keys and placeholders are typed from;
 * TypeScript refuses an English side that misses a key or adds one.
 *
 * @param catalog - The Italian and English trees.
 * @returns The same catalog, typed.
 *
 * @example <caption>The project page's top bar</caption>
 * ```typescript
 * export const topBarMessages = defineMessages({
 *   it: { versions: 'Versioni', savedAt: 'Salvato su questo computer · {time}' },
 *   en: { versions: 'Versions', savedAt: 'Saved on this computer · {time}' },
 * });
 * ```
 */
export function defineMessages<const T extends MessageTree>(catalog: {
  readonly it: T;
  readonly en: SameShape<T>;
}): MessageCatalog<T> {
  return catalog;
}
