import { requireParameterRecord } from '@taucad/parameters';
import type { JSONValue } from '@taucad/types';
import { bindTranslate, formatNumber } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import { languageLocales } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';

/** A future Sinopia delivery is an event, never a fabricated revision. */
export type VersionEvent = Readonly<{ kind: 'sent'; id: string; createdAt: number; versionNumber: number }>;

/** Local calendar grouping, including the 23/25-hour days around daylight saving changes. */
export function groupVersionDays<T extends { readonly createdAt: number }>(
  rows: readonly T[],
  language: Language,
  now = new Date(),
): Array<{ key: string; label: string; rows: T[] }> {
  const t = bindTranslate(language);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const keyOf = (date: Date): string => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const groups = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const row of rows) {
    const date = new Date(row.createdAt);
    const key = row.createdAt > 0 ? keyOf(date) : 'earlier';
    const label =
      key === keyOf(now)
        ? t('versions.today')
        : key === keyOf(yesterday)
          ? t('versions.yesterday')
          : key === 'earlier'
            ? t('versions.earlier')
            : new Intl.DateTimeFormat(languageLocales[language], { dateStyle: 'medium' }).format(date);
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Keep authored prose, withholding source paths, generated messages and implementation vocabulary. */
export function versionSummary(
  card: { readonly summary: string; readonly trigger?: string; readonly restoredFrom?: string },
  t: Translate,
  restoredNumber?: number,
): string {
  if (card.restoredFrom !== undefined) {
    return restoredNumber === undefined
      ? t('versions.restoredEarlier')
      : t('versions.restored', { number: restoredNumber });
  }
  const text = card.summary.trim().split('\n')[0] ?? '';
  return text === '' ||
    /\b(?:autosave|saved changes|agent change|agent turn|main|branch|backup|github|checkout|commit|head|git|openscad|cadquery|replicad|opencascade|jscad|kcl|gpt[ -]?\d|claude|gemini|tau)\b|\.(?:[a-z][a-z0-9]{0,7}|3mf)\b|[`{}]|\b[0-9a-f]{12,}\b/iu.test(
      text,
    )
    ? t('versions.changes')
    : text;
}

/** Flatten scalar values internally; raw parameter identifiers are never displayed. */
export function parameterScalars(value: JSONValue, pointer = ''): Map<string, string | number | boolean | undefined> {
  if (value === null || typeof value !== 'object') {
    return new Map([[pointer, value ?? undefined]]);
  }
  return new Map(
    Object.entries(value).flatMap(([key, child]) => [
      ...parameterScalars(child, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`),
    ]),
  );
}

/** Describe only provable scalar changes; invalid or structural-only records retain the generic summary. */
export function parameterChangeSentence({
  original,
  modified,
  language,
}: {
  readonly original: string;
  readonly modified: string;
  readonly language: Language;
}): string | undefined {
  try {
    const before = requireParameterRecord(new TextEncoder().encode(original));
    const after = requireParameterRecord(new TextEncoder().encode(modified));
    const t = bindTranslate(language);
    const changes: string[] = [];
    for (const [name, group] of Object.entries(after.groups)) {
      const previous = before.groups[name];
      if (previous === undefined) {
        continue;
      }
      const oldValues = parameterScalars(previous.values);
      for (const [pointer, value] of parameterScalars(group.values)) {
        const old = oldValues.get(pointer);
        const oldUnit = previous.units?.[pointer] ?? '';
        const unit = group.units?.[pointer] ?? '';
        if (
          old === undefined ||
          (old === value && oldUnit === unit) ||
          typeof old !== 'number' ||
          typeof value !== 'number'
        ) {
          continue;
        }
        const label = name.toLowerCase() === 'default' || /[/.`{}]/u.test(name) ? t('versions.measures') : name;
        const from = `${formatNumber(old, language, { maximumSignificantDigits: 12 })}${oldUnit !== unit && oldUnit !== '' ? ` ${oldUnit}` : ''}`;
        changes.push(
          `${label}: ${from} → ${formatNumber(value, language, { maximumSignificantDigits: 12 })}${unit === '' ? '' : ` ${unit}`}`,
        );
      }
    }
    return changes.length > 1 ? t('versions.otherChanges', { change: changes[0]! }) : changes[0];
  } catch {
    return undefined;
  }
}
