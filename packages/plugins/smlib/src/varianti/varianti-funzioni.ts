import type * as Smlib from '@classcad/smlibwasm';
import type { Esito, IdFamiglia, PezzoFamiglia, Processo } from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';
import { pesoGrammi } from '#famiglie/verifiche-comuni.js';
import { codificaPng } from '#verifica/png.js';
import { anteprimaPezzi } from '#varianti/anteprima.js';
import type { Inquadratura } from '#varianti/anteprima.js';
import { attenuaProposta, insiemeAgente, normalizzati, proponiVarianti } from '#varianti/assi.js';
import type { AsseVariante, PropostaVariante } from '#varianti/assi.js';
import { candidatiCorrezione } from '#varianti/mestiere.js';
import type { Correzione } from '#varianti/mestiere.js';
import { scriviParametro } from '#famiglie/parametri.js';
import { riepilogoSerie } from '#serie/costruzione.js';
import type { RiepilogoSerie } from '#serie/costruzione.js';
import { pianoSerie } from '#serie/piano.js';
import type { RichiestaSerie } from '#serie/piano.js';

/**
 * Le funzioni del worker delle varianti (D4 e D5), esposte da `varianti.worker.ts` e chiamate con `KernelWorker`.
 * Attraversano il confine solo dati semplici: parametri ed esiti entrano ed escono, le miniature escono come PNG.
 * Ogni costruzione sta in `lib.scope`, così i corpi del kernel si liberano subito.
 */

/** Che cosa serve per controllare un insieme di parametri.
 * @public
 */
export type RichiestaControllo = Readonly<{
  famiglia: IdFamiglia;
  variante?: string;
  parametri: unknown;
  processo?: Processo;
}>;

/** Il controllo di un insieme: esiti da guardare, peso del metallo o del materiale, ingombro.
 * @public
 */
export type Controllo = Readonly<{
  /** Solo `avviso` e `blocco`: gli `ok` e le note informative non parlano. */
  esiti: readonly Esito[];
  /** Pezzi esclusa la pietra: volume esatto × densità del materiale. */
  pesoGrammi?: number;
  /** Ingombro del modello in mm (X, Y, Z). */
  ingombro?: readonly [number, number, number];
  millisecondi: number;
}>;

/** Il controllo dell'attuale, con le correzioni provate: ognuna fa sparire il suo esito senza farne nascere altri.
 * @public
 */
export type ControlloAttuale = Controllo & Readonly<{ correzioni: readonly Correzione[] }>;

/** Una richiesta di varianti: dal generatore locale o dagli insiemi dell'agente.
 * @public
 */
export type RichiestaVarianti = Readonly<{
  famiglia: IdFamiglia;
  variante?: string;
  attuali: unknown;
  /** Percorsi fissati dal designer: nessuna variante li cambia. */
  bloccati?: readonly string[];
  assi?: readonly AsseVariante[];
  /** Gli insiemi dell'agente della chat: se ci sono, il generatore locale non interviene. */
  insiemi?: ReadonlyArray<Readonly<{ id: string; titolo?: string; motivo?: string; parametri: unknown }>>;
  processo?: Processo;
  /** La misura delle miniature in pixel; senza, nessuna miniatura. */
  anteprima?: Readonly<{ larghezza: number; altezza: number }>;
}>;

/** Una variante valutata.
 * @public
 */
export type VarianteValutata = PropostaVariante &
  Controllo &
  Readonly<{
    anteprimaPng?: Uint8Array<ArrayBuffer>;
    /** Blocchi che l'attuale non ha: le varianti locali li evitano, quelle dell'agente li dichiarano. */
    nuoviBlocchi: number;
  }>;

/** L'attuale (riferimento delle differenze) e le varianti.
 * @public
 */
export type EsitoVarianti = Readonly<{
  attuale: Controllo & Readonly<{ anteprimaPng?: Uint8Array<ArrayBuffer> }>;
  varianti: readonly VarianteValutata[];
}>;

const famigliaDi = (id: IdFamiglia): NonNullable<(typeof famiglie)[IdFamiglia]> => {
  const famiglia = famiglie[id];
  if (!famiglia) {
    throw new RangeError(`Famiglia sconosciuta o non ancora realizzata: ${id}.`);
  }
  return famiglia;
};

const ingombroDi = (
  lib: typeof Smlib,
  pezzi: readonly PezzoFamiglia[],
): readonly [number, number, number] | undefined => {
  let [min, max] = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ];
  for (const pezzo of pezzi) {
    if (!(pezzo.shape instanceof lib.Part)) {
      continue;
    }
    const box = pezzo.shape.bbox();
    min = [Math.min(min[0]!, box.min.x), Math.min(min[1]!, box.min.y), Math.min(min[2]!, box.min.z)];
    max = [Math.max(max[0]!, box.max.x), Math.max(max[1]!, box.max.y), Math.max(max[2]!, box.max.z)];
  }
  return Number.isFinite(min[0]) ? [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!] : undefined;
};

type Valutazione = Controllo &
  Readonly<{ immagine?: Parameters<typeof codificaPng>[0]; inquadratura?: Inquadratura; tutti: readonly Esito[] }>;

/**
 * Costruisce, verifica e (se chiesto) rende un insieme di parametri dentro uno `scope` del kernel.
 * @param lib - Libreria SMLib.
 * @param richiesta - Famiglia, variante, parametri e processo.
 * @param anteprima - Misura e riquadro della miniatura, o niente.
 * @returns Esiti, peso, ingombro e la miniatura in pixel.
 */
function valuta(
  lib: typeof Smlib,
  richiesta: RichiestaControllo,
  anteprima?: Readonly<{ larghezza: number; altezza: number; inquadratura?: Inquadratura }>,
): Valutazione {
  const inizio = performance.now();
  const famiglia = famigliaDi(richiesta.famiglia);
  const opzioni = richiesta.variante === undefined ? {} : { variante: richiesta.variante };
  return lib.scope(() => {
    const parametri = normalizzati(famiglia, richiesta.parametri, richiesta.variante);
    const { pezzi, esiti: costruzione } = famiglia.costruisciConEsiti(lib, parametri, opzioni);
    const tutti = [...costruzione, ...famiglia.verifiche(lib, pezzi, parametri, richiesta.processo, opzioni)];
    let peso = 0;
    let pesato = false;
    for (const pezzo of pezzi) {
      if (pezzo.ruolo !== 'pietra' && pezzo.shape instanceof lib.Part && typeof pezzo.density === 'number') {
        peso += pesoGrammi(pezzo.shape, pezzo.density);
        pesato = true;
      }
    }
    const ingombro = ingombroDi(lib, pezzi);
    const resa = anteprima
      ? anteprimaPezzi(lib, pezzi, {
          larghezza: anteprima.larghezza,
          altezza: anteprima.altezza,
          ...(anteprima.inquadratura ? { inquadratura: anteprima.inquadratura } : {}),
        })
      : undefined;
    return {
      esiti: tutti.filter((esito) => esito.livello === 'avviso' || esito.livello === 'blocco'),
      tutti,
      ...(pesato ? { pesoGrammi: peso } : {}),
      ...(ingombro ? { ingombro } : {}),
      ...(resa ? { immagine: resa.immagine, inquadratura: resa.inquadratura } : {}),
      millisecondi: performance.now() - inizio,
    };
  });
}

const blocchi = (esiti: readonly Esito[]): Set<string> =>
  new Set(esiti.filter((esito) => esito.livello === 'blocco').map((esito) => `${esito.codice}:${esito.pezzo ?? ''}`));

/** Frazioni con cui una variante locale che fa nascere un blocco si riavvicina all'attuale. */
const ATTENUAZIONI = [0.5, 0.25] as const;

/**
 * Le funzioni del worker sopra una libreria data (quella del worker; nei test quella del processo).
 * @param lib - Libreria SMLib.
 * @returns `controlla` (D4: esiti, peso, ingombro dell'attuale) e `proponi` (D5: varianti valutate con miniatura).
 * @public
 */
export function funzioniVarianti(lib: typeof Smlib): {
  controlla: (richiesta: RichiestaControllo) => Promise<ControlloAttuale>;
  proponi: (richiesta: RichiestaVarianti) => Promise<EsitoVarianti>;
  /** E3b: la tabella riassuntiva di una serie per taglia (misure, volume, peso), nello stesso worker. */
  serie: (richiesta: RichiestaSerie & Readonly<{ processo?: Processo }>) => Promise<RiepilogoSerie>;
} {
  return {
    async serie({ processo, ...richiesta }) {
      return riepilogoSerie(lib, pianoSerie(richiesta), processo === undefined ? {} : { processo });
    },
    async controlla(richiesta) {
      const inizio = performance.now();
      const { tutti, immagine: _immagine, inquadratura: _inquadratura, ...controllo } = valuta(lib, richiesta);
      const famiglia = famigliaDi(richiesta.famiglia);
      const opzioni = richiesta.variante === undefined ? {} : { variante: richiesta.variante };
      const giaBloccati = blocchi(tutti);
      const correzioni: Correzione[] = [];
      for (const esito of controllo.esiti) {
        for (const candidata of candidatiCorrezione(famiglia, { attuali: richiesta.parametri, esito, ...opzioni })) {
          const parametri = structuredClone(normalizzati(famiglia, richiesta.parametri, richiesta.variante));
          for (const modifica of candidata.modifiche) {
            scriviParametro(parametri, modifica.chiave, modifica.dopo);
          }
          const prova = valuta(lib, { ...richiesta, parametri });
          const resta = prova.esiti.some(
            (altro) => altro.codice === esito.codice && (altro.pezzo ?? '') === (esito.pezzo ?? ''),
          );
          const nuovi = [...blocchi(prova.tutti)].filter((chiave) => !giaBloccati.has(chiave)).length;
          if (!resta && nuovi === 0) {
            correzioni.push(candidata);
            break;
          }
        }
      }
      return { ...controllo, correzioni, millisecondi: performance.now() - inizio };
    },
    async proponi(richiesta) {
      const famiglia = famigliaDi(richiesta.famiglia);
      const opzioni = {
        ...(richiesta.variante === undefined ? {} : { variante: richiesta.variante }),
        ...(richiesta.bloccati ? { bloccati: richiesta.bloccati } : {}),
      };
      const base = {
        famiglia: richiesta.famiglia,
        ...(richiesta.variante === undefined ? {} : { variante: richiesta.variante }),
        ...(richiesta.processo === undefined ? {} : { processo: richiesta.processo }),
      };
      const attuale = valuta(lib, { ...base, parametri: richiesta.attuali }, richiesta.anteprima);
      const anteprima = richiesta.anteprima
        ? { ...richiesta.anteprima, ...(attuale.inquadratura ? { inquadratura: attuale.inquadratura } : {}) }
        : undefined;
      const giaBloccati = blocchi(attuale.tutti);
      const nuovi = (esiti: readonly Esito[]): number =>
        [...blocchi(esiti)].filter((chiave) => !giaBloccati.has(chiave)).length;
      const proposte = richiesta.insiemi
        ? richiesta.insiemi.flatMap((insieme) => {
            const proposta = insiemeAgente(famiglia, {
              ...opzioni,
              id: insieme.id,
              attuali: richiesta.attuali,
              insieme,
            });
            return proposta ? [proposta] : [];
          })
        : proponiVarianti(famiglia, richiesta.attuali, {
            ...opzioni,
            ...(richiesta.assi ? { assi: richiesta.assi } : {}),
          });
      const valutate: Array<{ scelta: PropostaVariante; valutazione: Valutazione }> = [];
      for (const proposta of proposte) {
        let scelta = proposta;
        let valutazione = valuta(lib, { ...base, parametri: scelta.parametri }, anteprima);
        if (proposta.origine === 'locale') {
          for (const frazione of ATTENUAZIONI) {
            if (nuovi(valutazione.tutti) === 0) {
              break;
            }
            scelta = attenuaProposta(famiglia, {
              attuali: richiesta.attuali,
              proposta,
              frazione,
              ...(richiesta.variante === undefined ? {} : { variante: richiesta.variante }),
            });
            valutazione = valuta(lib, { ...base, parametri: scelta.parametri }, anteprima);
          }
          if (nuovi(valutazione.tutti) > 0 || scelta.differenze.length === 0) {
            continue;
          }
        }
        valutate.push({ scelta, valutazione });
      }
      const [png, ...pngVarianti] = await Promise.all(
        [attuale, ...valutate.map(({ valutazione }) => valutazione)].map(async ({ immagine }) =>
          immagine ? new Uint8Array(await codificaPng(immagine)) : undefined,
        ),
      );
      const varianti = valutate.map(({ scelta, valutazione }, indice): VarianteValutata => {
        const { tutti, immagine: _immagine, inquadratura: _inquadratura, ...controllo } = valutazione;
        const anteprimaPng = pngVarianti[indice];
        return { ...scelta, ...controllo, ...(anteprimaPng ? { anteprimaPng } : {}), nuoviBlocchi: nuovi(tutti) };
      });
      const { tutti: _tutti, immagine: _immagine, inquadratura: _inquadratura, ...controllo } = attuale;
      return { attuale: { ...controllo, ...(png ? { anteprimaPng: png } : {}) }, varianti };
    },
  };
}
