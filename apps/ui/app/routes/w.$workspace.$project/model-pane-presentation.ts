import { useMemo } from 'react';
import type { GeometryComponentKind } from '@taucad/types';
import type { PartPropertiesLabels } from '@taucad/viewer/cad/part-properties-panel';
import type { ModelPaneLabels, ModelSource } from '@taucad/workbench-panes/model/model-source';
import { languageLocales } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey, Translate } from '#i18n/translate.js';
import { modelMeasureSummary, modelPieces, readablePieceName } from '#lib/piece-measures.js';

/** How the «Pezzi» panel speaks: its words, the pieces' names, the model's name and the weight line. */
export type ModelPanePresentation = Required<
  Pick<ModelSource, 'labels' | 'componentName' | 'entryTitle' | 'hideLoneEntryHeader' | 'weightSummary'>
>;

const textureSlots: Readonly<Record<string, PlainMessageKey>> = {
  baseColor: 'pieces.properties.textureSlot.baseColor',
  metallicRoughness: 'pieces.properties.textureSlot.metallicRoughness',
  normal: 'pieces.properties.textureSlot.normal',
  occlusion: 'pieces.properties.textureSlot.occlusion',
  emissive: 'pieces.properties.textureSlot.emissive',
};

function kindKey(kind: GeometryComponentKind): PlainMessageKey {
  if (kind === 'part') {
    return 'pieces.properties.kind.part';
  }
  return kind === 'model' || kind === 'assembly' ? 'pieces.properties.kind.group' : 'pieces.properties.kind.other';
}

/**
 * The Properties panel's words in the interface language.
 *
 * @param t - The translator.
 * @param language - The interface language, for numbers.
 * @returns Every word the panel shows.
 */
function partPropertiesLabels(t: Translate, language: Language): PartPropertiesLabels {
  const slot = (name: string): string => {
    const key = Object.hasOwn(textureSlots, name) ? textureSlots[name] : undefined;
    return key ? t(key) : name;
  };
  return {
    locale: languageLocales[language],
    measuring: t('pieces.quantity.measuring'),
    unavailable: t('pieces.quantity.unavailable'),
    notMeasured: t('pieces.quantity.notMeasured'),
    unknown: t('pieces.quantity.unknown'),
    measuringVolume: t('pieces.quantity.measuringVolume'),
    measurementFailed: t('pieces.quantity.measurementFailed'),
    openMesh: t('pieces.quantity.openMesh'),
    volumeNotMeasured: t('pieces.quantity.volumeNotMeasured'),
    weightNeedsDensity: t('pieces.quantity.weightNeedsDensity'),
    estimate: t('pieces.quantity.estimate'),
    appearanceUnavailable: t('pieces.quantity.appearanceUnavailable'),
    surfaceMaterials: (count) => t('pieces.quantity.finishes', { count }),
    unnamedMaterial: t('pieces.quantity.unnamedFinish'),
    noPartSelected: t('pieces.properties.none'),
    kind: (kind) => t(kindKey(kind)),
    currentModel: t('pieces.properties.thisModel'),
    preview: (name) => t('pieces.preview', { name }),
    previewStatus: t('pieces.previewStatus'),
    previewLoading: t('pieces.previewLoading'),
    previewUnavailable: t('pieces.previewUnavailable'),
    retryPreview: t('pieces.retryPreview'),
    appearance: t('pieces.properties.appearance'),
    appearanceMaterials: t('pieces.properties.finishes'),
    extensionsMark: t('pieces.properties.extraEffectsMark'),
    baseColor: t('pieces.properties.color'),
    texture: t('pieces.properties.texture'),
    metalness: t('pieces.properties.metalness'),
    roughness: t('pieces.properties.roughness'),
    extensions: t('pieces.properties.extraEffects'),
    source: t('pieces.properties.origin'),
    sourceDefault: t('pieces.properties.formatDefault'),
    none: t('pieces.properties.noneMasculine'),
    noneSpecified: t('pieces.properties.noneFeminine'),
    textureIndex: (name, index) =>
      t('pieces.properties.textureImage', { slot: slot(name), number: formatNumber(index + 1, language) }),
    textureReference: (name) => t('pieces.properties.textureLinked', { slot: slot(name) }),
    defaultMaterial: t('pieces.properties.defaultFinish'),
    sourceMaterial: (position) => t('pieces.properties.modelFinish', { number: formatNumber(position, language) }),
    physicalFacts: t('pieces.properties.physicalFacts'),
    material: t('pieces.properties.material'),
    notSpecified: t('pieces.properties.notGiven'),
    density: t('pieces.properties.density'),
    volume: t('pieces.properties.volume'),
    weight: t('pieces.properties.weight'),
    measurementStatus: t('pieces.properties.measureStatus'),
    details: t('pieces.properties.details'),
    volumeMethod: t('pieces.properties.volumeMethod'),
    densitySource: t('pieces.properties.densitySource'),
    densitySourceValue: t('pieces.properties.densitySourceValue'),
    basis: t('pieces.properties.basis'),
    basisValue: t('pieces.properties.basisValue'),
    scope: t('pieces.properties.scope'),
    partScope: t('pieces.properties.pieceScope'),
    groupScope: t('pieces.properties.groupScope'),
    excludes: t('pieces.properties.excludes'),
    excludesValue: t('pieces.properties.excludesValue'),
  };
}

/**
 * The «Pezzi» panel's words in the interface language.
 *
 * @param t - The translator.
 * @param language - The interface language, for numbers.
 * @returns Every word the panel shows.
 */
export function modelPaneLabels(t: Translate, language: Language): ModelPaneLabels {
  return {
    filter: t('pieces.search'),
    filterPlaceholder: t('pieces.search'),
    properties: t('pieces.properties.title'),
    components: (model) => t('pieces.list', { model }),
    showHiddenComponents: t('pieces.showHidden'),
    showHiddenComponentsIn: (model) => t('pieces.showHiddenIn', { model }),
    showPart: t('pieces.showPiece'),
    hidePart: t('pieces.hidePiece'),
    isolatePart: t('pieces.isolatePiece'),
    removeIsolation: t('pieces.showAll'),
    show: (name) => t('pieces.show', { name }),
    hide: (name) => t('pieces.hide', { name }),
    isolate: (name) => t('pieces.isolate', { name }),
    removeIsolationFor: (name) => t('pieces.showAllBut', { name }),
    preview: (name) => t('pieces.preview', { name }),
    previewLoading: t('pieces.previewLoading'),
    previewUnavailable: t('pieces.previewUnavailable'),
    noComponents: t('pieces.empty'),
    rendererClosed: t('pieces.notInView'),
    noMatches: t('pieces.noMatches'),
    part: partPropertiesLabels(t, language),
  };
}

/**
 * How the «Pezzi» panel speaks to a designer: the interface language, the pieces by the names Misure gives them, the
 * model as «Modello» and never a file name, one list without a section header for one model, and the gold weight
 * line Misure shows, or no line while the weight is not known.
 *
 * @param t - The translator.
 * @param language - The interface language.
 * @param mainEntryPath - The project's main entry, named «Modello».
 * @returns The Model source's presentation.
 */
export function modelPanePresentation(
  t: Translate,
  language: Language,
  mainEntryPath: string | undefined,
): ModelPanePresentation {
  return {
    labels: modelPaneLabels(t, language),
    componentName: (node) => readablePieceName(node.name, language),
    entryTitle: (entryPath, entryPaths) =>
      entryPath === mainEntryPath || entryPaths.length === 1
        ? t('pieces.model')
        : t('pieces.modelNumber', { number: entryPaths.indexOf(entryPath) + 1 }),
    hideLoneEntryHeader: true,
    weightSummary: (manifest) => {
      const { goldMass } = modelMeasureSummary(modelPieces(manifest));
      return goldMass === undefined
        ? undefined
        : t('measures.goldMass', { mass: formatNumber(goldMass, language, { maximumFractionDigits: 2 }) });
    },
  };
}

/**
 * The «Pezzi» panel's presentation in the current interface language; it changes when the person switches language.
 *
 * @param mainEntryPath - The project's main entry.
 * @returns The Model source's presentation.
 */
export function useModelPanePresentation(mainEntryPath: string | undefined): ModelPanePresentation {
  const { t, language } = useTranslation();
  return useMemo(() => modelPanePresentation(t, language, mainEntryPath), [language, mainEntryPath, t]);
}
