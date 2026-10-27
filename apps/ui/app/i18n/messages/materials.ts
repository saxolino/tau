import { defineMessages } from '#i18n/define-messages.js';

/**
 * Materials a piece is shown and weighed in, their finishes, and the weight line under a piece's measures. The ids are
 * those of `@taucad/viewer/cad/piece-materials`.
 */
export const materialsMessages = defineMessages({
  it: {
    material: 'Materiale',
    finish: 'Finitura',
    asModelled: 'Del modello',
    mixed: 'Misto',
    modelMaterial: 'Materiale del modello',
    modelFinish: 'Finitura',
    materialOf: 'Materiale di {name}',
    finishOf: 'Finitura di {name}',
    weight: '≈ {mass} g',
    weightOf: '{material} ≈ {mass} g',
    weightBasis:
      'Stima: volume del solido {volume} mm³ × densità {density} g/cm³. Escluse placcature, minuteria e tolleranze.',
    weightPlated: 'Stima: volume del solido {volume} mm³ × densità della zama {density} g/cm³ sotto la galvanica.',
    noVolume: 'Peso: volume non misurato',
    noMaterial: 'Scegli un materiale per il peso',
    names: {
      'gold-18k-yellow': 'Oro giallo 18 kt',
      'gold-18k-rose': 'Oro rosa 18 kt',
      'gold-18k-white': 'Oro bianco 18 kt rodiato',
      'silver-925': 'Argento 925',
      brass: 'Ottone',
      zamak: 'Zama',
      'stainless-steel': 'Acciaio inox',
      'palladium-plated': 'Palladio · nichel (galvanica)',
      'gunmetal-plated': 'Canna di fucile (galvanica)',
      leather: 'Cuoio',
      rubber: 'Gomma',
      tr: 'TR',
      tpu: 'TPU',
      abs: 'ABS',
    },
    finishes: {
      polished: 'Lucido',
      satin: 'Satinato',
      sandblasted: 'Sabbiato',
    },
  },
  en: {
    material: 'Material',
    finish: 'Finish',
    asModelled: 'As modelled',
    mixed: 'Mixed',
    modelMaterial: 'Model material',
    modelFinish: 'Finish',
    materialOf: 'Material of {name}',
    finishOf: 'Finish of {name}',
    weight: '≈ {mass} g',
    weightOf: '{material} ≈ {mass} g',
    weightBasis:
      'Estimate: solid volume {volume} mm³ × density {density} g/cm³. Plating, hardware and tolerances excluded.',
    weightPlated: 'Estimate: solid volume {volume} mm³ × density of the zamak under the plating {density} g/cm³.',
    noVolume: 'Weight: volume not measured',
    noMaterial: 'Pick a material for the weight',
    names: {
      'gold-18k-yellow': '18 kt yellow gold',
      'gold-18k-rose': '18 kt rose gold',
      'gold-18k-white': '18 kt white gold, rhodium',
      'silver-925': 'Sterling silver 925',
      brass: 'Brass',
      zamak: 'Zamak',
      'stainless-steel': 'Stainless steel',
      'palladium-plated': 'Palladium · nickel plating',
      'gunmetal-plated': 'Gunmetal plating',
      leather: 'Leather',
      rubber: 'Rubber',
      tr: 'TR',
      tpu: 'TPU',
      abs: 'ABS',
    },
    finishes: {
      polished: 'Polished',
      satin: 'Satin',
      sandblasted: 'Sandblasted',
    },
  },
});
