/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (famiglie, materiali, processi): snake_case come in Sinopia. */
import type {
  DefinizioneParametro,
  Esito,
  FamigliaQualsiasi,
  IdFamiglia,
  ParametriAnnidati,
  ValoreParametro,
} from '#famiglie/famiglia.js';
import { leggiParametro, scriviParametro } from '#famiglie/parametri.js';
import { normalizzati } from '#varianti/assi.js';

/**
 * Il mestiere che l'assistente usa per parlare per primo (SinopiaCAD D4): quale parametro corregge un esito delle
 * verifiche, in quale materiale provare il pezzo, di che materiale è il pezzo. Tutto deterministico e dentro i limiti
 * delle definizioni.
 */

/**
 * Una modifica di un parametro, prima → dopo.
 * @public
 */
export type Modifica = Readonly<{ chiave: string; prima: ValoreParametro; dopo: ValoreParametro }>;

/**
 * Per famiglia, i parametri che portano a soglia la misura di un esito (codice → chiavi).
 * @public
 */
export const bersagliEsiti: Readonly<Partial<Record<IdFamiglia, Readonly<Record<string, readonly string[]>>>>> = {
  fibbia: {
    PARETE_MIN: ['telaio.sezioneSpessore', 'telaio.sezioneLarghezza'],
    ARDIGLIONE_D: ['ardiglione.diametro'],
  },
  anello: { PARETE_MIN: ['castone.parete'], GAMBO_MIN: ['gambo.spessore'], GRIFFA_BASE: ['griffe.diametro'] },
  borchia: { GAMBO_MIN: ['gambo.diametro'], PARETE_MIN: ['costruzione.parete'] },
  pendente: { PARETE_MIN: ['corpo.spessore'], FILO_ANELLINO: ['anellino.filo'] },
  placca: { PARETE_MIN: ['piastra.spessore'] },
  occhiello: { PARETE_MIN: ['parete.spessore'] },
  puntale: { PARETE_MIN: ['puntale.spessore'] },
  tacco: { PARETE_MIN: ['costruzione.parete'] },
};

const passoDi = (definizione: DefinizioneParametro): number =>
  definizione.passo ?? (definizione.unita === 'n' ? 1 : 0.1);

const decimali = (passo: number): number => Math.max(0, Math.ceil(-Math.log10(passo) - 1e-9));

/**
 * Il primo multiplo del passo che non scende sotto il valore.
 * @param valore - Numero.
 * @param passo - Passo del parametro.
 * @returns Il multiplo.
 */
const sopraAlPasso = (valore: number, passo: number): number =>
  Number((Math.ceil(valore / passo - 1e-9) * passo).toFixed(decimali(passo)));

/**
 * Una correzione candidata di un esito: le modifiche e la soglia da raggiungere.
 * @public
 */
export type Correzione = Readonly<{ codice: string; pezzo?: string; soglia: number; modifiche: readonly Modifica[] }>;

/**
 * Le correzioni candidate di un esito di minimo («sezione 0,6 sotto 0,8»), in ordine: (1) i parametri sotto la soglia
 * portati alla soglia, per le misure che sono il minimo di più parametri (la sezione di una fibbia); (2) i parametri
 * scalati di `soglia / valore`, per le misure che ne sono una frazione (il gambo rastremato di un anello). Arrotondate
 * in su al passo e passate dalla `normalizza`; il worker tiene la prima che fa davvero sparire l'esito. Valgono anche
 * per i valori fissati dal designer: le applica solo un suo clic.
 * @param famiglia - Famiglia del registro.
 * @param ingresso - Parametri del modello, l'esito (`avviso` o `blocco` con valore e soglia) e la variante.
 * @returns Le candidate, senza doppioni né modifiche vuote.
 * @public
 */
export function candidatiCorrezione(
  famiglia: FamigliaQualsiasi,
  ingresso: Readonly<{ attuali: unknown; esito: Esito; variante?: string }>,
): Correzione[] {
  const { attuali, esito, variante } = ingresso;
  const bersagli = bersagliEsiti[famiglia.id]?.[esito.codice];
  const { soglia, valore: misurato } = esito;
  if (!bersagli || soglia === undefined || (esito.livello !== 'avviso' && esito.livello !== 'blocco')) {
    return [];
  }
  const base = normalizzati(famiglia, attuali, variante);
  const strategie: Array<(valore: number) => number | undefined> = [
    (valore) => (valore + 1e-9 >= soglia ? undefined : soglia),
    (valore) =>
      misurato !== undefined && misurato > 0 && misurato < soglia ? (valore * soglia) / misurato : undefined,
  ];
  const visti = new Set<string>();
  const correzioni: Correzione[] = [];
  for (const strategia of strategie) {
    const p = structuredClone(base);
    for (const chiave of bersagli) {
      const definizione = famiglia.parametri.find((voce) => voce.chiave === chiave);
      const valore = leggiParametro(base, chiave);
      const obiettivo = definizione && typeof valore === 'number' ? strategia(valore) : undefined;
      if (!definizione || obiettivo === undefined) {
        continue;
      }
      const alto = sopraAlPasso(obiettivo, passoDi(definizione));
      scriviParametro(p, chiave, definizione.max === undefined ? alto : Math.min(definizione.max, alto));
    }
    const corretti = normalizzati(famiglia, p, variante);
    const modifiche = bersagli.flatMap((chiave): Modifica[] => {
      const prima = leggiParametro(base, chiave) as ValoreParametro | undefined;
      const dopo = leggiParametro(corretti, chiave) as ValoreParametro | undefined;
      return prima === undefined || dopo === undefined || Object.is(prima, dopo) ? [] : [{ chiave, prima, dopo }];
    });
    const impronta = JSON.stringify(modifiche);
    if (modifiche.length > 0 && !visti.has(impronta)) {
      visti.add(impronta);
      correzioni.push({ codice: esito.codice, ...(esito.pezzo ? { pezzo: esito.pezzo } : {}), soglia, modifiche });
    }
  }
  return correzioni;
}

/**
 * Il parametro del materiale principale per famiglia. La fibbia lo ricava dal processo (zama pressofusa, ottone
 * fuso o lavorato).
 * @public
 */
export const chiaveMateriale: Readonly<Record<IdFamiglia, string>> = {
  fibbia: 'costruzione.processo',
  tacco: 'costruzione.materiale',
  placca: 'costruzione.materiale',
  occhiello: 'costruzione.materiale',
  borchia: 'costruzione.materiale',
  anello: 'lega',
  fondo_semplice: 'costruzione.materiale',
  pendente: 'lega',
  puntale: 'costruzione.materiale',
};

/**
 * Il materiale del pezzo principale (chiave di `materiali.ts`).
 * @param famiglia - Famiglia del registro.
 * @param p - Parametri del modello.
 * @returns La chiave, o undefined.
 * @public
 */
export function materialeFamiglia(famiglia: FamigliaQualsiasi, p: unknown): string | undefined {
  const valore = leggiParametro(p, chiaveMateriale[famiglia.id]);
  if (typeof valore !== 'string') {
    return undefined;
  }
  return famiglia.id === 'fibbia' ? (valore === 'pressofusione_zama' ? 'zama' : 'ottone') : valore;
}

/** Il materiale da provare dopo questo, in ordine di preferenza di mestiere. */
const preferenze: Readonly<Record<string, readonly string[]>> = {
  oro_18kt_giallo: ['argento_925'],
  oro_18kt_rosa: ['argento_925'],
  oro_18kt_bianco: ['argento_925'],
  oro_14kt: ['argento_925'],
  oro_9kt: ['argento_925'],
  platino_950: ['oro_18kt_bianco'],
  titanio: ['argento_925'],
  argento_925: ['oro_18kt_giallo', 'ottone'],
  zama: ['ottone'],
  ottone: ['argento_925', 'inox', 'zama', 'alluminio'],
  inox: ['ottone'],
  alluminio: ['ottone'],
  acciaio: ['inox'],
  abs: ['legno_faggio'],
  legno_faggio: ['abs'],
  pa6: ['abs'],
  pa_gf30: ['abs'],
  pu: ['abs'],
  tpu: ['abs'],
  tr: ['gomma'],
  gomma: ['tr'],
  eva: ['tr'],
  pu_espanso: ['tr'],
  cuoio: ['tr'],
  sughero: ['tr'],
};

/**
 * Il pezzo provato in un altro materiale: la prima alternativa di mestiere ammessa dalla famiglia che rispetta i
 * vincoli, cambiando anche il processo quando quel materiale lo chiede (l'ottone di una placca è fuso, non
 * pressofuso).
 * @param famiglia - Famiglia del registro.
 * @param attuali - Parametri del modello.
 * @param opzioni - Variante.
 * @returns Il materiale nuovo e le modifiche, o undefined.
 * @public
 */
export function provaMateriale(
  famiglia: FamigliaQualsiasi,
  attuali: unknown,
  opzioni: Readonly<{ variante?: string }> = {},
): Readonly<{ materiale: string; modifiche: readonly Modifica[] }> | undefined {
  const { variante } = opzioni;
  const base = normalizzati(famiglia, attuali, variante);
  const attuale = materialeFamiglia(famiglia, base);
  if (attuale === undefined) {
    return undefined;
  }
  const violazioni = famiglia.vincoli(base).length;
  const chiave = chiaveMateriale[famiglia.id];
  const processo = famiglia.parametri.find((voce) => voce.chiave === 'costruzione.processo');
  const ammessi = famiglia.parametri.find((voce) => voce.chiave === chiave)?.valori ?? [];
  const modificheDi = (p: ParametriAnnidati): Modifica[] =>
    [...new Set([chiave, 'costruzione.processo'])].flatMap((percorso): Modifica[] => {
      const prima = leggiParametro(base, percorso) as ValoreParametro | undefined;
      const dopo = leggiParametro(p, percorso) as ValoreParametro | undefined;
      return prima === undefined || dopo === undefined || Object.is(prima, dopo)
        ? []
        : [{ chiave: percorso, prima, dopo }];
    });
  if (famiglia.id === 'fibbia') {
    const p = structuredClone(base);
    scriviParametro(p, chiave, attuale === 'zama' ? 'fusione_cera_persa' : 'pressofusione_zama');
    const prova = normalizzati(famiglia, p, variante);
    const materiale = materialeFamiglia(famiglia, prova);
    return materiale === undefined || materiale === attuale ? undefined : { materiale, modifiche: modificheDi(prova) };
  }
  for (const materiale of preferenze[attuale] ?? []) {
    if (!ammessi.includes(materiale)) {
      continue;
    }
    // The material alone, then with each process the family offers, the current one first.
    const processi = [undefined, ...(processo?.valori ?? [])];
    for (const nuovoProcesso of processi) {
      const p = structuredClone(base);
      scriviParametro(p, chiave, materiale);
      if (nuovoProcesso !== undefined) {
        scriviParametro(p, 'costruzione.processo', nuovoProcesso);
      }
      const prova = normalizzati(famiglia, p, variante);
      if (leggiParametro(prova, chiave) === materiale && famiglia.vincoli(prova).length <= violazioni) {
        return { materiale, modifiche: modificheDi(prova) };
      }
    }
  }
  return undefined;
}
