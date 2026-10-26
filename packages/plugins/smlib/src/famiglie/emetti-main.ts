import type { IdFamiglia, ParametriAnnidati, ValoreParametro } from '#famiglie/famiglia.js';

import { sinopiaFamiglieModuleName } from '#smlib.constants.js';

/** Il modulo built-in da cui il `main.ts` di un progetto importa le famiglie (registrato dal kernel SMLib). */
export const moduloFamiglie = sinopiaFamiglieModuleName;

const identificatore = /^[A-Za-z_$][\w$]*$/;

const chiave = (nome: string): string => (identificatore.test(nome) ? nome : JSON.stringify(nome));

const letterale = (valore: ValoreParametro | ParametriAnnidati | Record<string, string>): string => {
  if (typeof valore === 'object') {
    const campi = Object.entries(valore).map(([nome, figlio]) => `${chiave(nome)}: ${letterale(figlio)}`);
    return `{ ${campi.join(', ')} }`;
  }
  return typeof valore === 'string' ? `'${valore.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'` : String(valore);
};

/**
 * Il `main.ts` di un progetto di famiglia (specifica §1.0.1): `defaultParams` annidati per pezzo, `ipotesi`
 * (lette da `annotateParameterAssumptions`), l'export `famiglia` per l'ispettore e un `main` che delega alla
 * ricetta del modulo built-in, così la ricetta ha una sola implementazione.
 * @param id - Famiglia.
 * @param versione - Versione della ricetta.
 * @param variante - Variante.
 * @param p - Parametri normalizzati.
 * @param ipotesi - Per percorso puntato, perché il valore è un'ipotesi.
 * @returns Il sorgente TypeScript.
 */
export function emettiMainFamiglia(
  id: IdFamiglia,
  versione: number,
  variante: string,
  p: ParametriAnnidati,
  ipotesi: Record<string, string>,
): string {
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
