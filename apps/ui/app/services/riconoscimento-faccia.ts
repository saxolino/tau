import { famiglie } from '@taucad/smlib/famiglie';
import type { IdFamiglia } from '@taucad/smlib/famiglie';
import { vistaSenzaFaccia } from '@taucad/smlib/verifica';

/**
 * A recognition sheet without `vista.faccia` (records written before the sheet named the face, or a function not yet
 * updated): the face comes from the view name of the family, and the angles (absolute then, offsets now) are replaced
 * by the name's offsets, as `cameraDaVista` does for the name.
 *
 * @param scheda - The parsed sheet.
 * @param idFamiglia - The family whose views apply (the one built, or the one recognised).
 * @returns The sheet with the face, or the input when it has one or is not a sheet.
 */
export function completaFaccia(scheda: unknown, idFamiglia: unknown): unknown {
  if (typeof scheda !== 'object' || scheda === null) {
    return scheda;
  }
  const vista: unknown = Reflect.get(scheda, 'vista');
  if (typeof vista !== 'object' || vista === null || Reflect.get(vista, 'faccia') !== undefined) {
    return scheda;
  }
  const viste = typeof idFamiglia === 'string' ? famiglie[idFamiglia as IdFamiglia]?.viste : undefined;
  const nome: unknown = Reflect.get(vista, 'nome');
  const completa = viste
    ? vistaSenzaFaccia(viste, typeof nome === 'string' ? nome : undefined)
    : { faccia: 'sopra', azimuth: 0, elevation: 0 };
  return { ...scheda, vista: { ...vista, ...completa } };
}

/**
 * {@link completaFaccia} with the family the sheet itself recognised (an answer of the function).
 *
 * @param scheda - The parsed sheet.
 * @returns The sheet with the face.
 */
export function completaFacciaScheda(scheda: unknown): unknown {
  const famiglia: unknown = typeof scheda === 'object' && scheda !== null ? Reflect.get(scheda, 'famiglia') : undefined;
  return completaFaccia(
    scheda,
    typeof famiglia === 'object' && famiglia !== null ? Reflect.get(famiglia, 'id') : undefined,
  );
}
