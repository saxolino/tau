import type { GeometryComponentNode } from '@taucad/types';

/**
 * One inspection vocabulary for the part menu and Properties panel.
 *
 * @public
 */
export type PartQuantity = {
  readonly volumeCm3?: number;
  readonly densityGPerCm3?: number;
  readonly measurement?: 'measuring' | 'failed' | 'open-mesh';
};

/**
 * The measurement state of a part's volume.
 *
 * @public
 */
export type VolumeState = 'ready' | 'measuring' | 'failed' | 'unavailable' | 'not-measured';

/**
 * Resolve the measurement state of a part's volume. A volume counts as ready only when it is finite and not negative.
 *
 * @param quantity - The part's measured quantities.
 * @returns The volume's measurement state.
 * @public
 */
export function volumeState(quantity: PartQuantity): VolumeState {
  if (quantity.measurement === 'measuring') {
    return 'measuring';
  }
  if (quantity.measurement === 'failed') {
    return 'failed';
  }
  if (quantity.measurement === 'open-mesh') {
    return 'unavailable';
  }
  return quantity.volumeCm3 !== undefined && Number.isFinite(quantity.volumeCm3) && quantity.volumeCm3 >= 0
    ? 'ready'
    : 'not-measured';
}

/**
 * The words, and the locale for numbers, part quantities are described in. A host passes its own to speak its
 * interface language; absent, English.
 *
 * @public
 */
export type PartQuantityWords = Readonly<{
  /** The BCP 47 locale volumes and weights are written with (`en` writes 19.34, `it-IT` writes 19,34). */
  locale: string;
  /** A volume being measured. */
  measuring: string;
  /** A volume that cannot be measured: a failed measurement or an open mesh. */
  unavailable: string;
  notMeasured: string;
  /** A weight without a valid density. */
  unknown: string;
  measuringVolume: string;
  measurementFailed: string;
  openMesh: string;
  volumeNotMeasured: string;
  weightNeedsDensity: string;
  estimate: string;
  appearanceUnavailable: string;
  surfaceMaterials: (count: number) => string;
  unnamedMaterial: string;
}>;

/**
 * The English words every quantity label uses unless a host passes its own.
 *
 * @public
 */
export const englishPartQuantityWords: PartQuantityWords = {
  locale: 'en',
  measuring: 'Measuring…',
  unavailable: 'Unavailable',
  notMeasured: 'Not measured',
  unknown: 'Unknown',
  measuringVolume: 'Measuring volume…',
  measurementFailed: 'Measurement failed.',
  openMesh: 'Open mesh: no enclosed volume.',
  volumeNotMeasured: 'Volume not measured yet.',
  weightNeedsDensity: 'Weight needs a material density.',
  estimate: 'Estimate from volume × density.',
  appearanceUnavailable: 'Appearance unavailable',
  surfaceMaterials: (count) => `${count} surface materials`,
  unnamedMaterial: 'Unnamed material',
};

function stateLabel(state: Exclude<VolumeState, 'ready'>, words: PartQuantityWords): string {
  switch (state) {
    case 'measuring': {
      return words.measuring;
    }
    case 'failed':
    case 'unavailable': {
      return words.unavailable;
    }
    case 'not-measured': {
      return words.notMeasured;
    }
  }
}

const format = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);

/**
 * The weight in grams when the volume is ready and the density valid.
 *
 * @param quantity - The part's measured quantities.
 * @returns The weight, or `undefined`.
 */
function weightGrams(quantity: PartQuantity): number | undefined {
  const density = quantity.densityGPerCm3;
  const volume = quantity.volumeCm3;
  return volumeState(quantity) === 'ready' &&
    volume !== undefined &&
    density !== undefined &&
    Number.isFinite(density) &&
    density > 0
    ? volume * density
    : undefined;
}

/**
 * Format a part's volume in cubic centimetres, or describe why it is not available.
 *
 * @param quantity - The part's measured quantities.
 * @param words - The words and locale to write in.
 * @returns The volume label.
 * @public
 */
export function volumeLabel(quantity: PartQuantity, words: PartQuantityWords = englishPartQuantityWords): string {
  const state = volumeState(quantity);
  if (state !== 'ready') {
    return stateLabel(state, words);
  }
  const volume = quantity.volumeCm3;
  return volume === undefined ? words.notMeasured : `${format(volume, words.locale)} cm³`;
}

/**
 * Format a part's weight in grams from its volume and density, or describe why it is not available.
 *
 * @param quantity - The part's measured quantities.
 * @param words - The words and locale to write in.
 * @returns The weight label, or `words.unknown` when the density is missing.
 * @public
 */
export function weightLabel(quantity: PartQuantity, words: PartQuantityWords = englishPartQuantityWords): string {
  const state = volumeState(quantity);
  if (state !== 'ready') {
    return stateLabel(state, words);
  }
  const weight = weightGrams(quantity);
  return weight === undefined ? words.unknown : `${format(weight, words.locale)} g`;
}

/**
 * Describe the state of a part's volume and weight estimate as a status kind and a sentence.
 *
 * @param quantity - The part's measured quantities.
 * @param words - The words to write in.
 * @returns The status kind and the sentence to show.
 * @public
 */
export function statusOf(
  quantity: PartQuantity,
  words: PartQuantityWords = englishPartQuantityWords,
): {
  readonly kind: 'ready' | 'busy' | 'info' | 'failed';
  readonly sentence: string;
} {
  switch (volumeState(quantity)) {
    case 'measuring': {
      return { kind: 'busy', sentence: words.measuringVolume };
    }
    case 'failed': {
      return { kind: 'failed', sentence: words.measurementFailed };
    }
    case 'unavailable': {
      return { kind: 'info', sentence: words.openMesh };
    }
    case 'not-measured': {
      return { kind: 'info', sentence: words.volumeNotMeasured };
    }
    case 'ready': {
      return weightGrams(quantity) === undefined
        ? { kind: 'info', sentence: words.weightNeedsDensity }
        : { kind: 'ready', sentence: words.estimate };
    }
  }
}

/**
 * Name a part's surface material, count its materials when there are several, or say that none are known.
 *
 * @param node - The part's geometry component node.
 * @param words - The words to write in.
 * @returns The appearance label.
 * @public
 */
export function appearanceLabel(
  node: GeometryComponentNode,
  words: PartQuantityWords = englishPartQuantityWords,
): string {
  const materials = node.appearance?.materials;
  if (!materials?.length) {
    return words.appearanceUnavailable;
  }
  if (materials.length > 1) {
    return words.surfaceMaterials(materials.length);
  }
  const name = materials[0]?.name;
  return typeof name === 'string' ? name.trim() || words.unnamedMaterial : words.unnamedMaterial;
}

/**
 * Combine a part's appearance and, when known, its weight into one label.
 *
 * @param node - The part's geometry component node.
 * @param quantity - The part's measured quantities.
 * @param words - The words and locale to write in.
 * @returns The summary label.
 * @public
 */
export function summaryLabel(
  node: GeometryComponentNode,
  quantity: PartQuantity,
  words: PartQuantityWords = englishPartQuantityWords,
): string {
  const appearance = appearanceLabel(node, words);
  return weightGrams(quantity) === undefined ? appearance : `${appearance} · ${weightLabel(quantity, words)}`;
}
