import type { FamigliaQualsiasi, IdFamiglia, ParametriAnnidati, ValoreParametro } from '#famiglie/famiglia.js';
import { leggiParametro, scriviParametro } from '#famiglie/parametri.js';
import { famiglie } from '#famiglie/registro.js';
import { formatAssumption } from '#parameter-assumptions.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';
import { statoValore } from '#riconoscimento/soglie.js';

/**
 * Dalla scheda di riconoscimento al pezzo: variante, parametri normalizzati dalla famiglia, `ipotesi` con confidenza,
 * fonte e banda (marcatore esteso `[sinopia:assumed c= f= min= max=]`) e il `main.ts` che importa la ricetta da
 * `@sinopia/famiglie`. Puro: nessun kernel, gira nel browser e nei test.
 */

/** Il piano di costruzione di un pezzo riconosciuto. @public */
export type PianoCostruzione = Readonly<{
  famiglia: IdFamiglia;
  versione: number;
  variante: string;
  parametri: ParametriAnnidati;
  ipotesi: Record<string, string>;
  main: string;
  /** Vincoli della famiglia ancora violati dopo la normalizzazione (avvisi, non errori). */
  vincoli: ReadonlyArray<{ chiave: string; messaggio: string }>;
}>;

/** Valori fissati dall'utente (risposte ai chip): vincono sulla scheda e non sono ipotesi. @public */
export type RisposteUtente = Readonly<Record<string, ValoreParametro>>;

const testi = {
  it: {
    nonLetto: 'Valore di mestiere: non letto dalla foto',
    riportato: 'Riportato nei limiti della ricetta',
  },
  en: {
    nonLetto: 'Craft default: not read from the photo',
    riportato: 'Brought back within the recipe limits',
  },
} as const;

const uguali = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;

/**
 * La famiglia del registro per un id riconosciuto, se ha una ricetta.
 * @param id - Id della scheda.
 * @returns La famiglia, o undefined per `libero`/`non_modellabile`.
 * @public
 */
export const famigliaDelRegistro = (id: string): FamigliaQualsiasi | undefined =>
  Object.hasOwn(famiglie, id) ? famiglie[id as IdFamiglia] : undefined;

/**
 * Il piano di costruzione: parte dai predefiniti della variante, scrive i parametri riconosciuti e le risposte, lascia
 * che la famiglia normalizzi (limiti e vincoli), e marca come ipotesi ogni valore non misurato: quelli stimati con la
 * loro confidenza, quelli non letti dalla foto come valore di mestiere.
 * @param scheda - La scheda di riconoscimento (normalizzata dal server).
 * @param opzioni - Risposte dell'utente, lingua dei motivi generati qui, famiglia scelta dall'utente al chip.
 * @returns Il piano, o undefined se la famiglia non ha ricetta.
 * @public
 */
export function pianoCostruzione(
  scheda: SchedaRiconoscimento,
  opzioni: Readonly<{ risposte?: RisposteUtente; lingua?: 'it' | 'en'; famiglia?: string }> = {},
): PianoCostruzione | undefined {
  const famiglia = famigliaDelRegistro(opzioni.famiglia ?? scheda.famiglia.id);
  if (famiglia === undefined) {
    return undefined;
  }
  const testo = testi[opzioni.lingua ?? 'it'];
  const stessaFamiglia = famiglia.id === scheda.famiglia.id;
  const variante =
    stessaFamiglia && famiglia.varianti.includes(scheda.variante.id) ? scheda.variante.id : famiglia.varianti[0]!;
  const risposte = opzioni.risposte ?? {};
  const definizioni = new Map(famiglia.parametri.map((definizione) => [definizione.chiave, definizione]));
  const riconosciuti = new Map(
    (stessaFamiglia ? scheda.parametri : [])
      .filter((parametro) => definizioni.has(parametro.chiave))
      .map((p) => [p.chiave, p]),
  );
  const grezzi = structuredClone(famiglia.predefiniti(variante)) as ParametriAnnidati;
  for (const parametro of riconosciuti.values()) {
    scriviParametro(grezzi, parametro.chiave, parametro.valore);
  }
  // Il materiale riconosciuto va alla famiglia: `costruzione.materiale`, o `lega` per anelli e pendenti.
  const chiaveMateriale = ['costruzione.materiale', 'lega'].find(
    (chiave) => definizioni.get(chiave)?.valori !== undefined,
  );
  const materiale = chiaveMateriale === undefined ? undefined : definizioni.get(chiaveMateriale);
  const materialeVoluto =
    stessaFamiglia &&
    chiaveMateriale !== undefined &&
    materiale?.valori?.includes(scheda.materiale.chiave) &&
    !riconosciuti.has(chiaveMateriale) &&
    scheda.materiale.confidenza >= 0.5
      ? scheda.materiale.chiave
      : undefined;
  if (chiaveMateriale !== undefined && materialeVoluto !== undefined) {
    scriviParametro(grezzi, chiaveMateriale, materialeVoluto);
  }
  for (const [chiave, valore] of Object.entries(risposte)) {
    if (definizioni.has(chiave)) {
      scriviParametro(grezzi, chiave, valore);
    }
  }
  let parametri = famiglia.normalizza(grezzi, { variante }) as ParametriAnnidati;
  // La famiglia può riportare il materiale a quello del processo (zama in pressofusione): se il materiale riconosciuto
  // è un altro, è il processo a doversi adattare (ottone → lavorato o fuso), non il materiale a perdersi.
  if (
    chiaveMateriale !== undefined &&
    materialeVoluto !== undefined &&
    leggiParametro(parametri, chiaveMateriale) !== materialeVoluto
  ) {
    const processi = definizioni.get('costruzione.processo')?.valori ?? [];
    for (const processo of processi) {
      const prova = structuredClone(grezzi);
      scriviParametro(prova, 'costruzione.processo', processo);
      const normalizzati = famiglia.normalizza(prova, { variante }) as ParametriAnnidati;
      if (leggiParametro(normalizzati, chiaveMateriale) === materialeVoluto) {
        parametri = normalizzati;
        break;
      }
    }
  }
  const scalaStimata = scheda.scala.fonte === 'stima';
  const ipotesi: Record<string, string> = {};
  for (const definizione of famiglia.parametri) {
    const { chiave } = definizione;
    if (definizione.derivato !== undefined || Object.hasOwn(risposte, chiave) || definizione.unita === 'contorno') {
      continue;
    }
    const finale = leggiParametro(parametri, chiave);
    const parametro = riconosciuti.get(chiave);
    if (parametro === undefined) {
      if (['mm', 'deg', 'frazione'].includes(definizione.unita)) {
        ipotesi[chiave] = formatAssumption({ reason: testo.nonLetto, confidence: 0.3, source: 'default_mestiere' });
      }
      continue;
    }
    const portato = !uguali(finale, parametro.valore);
    const stato = statoValore(parametro, { scalaStimata, unita: definizione.unita });
    if (stato === 'misurata' && !portato) {
      continue;
    }
    ipotesi[chiave] = formatAssumption({
      reason: portato ? `${testo.riportato}. ${parametro.motivo}`.slice(0, 200) : parametro.motivo,
      confidence: portato ? Math.min(parametro.confidenza, 0.3) : parametro.confidenza,
      source: portato ? 'default_mestiere' : parametro.fonte,
      ...(parametro.min === undefined ? {} : { min: parametro.min }),
      ...(parametro.max === undefined ? {} : { max: parametro.max }),
    });
  }
  return {
    famiglia: famiglia.id,
    versione: famiglia.versione,
    variante,
    parametri,
    ipotesi,
    main: famiglia.emettiMain(parametri, ipotesi, { variante }),
    vincoli: famiglia.vincoli(parametri),
  };
}
