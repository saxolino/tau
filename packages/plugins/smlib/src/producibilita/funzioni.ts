import type * as Smlib from '@classcad/smlibwasm';
import type { Esito, Processo } from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';
import { valutaFamiglia } from '#famiglie/valuta-famiglia.js';
import { esitiProducibilita } from '#producibilita/esiti.js';
import { misuraModello } from '#producibilita/misure.js';
import type { MisureModello, RichiestaProducibilita, RispostaProducibilita } from '#producibilita/tipi.js';

/**
 * Le funzioni del worker della producibilità (esposte da `producibilita.worker.ts`, chiamate con `KernelWorker`).
 *
 * Attraversano il confine solo dati semplici: entra lo STEP che il kernel del progetto esporta (Z in alto, mm: la
 * stessa geometria che si scarica), escono misure, controlli e tempi. Lo STEP riletto dal kernel conserva l'ordine
 * delle facce di `faces()`, lo stesso dei gruppi di facce del GLB: gli indici delle facce valgono anche nel visore.
 */

type Lib = typeof Smlib;

/**
 * Il nome di un corpo come lo STEP lo scrive: il kernel scrive solo ASCII e il suo esportatore porta gli altri
 * caratteri in direttive ISO 10303-21 (`\X2\00E0\X0\` per «à», `\X4\…\X0\` fuori dal piano base, `\\` per la barra);
 * `fromStep` le restituisce così come sono.
 * @param nome - Il nome letto.
 * @returns Il nome originale.
 * @public
 */
export function decodificaNomeStep(nome: string): string {
  return nome
    .replaceAll(/\\X([24])\\([\dA-F]+)\\X0\\/giu, (_tutto, ampiezza: string, esadecimale: string) => {
      const cifre = ampiezza === '2' ? 4 : 8;
      let testo = '';
      for (let inizio = 0; inizio + cifre <= esadecimale.length; inizio += cifre) {
        testo += String.fromCodePoint(Number.parseInt(esadecimale.slice(inizio, inizio + cifre), 16));
      }
      return testo;
    })
    .replaceAll(String.raw`\\`, '\\');
}

const corpiDelloStep = (lib: Lib, step: Uint8Array<ArrayBuffer>): Array<Smlib.Part | Smlib.Shell> => {
  const letti = lib.fromStep(step);
  return (letti instanceof lib.Shape ? [letti] : [...letti]) as Array<Smlib.Part | Smlib.Shell>;
};

/**
 * L'ultima misura e l'ultima valutazione della famiglia: cambiare solo il processo non rimisura la geometria, cambiare
 * solo la direzione non ricostruisce la famiglia.
 * @public
 */
export type MemoriaAnalisi = {
  misure?: { chiave: string; valore: MisureModello };
  famiglia?: { chiave: string; valore: readonly Esito[] };
};

/** Una memoria vuota. */
const creaMemoria = (): MemoriaAnalisi => ({});

/** Impronta dei byte dello STEP (due somme polinomiali modulo due primi): due esportazioni uguali danno la stessa. */
function impronta(byte: Uint8Array<ArrayBuffer>): string {
  let primo = 7;
  let secondo = 11;
  for (const valore of byte) {
    primo = (primo * 31 + valore) % 4_294_967_291;
    secondo = (secondo * 131 + valore) % 2_147_483_647;
  }
  return `${byte.length}:${primo.toString(36)}:${secondo.toString(36)}`;
}

/**
 * Analizza un modello: rilegge lo STEP, misura ogni pezzo, ricostruisce la famiglia (se c'è) per le sue verifiche e
 * fonde i controlli. Non lancia: un passo che fallisce lascia vuota la sua parte.
 * @param lib - Libreria SMLib.
 * @param richiesta - STEP, pezzi con processo e materiale, direzione, famiglia.
 * @param memoria - L'ultima misura e l'ultima famiglia, riusate quando la loro parte della richiesta non cambia.
 * @returns Misure, esiti della famiglia, controlli e tempi.
 * @public
 */
export function analizzaProducibilita(
  lib: Lib,
  richiesta: RichiestaProducibilita,
  memoria: MemoriaAnalisi = creaMemoria(),
): RispostaProducibilita {
  const inizio = performance.now();
  const chiaveMisure = JSON.stringify([
    impronta(richiesta.step),
    richiesta.direzione,
    richiesta.campioniPerFaccia ?? 8,
    richiesta.pezzi.map(({ nome, pietra }) => [nome, pietra === true]),
  ]);
  let misure = memoria.misure?.chiave === chiaveMisure ? memoria.misure.valore : undefined;
  let letto = inizio;
  if (!misure) {
    let corpi: Array<Smlib.Part | Smlib.Shell> = [];
    try {
      corpi = corpiDelloStep(lib, richiesta.step);
    } catch {
      corpi = [];
    }
    letto = performance.now();
    const perNome = new Map(corpi.map((corpo) => [decodificaNomeStep(corpo.name ?? ''), corpo]));
    const stessoNumero = corpi.length === richiesta.pezzi.length;
    const pezzi = richiesta.pezzi.flatMap((pezzo, indice) => {
      const forma = perNome.get(pezzo.nome) ?? (stessoNumero ? corpi[indice] : undefined);
      return forma === undefined ? [] : [{ nome: pezzo.nome, forma, ...(pezzo.pietra ? { pietra: true } : {}) }];
    });
    misure = misuraModello(lib, pezzi, {
      direzione: richiesta.direzione,
      ...(richiesta.campioniPerFaccia === undefined ? {} : { campioniPerFaccia: richiesta.campioniPerFaccia }),
    });
    memoria.misure = { chiave: chiaveMisure, valore: misure };
  }
  const misurato = performance.now();
  let esitiFamiglia: readonly Esito[] = [];
  let processoFamiglia: Processo | undefined;
  const scheda = richiesta.famiglia;
  const famiglia = scheda ? famiglie[scheda.id] : undefined;
  if (scheda && famiglia) {
    processoFamiglia = scheda.processo ?? richiesta.pezzi.find((pezzo) => !pezzo.pietra)?.processo;
    const chiaveFamiglia = JSON.stringify([scheda.id, scheda.variante, scheda.parametri, processoFamiglia]);
    if (memoria.famiglia?.chiave === chiaveFamiglia) {
      esitiFamiglia = memoria.famiglia.valore;
    } else {
      try {
        esitiFamiglia = valutaFamiglia(lib, famiglia, {
          ...(scheda.parametri === undefined ? {} : { parametri: scheda.parametri }),
          ...(scheda.variante === undefined ? {} : { variante: scheda.variante }),
          ...(processoFamiglia === undefined ? {} : { processo: processoFamiglia }),
        }).esiti;
      } catch {
        esitiFamiglia = [];
      }
      memoria.famiglia = { chiave: chiaveFamiglia, valore: esitiFamiglia };
    }
  }
  const famigliaFatta = performance.now();
  const controlli = esitiProducibilita(misure, richiesta.pezzi, { esitiFamiglia });
  const fine = performance.now();
  return {
    misure,
    esitiFamiglia,
    ...(processoFamiglia === undefined ? {} : { processoFamiglia }),
    controlli,
    tempi: {
      lettura: letto - inizio,
      misure: misurato - letto,
      famiglia: famigliaFatta - misurato,
      esiti: fine - famigliaFatta,
      totale: fine - inizio,
    },
  };
}

/**
 * Le funzioni del worker sopra una libreria data (quella del worker; nei test quella del processo).
 * @param lib - Libreria SMLib.
 * @returns `{ analizza }`.
 * @public
 */
export function funzioniProducibilita(lib: Lib): {
  analizza: (richiesta: RichiestaProducibilita) => RispostaProducibilita;
} {
  const memoria = creaMemoria();
  return { analizza: (richiesta) => analizzaProducibilita(lib, richiesta, memoria) };
}
