import type { JSONSchema7 } from '@taucad/json-schema';
import { famiglie } from '#famiglie/registro.js';

/**
 * Lo schema esplicito dei parametri di unità `contorno` (elenco di punti `[x, y]`).
 *
 * Lo schema ricavato dai valori predefiniti non lo sa dire: da `[]` esce `{ type: 'array' }` senza `items`, che
 * l'ammissione dello schema rifiuta (`INVALID_SCHEMA at /properties/piastra/properties/contorno`) e la placca non si
 * apre; da un contorno pieno esce uno schema con un `default: 0` dentro i punti. Qui lo schema è sempre lo stesso,
 * qualunque sia il predefinito: i valori salvati non cambiano.
 */
const schemaContorno = (massimo: number): JSONSchema7 => ({
  type: 'array',
  items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
  maxItems: massimo,
});

/**
 * Completa lo schema ricavato dai predefiniti con quello esplicito dei parametri `contorno` della famiglia che il
 * modulo dichiara (`export const famiglia = { id }`). Un modulo che non è di una famiglia resta com'è.
 * @param schema - Schema ricavato dai predefiniti.
 * @param modulo - Il modulo valutato.
 * @returns Una copia con i `contorno` espliciti, o lo schema dato.
 */
export function completaSchemaFamiglia(schema: JSONSchema7, modulo: unknown): JSONSchema7 {
  const scheda = typeof modulo === 'object' && modulo !== null && 'famiglia' in modulo ? modulo.famiglia : undefined;
  const id = typeof scheda === 'object' && scheda !== null && 'id' in scheda ? scheda.id : undefined;
  const famiglia =
    typeof id === 'string' ? (famiglie as Record<string, (typeof famiglie)[keyof typeof famiglie]>)[id] : undefined;
  const contorni = famiglia?.parametri.filter(({ unita }) => unita === 'contorno') ?? [];
  if (contorni.length === 0) {
    return schema;
  }
  const risultato = structuredClone(schema);
  for (const { chiave, lunghezzaMassima } of contorni) {
    const segmenti = chiave.split('.');
    let genitore: JSONSchema7 | undefined = risultato;
    for (const segmento of segmenti.slice(0, -1)) {
      const prossimo: JSONSchema7 | boolean | undefined = genitore?.properties?.[segmento];
      genitore = typeof prossimo === 'object' ? prossimo : undefined;
    }
    const foglia = segmenti.at(-1)!;
    const attuale = genitore?.properties?.[foglia];
    if (genitore?.properties && typeof attuale === 'object') {
      genitore.properties[foglia] = {
        ...schemaContorno(lunghezzaMassima ?? 64),
        ...(attuale.default === undefined ? {} : { default: attuale.default }),
        ...(attuale.title === undefined ? {} : { title: attuale.title }),
      };
    }
  }
  return risultato;
}
