import type { RJSFSchema } from '@rjsf/utils';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import type { Language } from '#i18n/language.js';
import { formatNumber } from '#i18n/translate.js';

/** A piece and the top-level parameter keys that belong to it. Missing pieces stay in General. */
export type PieceMeasureGroup = Readonly<{ id: string; node?: GeometryComponentNode; keys: readonly string[] }>;

/** Normalize a model name for matching without guessing by substrings (bezel and stone are distinct). */
export const pieceNameKey = (name: string): string =>
  name
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replaceAll(/(?:^|[_\s-])(sx|sinistr[oa]|left)(?=$|[_\s-])/gu, ' left ')
    .replaceAll(/(?:^|[_\s-])(dx|destr[oa]|right)(?=$|[_\s-])/gu, ' right ')
    .replaceAll(/[^\p{L}\p{N}]/gu, '');

/** Keep authored project names; expand side abbreviations in the current interface language. */
export const readablePieceName = (name: string, language: Language): string => {
  const sides: Record<string, string> =
    language === 'it' ? { sx: 'sinistro', dx: 'destro' } : { sx: 'left', dx: 'right' };
  const words = name
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/);
  const text = words
    .map((word) => {
      const side = sides[word.toLowerCase()];
      return side && language === 'it' && words[0]?.toLowerCase().endsWith('a')
        ? side.replace(/o$/, 'a')
        : (side ?? word);
    })
    .join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Named physical parts in construction order, excluding topology descendants. */
export const modelPieces = (manifest: GeometryComponentManifest | undefined): GeometryComponentNode[] =>
  manifest?.nodeOrder.flatMap((id) => {
    const node = manifest.nodesById[id];
    return node?.kind === 'part' ? [node] : [];
  }) ?? [];

/** Group exact matching parameter objects with their physical pieces, retaining pieces without parameters. */
export const groupPieceMeasures = (
  manifest: GeometryComponentManifest | undefined,
  defaults: Record<string, unknown>,
): PieceMeasureGroup[] => {
  const pieces = modelPieces(manifest);
  const remaining = new Set(Object.keys(defaults));
  const groups = pieces.map((node) => {
    const matching = [...remaining].filter((key) => pieceNameKey(key) === pieceNameKey(node.name));
    for (const key of matching) {
      remaining.delete(key);
    }
    return { id: node.id, node, keys: matching };
  });
  return [...groups, ...(remaining.size > 0 ? [{ id: 'general', keys: [...remaining] }] : [])];
};

/** Read an authored override without treating zero, false or a value equal to the default as absent. */
export const valueAtPath = (value: unknown, path: readonly string[]): unknown => {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = Reflect.get(current, key);
  }
  return current;
};

/** The compact dimensional value of a piece, from current values over model defaults. */
export const pieceKeyValue = ({
  group,
  defaults,
  values,
  language,
}: {
  group: PieceMeasureGroup;
  defaults: Record<string, unknown>;
  values: Record<string, unknown>;
  language: Language;
}): string => {
  const key = group.keys[0];
  if (!key) {
    return '';
  }
  const read = (names: readonly string[]): number | undefined => {
    for (const name of names) {
      const value = valueAtPath(values, [key, name]) ?? valueAtPath(defaults, [key, name]);
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return undefined;
  };
  const length = read(['lunghezza', 'length']);
  const width = read(['larghezza', 'width']);
  const diameter = read(['diametro', 'diameter']);
  const thickness = read(['spessore', 'parete', 'thickness', 'wall']);
  const fmt = (value: number): string => formatNumber(value, language, { maximumFractionDigits: 4 });
  if (length !== undefined && width !== undefined) {
    return `${fmt(length)} × ${fmt(width)} mm`;
  }
  if (diameter !== undefined) {
    return `⌀ ${fmt(diameter)} mm`;
  }
  const value = length ?? thickness ?? width;
  return value === undefined ? '' : `${fmt(value)} mm`;
};

/** Material identification uses explicit role first, then the material color/name. Never infer gold purity from color. */
export const isStonePiece = (node: GeometryComponentNode): boolean => {
  const role = node.extras?.['role'] ?? node.extras?.['ruolo'];
  if (role === 'stone' || role === 'pietra') {
    return true;
  }
  if (role === 'metal' || role === 'metallo') {
    return false;
  }
  const name = node.name.toLowerCase();
  if (/caston|bezel|griff|prong/.test(name)) {
    return false;
  }
  return /pietr|stone|diamond|marquise|gem/.test(name) || node.appearance?.color?.toLowerCase() === '#e3edf2';
};

/** Only report a total when every gold piece carries complete density and mass evidence. */
export const modelMeasureSummary = (
  pieces: readonly GeometryComponentNode[],
): { pieces: number; stones: number; goldMass?: number } => {
  const metals = pieces.filter((node) => !isStonePiece(node));
  const masses = metals.map((node) => node.extras?.['massGrams']);
  const complete =
    metals.length > 0 &&
    metals.every((node) => node.extras?.['density'] === 15.5) &&
    masses.every((mass) => typeof mass === 'number' && Number.isFinite(mass) && mass > 0);
  return {
    pieces: pieces.length,
    stones: pieces.length - metals.length,
    ...(complete ? { goldMass: masses.reduce<number>((sum, mass) => sum + Number(mass), 0) } : {}),
  };
};

/** Keep original nesting/instance pointers while projecting only this group's parameter fields. */
export const pieceParameterSchema = (schema: RJSFSchema | undefined, keys: readonly string[]): RJSFSchema | undefined =>
  schema === undefined
    ? undefined
    : {
        ...schema,
        properties: Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key]) => keys.includes(key))),
        required: schema.required?.filter((key) => keys.includes(key)),
      };

/** Read the lightweight assumption annotation transported by the kernel through the ordinary schema description. */
export const parameterAssumption = (schema: RJSFSchema | undefined, path: readonly string[]): string | undefined => {
  let current = schema;
  for (const key of path) {
    const next: RJSFSchema | boolean | undefined = current?.properties?.[key];
    current = typeof next === 'object' ? next : undefined;
  }
  const description = current?.description;
  return description?.startsWith('[sinopia:assumed]')
    ? description.slice('[sinopia:assumed]'.length).trim()
    : undefined;
};
