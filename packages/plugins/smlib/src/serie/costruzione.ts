import type * as Smlib from '@classcad/smlibwasm';
import type { Esito, PezzoFamiglia, Processo } from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';
import { pesoGrammi } from '#famiglie/verifiche-comuni.js';
import type { PianoSerie, VoceSerie } from '#serie/piano.js';

/**
 * Costruzione della serie (E3b) sopra una libreria SMLib: la parte con il kernel, separata dal piano puro.
 *
 * Tre modi, secondo ciò che serve:
 * - `riepilogoSerie`: una riga per taglia (misure, volume, peso, esiti), senza tenere i solidi: per la tabella;
 * - `costruisciSerie`: i pezzi di ogni taglia, vivi, da esportare (chi chiama li libera con `lib.scope`);
 * - `esportaSerieStep`: un file STEP per taglia, con i nomi dei pezzi come nel modello (per l'agente di Esporta).
 */

type Lib = typeof Smlib;

/**
 * Una riga della tabella riassuntiva: la taglia, le sue misure chiave e quanto pesa.
 * @public
 */
export type RigaSerie = Readonly<{
  valore: number;
  etichetta: string;
  nomeFile: string;
  misure: VoceSerie['misure'];
  /** Volume del metallo o del materiale, pietre escluse (mm³). */
  volumeMm3?: number;
  /** Volume × densità del materiale (g). */
  pesoGrammi?: number;
  /** Solo `avviso` e `blocco`. */
  esiti: readonly Esito[];
  /** La costruzione è riuscita (nessun blocco di costruzione). */
  costruita: boolean;
}>;

/**
 * La tabella riassuntiva della serie.
 * @public
 */
export type RiepilogoSerie = Readonly<{
  famiglia: PianoSerie['famiglia'];
  variante: string;
  asse: PianoSerie['asse'];
  regole: PianoSerie['regole'];
  righe: readonly RigaSerie[];
  /** Millisecondi. */
  millisecondi: number;
}>;

/**
 * Un modello della serie, con i solidi.
 * @public
 */
export type ModelloSerie = Readonly<{
  voce: VoceSerie;
  pezzi: readonly PezzoFamiglia[];
  esiti: readonly Esito[];
}>;

/**
 * Un file della serie esportata.
 * @public
 */
export type FileSerie = Readonly<{
  /** Nome senza estensione (`anello-it14-griffe`). */
  nome: string;
  etichetta: string;
  /** Testo STEP (un prodotto per pezzo, col suo nome). */
  step: string;
}>;

const famigliaDi = (piano: PianoSerie): NonNullable<(typeof famiglie)[keyof typeof famiglie]> => {
  const famiglia = famiglie[piano.famiglia];
  if (!famiglia) {
    throw new RangeError(`Famiglia sconosciuta o non ancora realizzata: ${piano.famiglia}.`);
  }
  return famiglia;
};

/**
 * Costruisce i pezzi di ogni taglia (vivi: chi chiama li esporta e poi chiude lo `scope` del kernel).
 * @param lib - Libreria SMLib.
 * @param piano - Il piano della serie.
 * @returns Un modello per taglia, nell'ordine del piano.
 * @public
 */
export function costruisciSerie(lib: Lib, piano: PianoSerie): ModelloSerie[] {
  const famiglia = famigliaDi(piano);
  const opzioni = { variante: piano.variante };
  return piano.voci.map((voce) => {
    const { pezzi, esiti } = famiglia.costruisciConEsiti(lib, voce.parametri, opzioni);
    return { voce, pezzi, esiti };
  });
}

/**
 * La tabella riassuntiva: costruisce ogni taglia in uno `scope` che la libera subito.
 * @param lib - Libreria SMLib.
 * @param piano - Il piano della serie.
 * @param opzioni - Processo con cui verificare le taglie (predefinito: quello della famiglia).
 * @returns Una riga per taglia con volume e peso.
 * @public
 */
export function riepilogoSerie(lib: Lib, piano: PianoSerie, opzioni: { processo?: Processo } = {}): RiepilogoSerie {
  const inizio = performance.now();
  const famiglia = famigliaDi(piano);
  const variante = { variante: piano.variante };
  const righe = piano.voci.map(
    (voce): RigaSerie =>
      lib.scope(() => {
        const { pezzi, esiti: costruzione } = famiglia.costruisciConEsiti(lib, voce.parametri, variante);
        const verifiche = famiglia.verifiche(lib, pezzi, voce.parametri, opzioni.processo, variante);
        let volume = 0;
        let peso = 0;
        let misurato = false;
        for (const pezzo of pezzi) {
          if (pezzo.ruolo !== 'pietra' && pezzo.shape instanceof lib.Part && typeof pezzo.density === 'number') {
            volume += pezzo.shape.volume;
            peso += pesoGrammi(pezzo.shape, pezzo.density);
            misurato = true;
          }
        }
        return {
          valore: voce.valore,
          etichetta: voce.etichetta,
          nomeFile: voce.nomeFile,
          misure: voce.misure,
          ...(misurato ? { volumeMm3: volume, pesoGrammi: peso } : {}),
          esiti: [...costruzione, ...verifiche].filter(({ livello }) => livello === 'avviso' || livello === 'blocco'),
          costruita: pezzi.length > 0 && !costruzione.some(({ livello }) => livello === 'blocco'),
        };
      }),
  );
  return {
    famiglia: piano.famiglia,
    variante: piano.variante,
    asse: piano.asse,
    regole: piano.regole,
    righe,
    millisecondi: performance.now() - inizio,
  };
}

/**
 * Esporta tutta la serie in STEP, un file per taglia. Le taglie non costruite vengono saltate (stanno in `saltate`).
 * @param lib - Libreria SMLib.
 * @param piano - Il piano della serie.
 * @returns I file e le etichette delle taglie che non si sono costruite.
 * @public
 */
export function esportaSerieStep(lib: Lib, piano: PianoSerie): { file: FileSerie[]; saltate: string[] } {
  const famiglia = famigliaDi(piano);
  const variante = { variante: piano.variante };
  const file: FileSerie[] = [];
  const saltate: string[] = [];
  for (const voce of piano.voci) {
    const testo = lib.scope(() => {
      const { pezzi, esiti } = famiglia.costruisciConEsiti(lib, voce.parametri, variante);
      const corpi = pezzi.flatMap((pezzo) => (pezzo.shape instanceof lib.Part ? [pezzo.shape.named(pezzo.name)] : []));
      if (corpi.length === 0 || esiti.some(({ livello }) => livello === 'blocco')) {
        return undefined;
      }
      return lib.toStep(corpi, { assembly: true, name: voce.nomeFile });
    });
    if (testo === undefined) {
      saltate.push(voce.etichetta);
    } else {
      file.push({ nome: voce.nomeFile, etichetta: voce.etichetta, step: testo });
    }
  }
  return { file, saltate };
}

/**
 * La tabella riassuntiva in CSV (separatore `;`, decimali col punto): taglia, misure chiave, volume, peso.
 * @param riepilogo - La tabella.
 * @returns Il testo CSV, con l'intestazione.
 * @public
 */
export function csvSerie(riepilogo: RiepilogoSerie): string {
  const intestazione =
    riepilogo.righe[0]?.misure.map(({ etichetta, unita }) => (unita === 'mm' ? `${etichetta} (mm)` : etichetta)) ?? [];
  const celle = (valori: ReadonlyArray<string | number>): string =>
    valori.map((valore) => (typeof valore === 'number' ? String(Math.round(valore * 1000) / 1000) : valore)).join(';');
  return [
    celle([riepilogo.asse.etichetta, ...intestazione, 'Volume (mm3)', 'Peso (g)']),
    ...riepilogo.righe.map((riga) =>
      celle([riga.etichetta, ...riga.misure.map(({ valore }) => valore), riga.volumeMm3 ?? '', riga.pesoGrammi ?? '']),
    ),
  ].join('\n');
}
