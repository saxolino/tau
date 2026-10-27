/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (famiglie, materiali): snake_case come in Sinopia. */
import type {
  DefinizioneParametro,
  FamigliaQualsiasi,
  IdFamiglia,
  ParametriAnnidati,
  UnitaParametro,
  ValoreParametro,
} from '#famiglie/famiglia.js';
import { leggiParametro, scriviParametro } from '#famiglie/parametri.js';

/**
 * Varianti di una famiglia parametrica (SinopiaCAD D5): 2–3 insiemi di parametri della **stessa** famiglia lungo assi
 * di mestiere (più slanciata, più robusta, più minimale), deterministici e dentro i limiti e i vincoli delle
 * definizioni. Le varianti cambiano le proporzioni, non la funzione: i parametri `critico` (luce della fibbia, altezza
 * del tacco, taglia dell'anello, diametro della pietra) e quelli fissati dal designer restano dove sono, così un
 * cinturino entra ancora nella fibbia e la scarpa resta sulla sua forma. Le prove numeriche (verifiche, peso,
 * anteprima) le fa il worker delle varianti.
 */

/**
 * Un asse di mestiere.
 * @public
 */
export type AsseVariante = 'slanciata' | 'robusta' | 'minimale';

/**
 * Gli assi, nell'ordine in cui le varianti si mostrano.
 * @public
 */
export const ASSI_VARIANTE: readonly AsseVariante[] = ['slanciata', 'robusta', 'minimale'];

/** Una mossa su un parametro: `valore` sostituisce; altrimenti `attuale × fattore + delta`. */
type Mossa = Readonly<{ chiave: string; fattore?: number; delta?: number; valore?: ValoreParametro }>;

type MossePerAsse = Readonly<Record<AsseVariante, readonly Mossa[]>>;

/**
 * Le mosse di ogni asse per famiglia, scritte come le farebbe un modellista: sezioni e spessori per lo slancio e la
 * robustezza, raggi e ornamenti tolti per il minimale. Ogni valore passa poi dalla `normalizza` della famiglia.
 * @public
 */
export const mosseFamiglie: Readonly<Record<IdFamiglia, MossePerAsse>> = {
  fibbia: {
    slanciata: [
      { chiave: 'telaio.sezioneLarghezza', fattore: 0.8 },
      { chiave: 'telaio.sezioneSpessore', fattore: 0.85 },
      { chiave: 'telaio.altezzaInterna', fattore: 1.1 },
      { chiave: 'telaio.raggioAngoli', fattore: 1.4 },
      { chiave: 'ardiglione.diametro', fattore: 0.85 },
    ],
    robusta: [
      { chiave: 'telaio.sezioneLarghezza', fattore: 1.3 },
      { chiave: 'telaio.sezioneSpessore', fattore: 1.25 },
      { chiave: 'ardiglione.diametro', fattore: 1.2 },
      { chiave: 'telaio.raggioAngoli', fattore: 0.8 },
    ],
    minimale: [
      { chiave: 'telaio.profilo', valore: 'piatto' },
      { chiave: 'telaio.raggioAngoli', fattore: 0.5 },
      { chiave: 'telaio.raggioBordo', fattore: 0.6 },
      { chiave: 'traversino.abilitato', valore: false },
    ],
  },
  tacco: {
    slanciata: [
      { chiave: 'vita.scala', fattore: 0.8 },
      { chiave: 'vita.quota', delta: 0.05 },
      { chiave: 'dorso.bombatura', delta: 2 },
      { chiave: 'fronte.bombatura', delta: -2 },
    ],
    robusta: [
      { chiave: 'vita.scala', fattore: 1.25 },
      { chiave: 'dorso.bombatura', delta: -2 },
      { chiave: 'costruzione.parete', fattore: 1.15 },
    ],
    minimale: [
      { chiave: 'dorso.bombatura', valore: 0 },
      { chiave: 'fronte.bombatura', valore: 0 },
      { chiave: 'seduta.raggioAngoli', fattore: 0.7 },
    ],
  },
  placca: {
    slanciata: [
      { chiave: 'piastra.spessore', fattore: 0.8 },
      { chiave: 'piastra.raggioAngoli', fattore: 1.5 },
      { chiave: 'bordo.larghezza', fattore: 0.75 },
    ],
    robusta: [
      { chiave: 'piastra.spessore', fattore: 1.3 },
      { chiave: 'bordo.rilievo', fattore: 1.5 },
      { chiave: 'bordo.larghezza', fattore: 1.3 },
    ],
    minimale: [
      { chiave: 'bordo.rilievo', valore: 0 },
      { chiave: 'piastra.bombatura', valore: 0 },
      { chiave: 'piastra.raggioAngoli', fattore: 0.5 },
    ],
  },
  occhiello: {
    slanciata: [
      { chiave: 'flangia.diametro', fattore: 0.88 },
      { chiave: 'flangia.spessore', fattore: 0.85 },
    ],
    robusta: [
      { chiave: 'flangia.diametro', fattore: 1.15 },
      { chiave: 'flangia.spessore', fattore: 1.25 },
      { chiave: 'parete.spessore', fattore: 1.2 },
    ],
    minimale: [
      { chiave: 'flangia.raggio', fattore: 0.6 },
      { chiave: 'flangia.diametro', fattore: 0.94 },
      { chiave: 'rondella.abilitata', valore: false },
    ],
  },
  borchia: {
    slanciata: [
      { chiave: 'testa.altezza', fattore: 1.25 },
      { chiave: 'gambo.diametro', fattore: 0.85 },
    ],
    robusta: [
      { chiave: 'gambo.diametro', fattore: 1.2 },
      { chiave: 'costruzione.parete', fattore: 1.2 },
      { chiave: 'gambo.lunghezza', fattore: 1.1 },
    ],
    minimale: [{ chiave: 'testa.altezza', fattore: 0.7 }],
  },
  anello: {
    slanciata: [
      { chiave: 'gambo.spessore', fattore: 0.85 },
      { chiave: 'gambo.rastremazione', fattore: 0.85 },
      { chiave: 'griffe.diametro', fattore: 0.85 },
    ],
    robusta: [
      { chiave: 'gambo.spessore', fattore: 1.2 },
      { chiave: 'castone.parete', fattore: 1.2 },
      { chiave: 'griffe.diametro', fattore: 1.15 },
      { chiave: 'griffe.numero', delta: 2 },
    ],
    minimale: [
      { chiave: 'gambo.rastremazione', valore: 1 },
      { chiave: 'griffe.altezzaSopraCintura', fattore: 0.8 },
    ],
  },
  fondo_semplice: {
    slanciata: [
      { chiave: 'fianco.sformo', fattore: 1.5 },
      { chiave: 'bordo.raggioSuperiore', fattore: 1.3 },
      { chiave: 'pianta.sormonto', fattore: 0.8 },
    ],
    robusta: [
      { chiave: 'pianta.sormonto', fattore: 1.3 },
      { chiave: 'bordo.raggioInferiore', fattore: 1.5 },
      { chiave: 'fianco.sformo', fattore: 0.6 },
    ],
    minimale: [
      { chiave: 'bordo.raggioSuperiore', fattore: 0.5 },
      { chiave: 'bordo.raggioInferiore', fattore: 0.5 },
      { chiave: 'spessore.puntaRialzo', fattore: 0.7 },
    ],
  },
  pendente: {
    slanciata: [
      { chiave: 'corpo.spessore', fattore: 0.85 },
      { chiave: 'corpo.larghezza', fattore: 0.85 },
      { chiave: 'anellino.filo', fattore: 0.85 },
    ],
    robusta: [
      { chiave: 'corpo.spessore', fattore: 1.25 },
      { chiave: 'anellino.filo', fattore: 1.2 },
      { chiave: 'corpo.bombatura', fattore: 1.3 },
    ],
    minimale: [
      { chiave: 'corpo.bombatura', valore: 0 },
      { chiave: 'occhiello.foro', valore: 0 },
    ],
  },
  puntale: {
    slanciata: [
      { chiave: 'puntale.altezza', fattore: 0.85 },
      { chiave: 'puntale.spessore', fattore: 0.85 },
    ],
    robusta: [
      { chiave: 'puntale.spessore', fattore: 1.3 },
      { chiave: 'puntale.altezza', fattore: 1.1 },
    ],
    minimale: [{ chiave: 'fori.numero', valore: 0 }],
  },
};

/**
 * Una differenza fra due insiemi di parametri, per la card della variante.
 * @public
 */
export type Differenza = Readonly<{
  chiave: string;
  unita: UnitaParametro;
  prima: ValoreParametro;
  dopo: ValoreParametro;
  /** `(dopo − prima) / |prima|` per i numeri diversi da zero. */
  variazione?: number;
}>;

/**
 * Una variante proposta: i parametri completi e normalizzati, e che cosa cambia rispetto all'attuale.
 * @public
 */
export type PropostaVariante = Readonly<{
  id: string;
  /** `locale`: dal generatore deterministico; `agente`: un insieme scritto dall'agente della chat. */
  origine: 'locale' | 'agente';
  asse?: AsseVariante;
  /** Titolo dell'agente (due o tre parole). */
  titolo?: string;
  /** Motivo dell'agente in una riga. */
  motivo?: string;
  parametri: ParametriAnnidati;
  differenze: readonly Differenza[];
}>;

/**
 * Opzioni delle proposte.
 * @public
 */
export type OpzioniVarianti = Readonly<{
  variante?: string;
  /** Percorsi puntati fissati dal designer (i valori «tuoi» di `.tau/parameters/`): nessuna variante li cambia. */
  bloccati?: Iterable<string>;
  /** Gli assi da proporre (predefinito: tutti e tre). */
  assi?: readonly AsseVariante[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * I parametri della famiglia normalizzati per una variante, come oggetto annidato.
 * @param famiglia - Famiglia del registro.
 * @param p - Parametri anche parziali.
 * @param variante - Variante, o undefined per quella dei parametri.
 * @returns Una copia normalizzata.
 * @public
 */
export const normalizzati = (famiglia: FamigliaQualsiasi, p: unknown, variante?: string): ParametriAnnidati =>
  famiglia.normalizza(p, variante === undefined ? undefined : { variante }) as ParametriAnnidati;

const passoDi = (definizione: DefinizioneParametro): number =>
  definizione.passo ??
  (definizione.unita === 'n' ? 1 : definizione.unita === 'deg' ? 0.5 : definizione.unita === 'frazione' ? 0.01 : 0.1);

/**
 * Arrotonda al passo senza rumore binario (2,1 e non 2,1000000000000001).
 * @param valore - Numero.
 * @param passo - Passo del parametro.
 * @returns Il multiplo del passo più vicino.
 */
const alPasso = (valore: number, passo: number): number => {
  const decimali = Math.max(0, Math.ceil(-Math.log10(passo) - 1e-9));
  return Number((Math.round(valore / passo) * passo).toFixed(decimali));
};

const numerica = (unita: UnitaParametro): boolean =>
  unita === 'mm' || unita === 'deg' || unita === 'n' || unita === 'frazione';

/**
 * Le chiavi che una variante può muovere: non derivate, non critiche, non fissate dal designer, non testi né contorni.
 * @param famiglia - Famiglia del registro.
 * @param bloccati - Percorsi fissati dal designer.
 * @returns Le chiavi mobili.
 * @public
 */
export function chiaviMobili(famiglia: FamigliaQualsiasi, bloccati: Iterable<string> = []): Set<string> {
  const fissate = new Set(bloccati);
  return new Set(
    famiglia.parametri
      .filter(
        (definizione) =>
          definizione.derivato === undefined &&
          definizione.critico !== true &&
          definizione.unita !== 'testo' &&
          definizione.unita !== 'contorno' &&
          !fissate.has(definizione.chiave),
      )
      .map((definizione) => definizione.chiave),
  );
}

const uguali = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : Object.is(a, b);

/**
 * Che cosa cambia fra due insiemi di parametri della stessa famiglia: i numeri prima, per variazione decrescente, poi
 * scelte e interruttori. I parametri derivati compaiono quando cambiano (la luce, la lunghezza dell'ardiglione).
 * @param famiglia - Famiglia del registro.
 * @param prima - Parametri di partenza.
 * @param dopo - Parametri della variante.
 * @returns Le differenze.
 * @public
 */
export function differenzeParametri(famiglia: FamigliaQualsiasi, prima: unknown, dopo: unknown): Differenza[] {
  const differenze: Differenza[] = [];
  for (const definizione of famiglia.parametri) {
    if (definizione.unita === 'testo' || definizione.unita === 'contorno') {
      continue;
    }
    const a = definizione.derivato
      ? definizione.derivato(prima as ParametriAnnidati)
      : (leggiParametro(prima, definizione.chiave) as ValoreParametro | undefined);
    const b = definizione.derivato
      ? definizione.derivato(dopo as ParametriAnnidati)
      : (leggiParametro(dopo, definizione.chiave) as ValoreParametro | undefined);
    if (a === undefined || b === undefined || uguali(a, b)) {
      continue;
    }
    differenze.push({
      chiave: definizione.chiave,
      unita: definizione.unita,
      prima: a,
      dopo: b,
      ...(typeof a === 'number' && typeof b === 'number' && a !== 0 ? { variazione: (b - a) / Math.abs(a) } : {}),
    });
  }
  return differenze.toSorted((x, y) => {
    const rx = x.variazione === undefined ? -1 : Math.abs(x.variazione);
    const ry = y.variazione === undefined ? -1 : Math.abs(y.variazione);
    return ry - rx;
  });
}

/** Ingresso di `applicaMosse`. */
type IngressoMosse = Readonly<{
  famiglia: FamigliaQualsiasi;
  /** Parametri normalizzati di partenza. */
  base: ParametriAnnidati;
  mosse: readonly Mossa[];
  mobili: ReadonlySet<string>;
  /** 1 = mosse intere, 0,5 = metà. */
  frazione: number;
  variante?: string;
}>;

/**
 * Applica le mosse di un asse, per una frazione del loro passo, e normalizza.
 * @param ingresso - Famiglia, partenza, mosse, chiavi mobili, frazione e variante.
 * @returns Parametri normalizzati.
 */
function applicaMosse({ famiglia, base, mosse, mobili, frazione, variante }: IngressoMosse): ParametriAnnidati {
  const definizioni = new Map(famiglia.parametri.map((definizione) => [definizione.chiave, definizione]));
  const p = structuredClone(base);
  for (const mossa of mosse) {
    const definizione = definizioni.get(mossa.chiave);
    if (!definizione || !mobili.has(mossa.chiave)) {
      continue;
    }
    const attuale = leggiParametro(base, mossa.chiave);
    if (numerica(definizione.unita) && typeof attuale === 'number') {
      const obiettivo =
        typeof mossa.valore === 'number' ? mossa.valore : attuale * (mossa.fattore ?? 1) + (mossa.delta ?? 0);
      scriviParametro(p, mossa.chiave, alPasso(attuale + (obiettivo - attuale) * frazione, passoDi(definizione)));
    } else if (mossa.valore !== undefined && frazione >= 0.5) {
      const ammesso =
        definizione.unita === 'bool'
          ? typeof mossa.valore === 'boolean'
          : definizione.unita === 'enum' && definizione.valori?.includes(String(mossa.valore)) === true;
      if (ammesso) {
        scriviParametro(p, mossa.chiave, mossa.valore);
      }
    }
  }
  return normalizzati(famiglia, p, variante);
}

/** Frazioni provate quando la variante intera viola un vincolo: la stessa direzione, più vicina all'attuale. */
const FRAZIONI = [1, 0.5, 0.25] as const;

/**
 * Le varianti della famiglia lungo gli assi di mestiere. Deterministiche: gli stessi parametri danno le stesse
 * varianti. Un asse che non cambia nulla (tutto fissato dal designer, già al limite) non si propone.
 * @param famiglia - Famiglia del registro.
 * @param attuali - Parametri del modello (anche parziali: si completano con i predefiniti della variante).
 * @param opzioni - Variante, chiavi fissate e assi.
 * @returns Da zero a tre proposte.
 * @public
 */
export function proponiVarianti(
  famiglia: FamigliaQualsiasi,
  attuali: unknown,
  opzioni: OpzioniVarianti = {},
): PropostaVariante[] {
  const { variante } = opzioni;
  const base = normalizzati(famiglia, attuali, variante);
  const mobili = chiaviMobili(famiglia, opzioni.bloccati);
  const violazioniBase = famiglia.vincoli(base).length;
  const tabella = mosseFamiglie[famiglia.id];
  const proposte: PropostaVariante[] = [];
  for (const asse of opzioni.assi ?? ASSI_VARIANTE) {
    const mosse = tabella[asse];
    let scelta: ParametriAnnidati | undefined;
    for (const frazione of FRAZIONI) {
      const candidata = applicaMosse({
        famiglia,
        base,
        mosse,
        mobili,
        frazione,
        ...(variante === undefined ? {} : { variante }),
      });
      if (famiglia.vincoli(candidata).length <= violazioniBase) {
        scelta = candidata;
        break;
      }
    }
    if (!scelta) {
      continue;
    }
    const differenze = differenzeParametri(famiglia, base, scelta);
    if (differenze.length === 0) {
      continue;
    }
    proposte.push({ id: `locale-${asse}`, origine: 'locale', asse, parametri: scelta, differenze });
  }
  return proposte;
}

/**
 * Porta una proposta verso l'attuale (stessa direzione, passo ridotto): per il worker, quando la variante intera fa
 * nascere un blocco nelle verifiche.
 * @param famiglia - Famiglia del registro.
 * @param ingresso - Parametri del modello, proposta, quanto della distanza tenere (0–1) e variante.
 * @returns La proposta attenuata, con le sue differenze.
 * @public
 */
export function attenuaProposta(
  famiglia: FamigliaQualsiasi,
  ingresso: Readonly<{ attuali: unknown; proposta: PropostaVariante; frazione: number; variante?: string }>,
): PropostaVariante {
  const { attuali, proposta, frazione, variante } = ingresso;
  const base = normalizzati(famiglia, attuali, variante);
  const mosse: Mossa[] = proposta.differenze.flatMap((differenza) => {
    const definizione = famiglia.parametri.find((voce) => voce.chiave === differenza.chiave);
    return definizione && !definizione.derivato ? [{ chiave: differenza.chiave, valore: differenza.dopo }] : [];
  });
  const mobili = new Set(mosse.map((mossa) => mossa.chiave));
  const parametri = applicaMosse({
    famiglia,
    base,
    mosse,
    mobili,
    frazione,
    ...(variante === undefined ? {} : { variante }),
  });
  return { ...proposta, parametri, differenze: differenzeParametri(famiglia, base, parametri) };
}

/**
 * Scrive in `base` le foglie di `sopra` che stanno fra le chiavi mobili.
 * @param base - Parametri da aggiornare (sul posto).
 * @param sopra - Parametri annidati (anche parziali) dell'agente.
 * @param mobili - Percorsi puntati ammessi, con il prefisso già percorso.
 */
const unisci = (
  base: ParametriAnnidati,
  sopra: unknown,
  mobili: Readonly<{ chiavi: ReadonlySet<string>; percorso: string }>,
): void => {
  if (!isRecord(sopra)) {
    return;
  }
  for (const [chiave, valore] of Object.entries(sopra)) {
    const completo = mobili.percorso === '' ? chiave : `${mobili.percorso}.${chiave}`;
    if (isRecord(valore)) {
      unisci(base, valore, { chiavi: mobili.chiavi, percorso: completo });
    } else if (mobili.chiavi.has(completo)) {
      scriviParametro(base, completo, valore as ValoreParametro);
    }
  }
};

/**
 * Un insieme di parametri scritto dall'agente della chat, portato dentro la famiglia: le chiavi sconosciute, derivate
 * o fissate dal designer si ignorano, il resto passa dalla `normalizza`. L'agente può cambiare anche i parametri
 * critici (glielo chiede la persona), mai quelli fissati.
 * @param famiglia - Famiglia del registro.
 * @param ingresso - Parametri del modello, insieme dell'agente (titolo, motivo, parametri anche parziali),
 *   identificativo, variante e chiavi fissate.
 * @returns La proposta, o undefined se non cambia nulla.
 * @public
 */
export function insiemeAgente(
  famiglia: FamigliaQualsiasi,
  ingresso: OpzioniVarianti &
    Readonly<{
      id: string;
      attuali: unknown;
      insieme: Readonly<{ titolo?: string; motivo?: string; parametri: unknown }>;
    }>,
): PropostaVariante | undefined {
  const { attuali, insieme, variante } = ingresso;
  const base = normalizzati(famiglia, attuali, variante);
  const fissate = new Set(ingresso.bloccati);
  const chiavi = new Set(
    famiglia.parametri
      .filter((definizione) => definizione.derivato === undefined && !fissate.has(definizione.chiave))
      .map((definizione) => definizione.chiave),
  );
  const grezzi = structuredClone(base);
  unisci(grezzi, insieme.parametri, { chiavi, percorso: '' });
  const parametri = normalizzati(famiglia, grezzi, variante);
  const differenze = differenzeParametri(famiglia, base, parametri);
  if (differenze.length === 0) {
    return undefined;
  }
  return {
    id: ingresso.id,
    origine: 'agente',
    ...(insieme.titolo === undefined ? {} : { titolo: insieme.titolo }),
    ...(insieme.motivo === undefined ? {} : { motivo: insieme.motivo }),
    parametri,
    differenze,
  };
}
