import type { DestinoTipo } from '#riconoscimento/condiviso.js';

/**
 * Da `part_type` (catalogo fornitori, Libreria) alla famiglia parametrica (specifica D2 §2.2). Le tabelle entrano nel
 * contratto con la funzione di Sinopia, che le legge da lì: una sola sorgente.
 */

/**
 * La tassonomia dei pezzi reali di Sinopia, nello stesso ordine: `PART_TYPES` di `src/lib/parts/part-types.ts` e il
 * vincolo `supplier_products_part_type_check` (migrazione `20261024100000`).
 * @public
 */
export const partTypesSinopia = [
  'heel',
  'top_lift',
  'sole',
  'welt',
  'midsole_wedge',
  'shank',
  'insole',
  'sockliner',
  'last',
  'leather',
  'textile',
  'lining',
  'trim_edge',
  'counter',
  'toe_puff',
  'buckle',
  'eyelet',
  'stud',
  'ornament',
  'zipper',
  'laces_cords',
  'thread',
  'adhesive',
  'packaging',
  'other_accessory',
] as const;

/** Un tipo dei pezzi reali di Sinopia. @public */
export type PartTypeSinopia = (typeof partTypesSinopia)[number];

const nonModellabile: DestinoTipo = { famiglia: 'non_modellabile' };

/**
 * `part_type` → famiglia. `other_accessory` non è in tabella: il classificatore sceglie fra tutte le famiglie
 * (gioielli e accessori senza tipo, §2.2 ultima riga).
 * @public
 */
export const mappaPartType: Readonly<Partial<Record<PartTypeSinopia, DestinoTipo>>> = {
  heel: { famiglia: 'tacco' },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Sinopia's part_type codes are snake_case.
  top_lift: { famiglia: 'tacco', pezzo: 'Tappo' },
  sole: { famiglia: 'fondo_semplice' },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Sinopia's part_type codes are snake_case.
  midsole_wedge: { famiglia: 'fondo_semplice', variante: 'zeppa' },
  welt: { famiglia: 'fondo_semplice' },
  buckle: { famiglia: 'fibbia', variante: 'rettangolare' },
  eyelet: { famiglia: 'occhiello' },
  stud: { famiglia: 'borchia', variante: 'cupola' },
  // Un ornamento è una placca logo, ma anche una catena, una nappa, un fiocco: il tipo resta un suggerimento.
  ornament: { famiglia: 'placca', variante: 'rettangolo', soloSuggerimento: true },
  shank: nonModellabile,
  insole: nonModellabile,
  sockliner: nonModellabile,
  last: nonModellabile,
  counter: nonModellabile,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Sinopia's part_type codes are snake_case.
  toe_puff: nonModellabile,
  zipper: nonModellabile,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Sinopia's part_type codes are snake_case.
  laces_cords: nonModellabile,
  leather: nonModellabile,
  textile: nonModellabile,
  lining: nonModellabile,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Sinopia's part_type codes are snake_case.
  trim_edge: nonModellabile,
  thread: nonModellabile,
  adhesive: nonModellabile,
  packaging: nonModellabile,
};

/**
 * I tipi della Libreria componenti (`library_components_type_check`, migrazione `20260622150000`).
 * @public
 */
export const tipiLibreria = [
  'texture',
  'accessory',
  'hardware',
  'fabric',
  'strap',
  'closure',
  'chain',
  'panel',
  'lining',
  'reinforcement',
  'sole',
  'heel',
  'insole',
  'lace',
] as const;

/** Un tipo della Libreria componenti. @public */
export type TipoLibreria = (typeof tipiLibreria)[number];

/**
 * Tipo della Libreria → famiglia. `hardware`/`accessory` sono larghi (placca, borchia, pendente): suggerimento.
 * `chain` non ha famiglia: il classificatore sceglie (di solito `libero`).
 * @public
 */
export const mappaLibreria: Readonly<Partial<Record<TipoLibreria, DestinoTipo>>> = {
  heel: { famiglia: 'tacco' },
  sole: { famiglia: 'fondo_semplice' },
  closure: { famiglia: 'fibbia', variante: 'rettangolare', soloSuggerimento: true },
  hardware: { famiglia: 'placca', soloSuggerimento: true },
  accessory: { famiglia: 'placca', soloSuggerimento: true },
  texture: nonModellabile,
  fabric: nonModellabile,
  strap: nonModellabile,
  panel: nonModellabile,
  lining: nonModellabile,
  reinforcement: nonModellabile,
  insole: nonModellabile,
  lace: nonModellabile,
};
