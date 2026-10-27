import type { IdFamiglia, ParametriAnnidati, ValoreParametro } from '#famiglie/famiglia.js';

import { sinopiaFamiglieModuleName } from '#smlib.constants.js';

/**
 * Il modulo built-in da cui il `main.ts` di un progetto importa le famiglie (registrato dal kernel SMLib).
 * @public
 */
export const moduloFamiglie = sinopiaFamiglieModuleName;

const identificatore = /^[$A-Z_a-z][\w$]*$/;

const chiave = (nome: string): string => (identificatore.test(nome) ? nome : JSON.stringify(nome));

const letterale = (valore: ValoreParametro | ParametriAnnidati | Record<string, string>): string => {
  if (Array.isArray(valore)) {
    return `[${(valore as ReadonlyArray<readonly [number, number]>).map(([x, y]) => `[${x}, ${y}]`).join(', ')}]`;
  }
  if (typeof valore === 'object') {
    const campi = Object.entries(valore as Record<string, ValoreParametro | ParametriAnnidati>).map(
      ([nome, figlio]) => `${chiave(nome)}: ${letterale(figlio)}`,
    );
    return `{ ${campi.join(', ')} }`;
  }
  return typeof valore === 'string'
    ? `'${valore.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)}'`
    : String(valore);
};

/**
 * Il `main.ts` di un progetto di famiglia (specifica §1.0.1): `defaultParams` annidati per pezzo, `ipotesi`
 * (lette da `annotateParameterAssumptions`), l'export `famiglia` per l'ispettore e un `main` che delega alla
 * ricetta del modulo built-in, così la ricetta ha una sola implementazione.
 * @param scheda - Famiglia, versione della ricetta e variante.
 * @param p - Parametri normalizzati.
 * @param ipotesi - Per percorso puntato, perché il valore è un'ipotesi.
 * @returns Il sorgente TypeScript.
 * @public
 */
export function emettiMainFamiglia(
  scheda: { id: IdFamiglia; versione: number; variante: string },
  p: ParametriAnnidati,
  ipotesi: Record<string, string>,
): string {
  const { id, versione, variante } = scheda;
  return [
    `import { ${id} } from '${moduloFamiglie}';`,
    `// mm. Z in alto. Vedi scheda famiglia «${id}» v${versione}.`,
    `export const defaultParams = ${letterale(p)};`,
    `export const ipotesi = ${letterale(ipotesi)};`,
    `export const famiglia = { id: '${id}', versione: ${versione}, variante: ${letterale(variante)} };`,
    `export default function main(p = defaultParams) { return ${id}.costruisci(p, { variante: ${letterale(variante)} }); }`,
    '',
  ].join('\n');
}
