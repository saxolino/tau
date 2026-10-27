import type { IdFamiglia, ParametriAnnidati } from '#famiglie/famiglia.js';
import { leggiParametro } from '#famiglie/parametri.js';

/**
 * Il materiale di ogni pezzo di un oggetto riconosciuto, per `.tau/workbench/entries.json` (`components.materials`): il
 * visore mostra e pesa ogni pezzo nel materiale scelto (`@taucad/viewer/cad/piece-materials`). Il materiale riconosciuto
 * entra nei parametri della famiglia (`costruzione.materiale`, `lega`); qui lo si porta al pezzo, con l'id che il kernel
 * dà al componente (`component:` + il nome del pezzo in minuscolo, trattini al posto dei separatori).
 *
 * Gli id dei componenti dipendono dai nomi dei pezzi che la ricetta costruisce: `materiali-pezzi.test.ts` li confronta
 * con quelli di una costruzione vera, così un pezzo rinominato nella ricetta rompe un test e non il materiale.
 */

/** Il materiale (chiave di `materiali.ts`) → id del materiale del visore. Quelli senza voce non hanno override. */
const materialeVisore: Readonly<Record<string, string>> = {
  oro_18kt_giallo: 'gold-18k-yellow',
  oro_18kt_rosa: 'gold-18k-rose',
  oro_18kt_bianco: 'gold-18k-white',
  argento_925: 'silver-925',
  ottone: 'brass',
  zama: 'zamak',
  inox: 'stainless-steel',
  acciaio: 'stainless-steel',
  cuoio: 'leather',
  gomma: 'rubber',
  tr: 'tr',
  tpu: 'tpu',
  abs: 'abs',
};

/**
 * L'id del materiale del visore per un materiale di famiglia.
 * @param chiave - Chiave di `materiali.ts`.
 * @returns L'id (`brass`), o undefined se il visore non ha quel materiale.
 * @public
 */
export const materialeDelVisore = (chiave: string): string | undefined => materialeVisore[chiave];

const slug = (nome: string): string =>
  `component:${nome
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .replaceAll(/[^\da-z]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')}`;

const testo = (p: ParametriAnnidati, chiave: string): string | undefined => {
  const valore = leggiParametro(p, chiave);
  return typeof valore === 'string' ? valore : undefined;
};

const lati = (p: ParametriAnnidati): readonly string[] => {
  const lato = testo(p, 'costruzione.lato');
  return lato === 'sx' ? ['SX'] : lato === 'dx' ? ['DX'] : ['DX', 'SX'];
};

/** Nome del pezzo e chiave del suo materiale, per famiglia. */
const pezziDi: Readonly<
  Record<IdFamiglia, (p: ParametriAnnidati) => ReadonlyArray<readonly [string, string | undefined]>>
> = {
  tacco: (p) =>
    lati(p).flatMap((lato) => [
      [`Tacco ${lato}`, testo(p, 'costruzione.materiale')],
      [`Tappo ${lato}`, testo(p, 'tappo.materiale')],
      ...(Number(leggiParametro(p, 'anima.diametro')) > 0 ? ([[`Anima ${lato}`, 'acciaio']] as const) : []),
    ]),
  fondo_semplice: (p) => lati(p).map((lato) => [`Fondo ${lato}`, testo(p, 'costruzione.materiale')] as const),
  fibbia: (p) => [
    ['Telaio', testo(p, 'costruzione.materiale')],
    ['Ardiglione', testo(p, 'ardiglione.materiale')],
  ],
  occhiello: (p) => [
    ['Occhiello', testo(p, 'costruzione.materiale')],
    ...(leggiParametro(p, 'rondella.abilitata') === true
      ? ([['Rondella', testo(p, 'costruzione.materiale')]] as const)
      : []),
  ],
  borchia: (p) => [['Borchia', testo(p, 'costruzione.materiale')]],
  placca: (p) => [['Placca', testo(p, 'costruzione.materiale')]],
  puntale: (p) => [['Puntale', testo(p, 'costruzione.materiale')]],
  anello: (p) => [['Anello', testo(p, 'lega')]],
  pendente: (p) => [['Pendente', testo(p, 'lega')]],
};

/** Un pezzo con il suo materiale per il visore. @public */
export type MaterialePezzo = Readonly<{ id: string; material: string }>;

/**
 * I materiali per pezzo di un oggetto di famiglia.
 * @param famiglia - La famiglia.
 * @param parametri - I parametri normalizzati.
 * @returns Un elemento per pezzo il cui materiale ha una voce nel visore (la pietra e i materiali senza voce, no).
 * @public
 */
export function materialiPerPezzo(famiglia: IdFamiglia, parametri: ParametriAnnidati): MaterialePezzo[] {
  return pezziDi[famiglia](parametri).flatMap(([nome, chiave]) => {
    const material = chiave === undefined ? undefined : materialeVisore[chiave];
    return material === undefined ? [] : [{ id: slug(nome), material }];
  });
}
