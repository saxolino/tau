import { requireParameterRecord } from '@taucad/parameters';
import { getActiveGroupValues } from '@taucad/types';
import type { GeometryComponentManifest, FileParameterEntry } from '@taucad/types';
import type { Language } from '#i18n/language.js';
import { bindTranslate, formatNumber } from '#i18n/translate.js';
import { groupPieceMeasures, readablePieceName, valueAtPath } from '#lib/piece-measures.js';

/** A parameter difference with a model selection only when a manifest establishes the piece. */
export type ModelChange = Readonly<{
  id: string;
  entryPath?: string;
  pieceId?: string;
  name: string;
  field: string;
  before?: string;
  after?: string;
  /** Only true when the caller has evidence of a manual write. Presence in a record alone is insufficient. */
  owned: boolean;
}>;

const recordOf = (text: string): FileParameterEntry | undefined => {
  try {
    return requireParameterRecord(new TextEncoder().encode(text));
  } catch {
    return undefined;
  }
};
const objectOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const leaves = (value: unknown, prefix: string[] = []): string[][] => {
  const object = objectOf(value);
  return object ? Object.entries(object).flatMap(([key, item]) => leaves(item, [...prefix, key])) : [prefix];
};
const pointerOf = (path: readonly string[]): string =>
  '/' + path.map((part) => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
const displayValue = (value: unknown, language: Language, unit?: string): string | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
    return undefined;
  }
  const text =
    typeof value === 'number'
      ? formatNumber(value, language, { maximumFractionDigits: 12 })
      : typeof value === 'boolean'
        ? bindTranslate(language)(value ? 'agent.yes' : 'agent.no')
        : value;
  return unit ? `${text} ${unit}` : text;
};

/** Compare immutable sidecar bytes, keeping unknown defaults and units unknown rather than inventing measurements. */
export function turnModelChanges(
  input: Readonly<{
    original: string;
    modified: string;
    manifest?: GeometryComponentManifest;
    language: Language;
    manualPointers?: ReadonlySet<string>;
  }>,
): ModelChange[] {
  const original = recordOf(input.original);
  const modified = recordOf(input.modified);
  if ((!original && input.original !== '') || (!modified && input.modified !== '')) {
    return [];
  }
  const before = getActiveGroupValues(original);
  const after = getActiveGroupValues(modified);
  const keys = { ...before, ...after };
  const groups = groupPieceMeasures(input.manifest, keys);
  const paths = new Map(
    [...leaves(before), ...leaves(after)].filter((path) => path.length > 0).map((path) => [pointerOf(path), path]),
  );
  return [...paths].flatMap(([pointer, path]) => {
    const oldValue = valueAtPath(before, path);
    const newValue = valueAtPath(after, path);
    const oldUnit = original?.groups[original.activeGroup]?.units?.[pointer];
    const newUnit = modified?.groups[modified.activeGroup]?.units?.[pointer];
    if (Object.is(oldValue, newValue) && oldUnit === newUnit && !input.manualPointers?.has(pointer)) {
      return [];
    }
    const group = groups.find((candidate) => candidate.keys.includes(path[0] ?? ''));
    const node = group?.node;
    return [
      {
        id: pointer,
        pieceId: node?.id,
        name: readablePieceName(node?.name ?? path[0] ?? '', input.language),
        field: path
          .slice(1)
          .map((key) => readablePieceName(key, input.language))
          .join(' · '),
        before: displayValue(oldValue, input.language, oldUnit),
        after: displayValue(newValue, input.language, newUnit),
        owned: input.manualPointers?.has(pointer) === true,
      },
    ];
  });
}
