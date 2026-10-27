import type { RJSFSchema } from '@rjsf/utils';
import { parseAssumptionDescription } from '@taucad/smlib/riconoscimento';
import type { AssumptionDetails } from '@taucad/smlib/riconoscimento';
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

/**
 * The same name without its side, for a pair of pieces that share one group of measures: `Tacco DX` and `Tacco SX`
 * (a family recipe builds the pair from one `tacco` group) are both `tacco`.
 */
const sidelessNameKey = (name: string): string =>
  name
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replaceAll(/(?:^|[_\s-])(sx|sinistr[oa]|left|dx|destr[oa]|right)(?=$|[_\s-])/gu, ' ')
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

/** A parameter key's words: `marquiseLarghezza`, `marquise_larghezza` and `marquise-larghezza` all give two. */
const keyWords = (key: string): string[] =>
  key
    .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0);

/**
 * The single piece a flat measure is named after, by its leading words (`steloDiametro` → Stelo), and the words left
 * for the measure. Models written before measures were nested per piece keep flat keys; a prefix shared by several
 * pieces (`castoneParete` with three bezels) belongs to none of them.
 */
export const flatMeasurePiece = (
  key: string,
  pieces: readonly GeometryComponentNode[],
): { node: GeometryComponentNode; measure: string } | undefined => {
  const words = keyWords(key);
  for (let count = words.length - 1; count >= 1; count -= 1) {
    const prefix = pieceNameKey(words.slice(0, count).join(' '));
    const matches = pieces.filter((node) => pieceNameKey(node.name) === prefix);
    if (matches.length === 1 && matches[0]) {
      return { node: matches[0], measure: words.slice(count).join(' ') };
    }
  }
  return undefined;
};

const isFlatValue = (value: unknown): boolean =>
  typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';

/**
 * Group parameter objects named after a piece, and flat measures led by one piece's name, with their physical pieces;
 * pieces without parameters stay, and what belongs to no single piece is shared.
 */
export const groupPieceMeasures = (
  manifest: GeometryComponentManifest | undefined,
  defaults: Record<string, unknown>,
): PieceMeasureGroup[] => {
  const pieces = modelPieces(manifest);
  const remaining = new Set(Object.keys(defaults));
  const groups = pieces.map((node) => {
    const matching = [...remaining].filter(
      (key) =>
        pieceNameKey(key) === pieceNameKey(node.name) ||
        (isFlatValue(defaults[key]) && flatMeasurePiece(key, pieces)?.node.id === node.id),
    );
    for (const key of matching) {
      remaining.delete(key);
    }
    return { id: node.id, node, keys: matching };
  });
  // A group named after a pair (`tacco` for `Tacco DX` and `Tacco SX`) belongs to both sides.
  const paired = [...remaining].filter((key) => !isFlatValue(defaults[key]));
  for (const key of paired) {
    const sides = groups.filter(
      ({ node }) => sidelessNameKey(node.name) === pieceNameKey(key) && pieceNameKey(node.name) !== pieceNameKey(key),
    );
    for (const group of sides) {
      group.keys.push(key);
    }
    if (sides.length > 0) {
      remaining.delete(key);
    }
  }
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
  const pieces = group.node ? [group.node] : [];
  // A nested piece object reads its fields; flat measures read the key whose remaining words are the field.
  const pathTo = (name: string): readonly string[] | undefined => {
    if (!isFlatValue(defaults[key])) {
      return [key, name];
    }
    const flat = group.keys.find((candidate) => {
      const measure = flatMeasurePiece(candidate, pieces)?.measure;
      return measure !== undefined && pieceNameKey(measure) === pieceNameKey(name);
    });
    return flat === undefined ? undefined : [flat];
  };
  const read = (names: readonly string[]): number | undefined => {
    for (const name of names) {
      const path = pathTo(name);
      const value = path === undefined ? undefined : (valueAtPath(values, path) ?? valueAtPath(defaults, path));
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

/**
 * Read the assumption annotation transported by the kernel through the ordinary schema description: the reason and,
 * from a photo recognition, its confidence, source and plausible band (`[sinopia:assumed c=0.62 f=proporzione min=78
 * max=92] reason`). A plain `[sinopia:assumed] reason` gives the reason alone.
 */
export const parameterAssumption = (
  schema: RJSFSchema | undefined,
  path: readonly string[],
): AssumptionDetails | undefined => {
  let current = schema;
  for (const key of path) {
    const next: RJSFSchema | boolean | undefined = current?.properties?.[key];
    current = typeof next === 'object' ? next : undefined;
  }
  return parseAssumptionDescription(current?.description);
};

/**
 * The three states of a recognised value in the Measures (D2 §2.7): `estimated` (◐, confidence 0.6–0.8, its number
 * shown), `assumed` (○, below 0.6 or without a confidence: the plain «Ipotesi: controlla»), or none above 0.8.
 */
export const assumptionState = (assumption: AssumptionDetails | undefined): 'estimated' | 'assumed' | undefined => {
  if (assumption === undefined) {
    return undefined;
  }
  if (assumption.confidence === undefined || assumption.confidence < 0.6 || assumption.source === 'non_visibile') {
    return 'assumed';
  }
  return assumption.confidence < 0.8 ? 'estimated' : undefined;
};
