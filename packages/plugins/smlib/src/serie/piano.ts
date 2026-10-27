import type { IdFamiglia, ParametriAnnidati } from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';
import { leggiParametro, scriviParametro } from '#famiglie/parametri.js';
import { lunghezzaDaTaglia } from '#famiglie/fondo-pianta-canonica.js';
import {
  diametroInterno,
  intervalliTaglia,
  nomeSistemaTaglia,
  passoTaglia,
  rigaTaglia,
  tagliaDaDiametro,
} from '#famiglie/taglie-anello.js';
import type { SistemaTaglia } from '#famiglie/taglie-anello.js';

/**
 * Serie per taglia (E3b): dal modello base alla serie di modelli su un intervallo di taglie, con regole di crescita
 * esplicite. Questo file è puro (nessun kernel): produce il PIANO, cioè i parametri normalizzati di ogni taglia e le
 * misure chiave che si leggono dai parametri. Volumi e pesi li misura `costruzione.ts` sopra una libreria SMLib.
 *
 * Una regola di crescita dice di quanto cambia un parametro per ogni unità dell'asse della serie (mm di diametro
 * interno per gli anelli, mm di lunghezza della pianta per i fondi, mm di altezza per i tacchi), partendo dal valore
 * del modello base: `valore = base + pendenza × (asse − asse del base)`. Una pendenza 0 è una regola anch'essa:
 * dichiara che quel parametro (per esempio un rapporto) non cambia con la taglia. Il grading completo di una suola
 * con battistrada resta fuori da questa serie.
 */

/**
 * Una regola di crescita.
 * @public
 */
export type RegolaCrescita = Readonly<{
  /** Percorso puntato del parametro. */
  chiave: string;
  /** Variazione del parametro per ogni unità dell'asse (stessa unità del parametro per unità dell'asse). */
  pendenza: number;
  /** Frase in italiano per la tabella delle regole. */
  descrizione: string;
  /** `scelta_nostra`: la pendenza è una scelta dichiarata, modificabile; `rapporto`: il parametro è un rapporto che segue da sé. */
  origine: 'scelta_nostra' | 'rapporto';
}>;

/**
 * Una misura chiave di un modello della serie.
 * @public
 */
export type MisuraSerie = Readonly<{
  /** Identificativo stabile (chiave della colonna). */
  id: string;
  etichetta: string;
  valore: number;
  unita: 'mm' | 'taglia' | 'n';
}>;

/**
 * L'asse di una serie: che cosa cambia da un modello al successivo.
 * @public
 */
export type AsseSerie = Readonly<{
  /** Percorso del parametro che porta la taglia (`taglia.valore`, `pianta.taglia`, `tacco.altezza`). */
  chiave: string;
  /** Sistema di taglie (solo gli anelli). */
  sistema?: SistemaTaglia;
  intervallo: readonly [number, number];
  passo: number;
  /** Nome dell'asse per la tabella («Taglia IT», «Taglia EU», «Altezza»). */
  etichetta: string;
  /** Unità dell'asse di crescita delle regole. */
  unitaCrescita: string;
}>;

/**
 * Una taglia della serie: parametri completi e misure chiave.
 * @public
 */
export type VoceSerie = Readonly<{
  /** Valore sull'asse (IT 14 → 14). */
  valore: number;
  /** Nome leggibile («IT 14», «EU 38», «85 mm»). */
  etichetta: string;
  /** Nome sicuro per un file («anello-it14-fascia»). */
  nomeFile: string;
  parametri: ParametriAnnidati;
  misure: readonly MisuraSerie[];
}>;

/**
 * Il piano della serie.
 * @public
 */
export type PianoSerie = Readonly<{
  famiglia: IdFamiglia;
  variante: string;
  asse: AsseSerie;
  regole: readonly RegolaCrescita[];
  voci: readonly VoceSerie[];
}>;

/**
 * Che cosa chiede una serie.
 * @public
 */
export type RichiestaSerie = Readonly<{
  famiglia: IdFamiglia;
  variante?: string;
  /** Parametri del modello base (anche parziali): le altre misure restano quelle. */
  base?: unknown;
  /** Estremi inclusi nell'unità dell'asse; senza, tutto l'intervallo ammesso fino a 8 taglie attorno al base. */
  da?: number;
  a?: number;
  /** Passo fra una taglia e la successiva (predefinito: quello dell'asse). */
  passo?: number;
  /** Sistema di taglie degli anelli (predefinito: quello del base). */
  sistema?: SistemaTaglia;
  /** Regole al posto di quelle predefinite della famiglia (per chiave). */
  regole?: readonly RegolaCrescita[];
}>;

/** Una serie ha al massimo questo numero di taglie: ogni modello è una costruzione del kernel. */
export const taglieMassimeSerie = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numeroDi = (p: ParametriAnnidati, chiave: string): number => {
  const valore = leggiParametro(p, chiave);
  return typeof valore === 'number' ? valore : Number.NaN;
};

const arrotonda = (valore: number, decimali = 2): number => {
  const fattore = 10 ** decimali;
  return Math.round(valore * fattore) / fattore;
};

const testoNumero = (valore: number): string => String(arrotonda(valore, 1));

type Descrittore = {
  asse: (p: ParametriAnnidati, richiesta: RichiestaSerie) => AsseSerie;
  /** Posizione sull'asse di crescita (mm) di un insieme di parametri. */
  posizione: (p: ParametriAnnidati) => number;
  regole: readonly RegolaCrescita[];
  etichetta: (p: ParametriAnnidati, asse: AsseSerie) => string;
  misure: (p: ParametriAnnidati) => readonly MisuraSerie[];
};

const misuraMm = (id: string, etichetta: string, valore: number): MisuraSerie => ({
  id,
  etichetta,
  valore: arrotonda(valore, 3),
  unita: 'mm',
});

const descrittori: Partial<Record<IdFamiglia, Descrittore>> = {
  anello: {
    asse: (p, richiesta) => {
      const sistema = richiesta.sistema ?? (leggiParametro(p, 'taglia.sistema') as SistemaTaglia);
      return {
        chiave: 'taglia.valore',
        sistema,
        intervallo: intervalliTaglia[sistema],
        passo: passoTaglia[sistema],
        etichetta: `Taglia ${nomeSistemaTaglia[sistema]}`,
        unitaCrescita: 'mm di diametro interno',
      };
    },
    posizione: (p) =>
      diametroInterno(leggiParametro(p, 'taglia.sistema') as SistemaTaglia, numeroDi(p, 'taglia.valore')),
    regole: [
      {
        chiave: 'gambo.spessore',
        pendenza: 0.02,
        origine: 'scelta_nostra',
        descrizione: 'Lo spessore del gambo cresce di 0,02 mm per ogni mm di diametro interno.',
      },
      {
        chiave: 'gambo.larghezza',
        pendenza: 0.03,
        origine: 'scelta_nostra',
        descrizione: 'La larghezza del gambo cresce di 0,03 mm per ogni mm di diametro interno.',
      },
      {
        chiave: 'gambo.rastremazione',
        pendenza: 0,
        origine: 'rapporto',
        descrizione: 'La rastremazione è un rapporto: resta quella del modello base.',
      },
      {
        chiave: 'pietra.diametro',
        pendenza: 0,
        origine: 'scelta_nostra',
        descrizione: 'La pietra non cambia con la taglia: la testa resta la stessa.',
      },
    ],
    etichetta: (p, asse) => `${nomeSistemaTaglia[asse.sistema ?? 'it']} ${numeroDi(p, asse.chiave)}`,
    misure: (p) => {
      const riga = rigaTaglia(leggiParametro(p, 'taglia.sistema') as SistemaTaglia, numeroDi(p, 'taglia.valore'));
      return [
        misuraMm('diametro', 'Diametro interno', riga.diametro),
        misuraMm('circonferenza', 'Circonferenza interna', riga.circonferenza),
        { id: 'it', etichetta: 'IT', valore: riga.it, unita: 'taglia' },
        { id: 'eu_iso', etichetta: 'EU', valore: riga.eu_iso, unita: 'taglia' },
        { id: 'us', etichetta: 'US', valore: riga.us, unita: 'taglia' },
        misuraMm('gamboSpessore', 'Spessore del gambo', numeroDi(p, 'gambo.spessore')),
        misuraMm('gamboLarghezza', 'Larghezza del gambo', numeroDi(p, 'gambo.larghezza')),
      ];
    },
  },
  fondo_semplice: {
    asse: () => ({
      chiave: 'pianta.taglia',
      intervallo: [35, 47],
      passo: 1,
      etichetta: 'Taglia EU',
      unitaCrescita: 'mm di lunghezza della pianta',
    }),
    posizione: (p) => lunghezzaDaTaglia(numeroDi(p, 'pianta.taglia')),
    regole: [
      {
        chiave: 'pianta.rapportoPianta',
        pendenza: 0,
        origine: 'rapporto',
        descrizione: 'La larghezza in pianta è sempre la stessa frazione della lunghezza (rapporto del modello base).',
      },
      {
        chiave: 'pianta.rapportoTallone',
        pendenza: 0,
        origine: 'rapporto',
        descrizione: 'La larghezza al tallone è sempre la stessa frazione della lunghezza (rapporto del modello base).',
      },
      {
        chiave: 'spessore.punta',
        pendenza: 0,
        origine: 'scelta_nostra',
        descrizione: 'Lo spessore del fondo è di prodotto, non di forma: non cresce con la taglia.',
      },
      {
        chiave: 'spessore.tallone',
        pendenza: 0,
        origine: 'scelta_nostra',
        descrizione: 'Lo spessore al tallone non cresce con la taglia.',
      },
    ],
    etichetta: (p, asse) => `EU ${numeroDi(p, asse.chiave)}`,
    misure: (p) => {
      const lunghezza = lunghezzaDaTaglia(numeroDi(p, 'pianta.taglia'));
      return [
        { id: 'taglia', etichetta: 'EU', valore: numeroDi(p, 'pianta.taglia'), unita: 'taglia' },
        misuraMm('lunghezza', 'Lunghezza', lunghezza),
        misuraMm('larghezzaPianta', 'Larghezza in pianta', numeroDi(p, 'pianta.rapportoPianta') * lunghezza),
        misuraMm('larghezzaTallone', 'Larghezza al tallone', numeroDi(p, 'pianta.rapportoTallone') * lunghezza),
        misuraMm('spessorePunta', 'Spessore in punta', numeroDi(p, 'spessore.punta')),
      ];
    },
  },
  tacco: {
    asse: () => ({
      chiave: 'tacco.altezza',
      intervallo: [20, 140],
      passo: 5,
      etichetta: 'Altezza del tacco',
      unitaCrescita: 'mm di altezza',
    }),
    posizione: (p) => numeroDi(p, 'tacco.altezza'),
    regole: [
      {
        chiave: 'seduta.lunghezza',
        pendenza: 0,
        origine: 'scelta_nostra',
        descrizione: 'La seduta (dove il tacco si attacca alla scarpa) non cambia con l’altezza.',
      },
      {
        chiave: 'seduta.larghezza',
        pendenza: 0,
        origine: 'scelta_nostra',
        descrizione: 'La seduta non cambia con l’altezza.',
      },
    ],
    etichetta: (p, asse) => `${testoNumero(numeroDi(p, asse.chiave))} mm`,
    misure: (p) => [
      misuraMm('altezza', 'Altezza', numeroDi(p, 'tacco.altezza')),
      misuraMm('tappoAltezza', 'Altezza del tappo', numeroDi(p, 'tappo.altezza')),
      misuraMm('sedutaLunghezza', 'Seduta, lunghezza', numeroDi(p, 'seduta.lunghezza')),
    ],
  },
};

/**
 * Le famiglie per cui esiste una serie.
 * @public
 */
export const famiglieConSerie: readonly IdFamiglia[] = Object.keys(descrittori) as IdFamiglia[];

/**
 * L'intervallo che si propone per una serie, secondo la famiglia (e il sistema di taglie degli anelli): quello che
 * una bottega chiede di solito, non tutto l'intervallo ammesso.
 * @param famiglia - Identificativo.
 * @param sistema - Sistema di taglie (anelli).
 * @returns Estremi e passo, o undefined dove non c'è serie.
 * @public
 */
export function intervalloConsigliato(
  famiglia: IdFamiglia,
  sistema?: SistemaTaglia,
): Readonly<{ da: number; a: number; passo: number }> | undefined {
  switch (famiglia) {
    case 'anello': {
      const consigliati: Record<SistemaTaglia, { da: number; a: number; passo: number }> = {
        it: { da: 8, a: 24, passo: 1 },
        us: { da: 4, a: 12, passo: 1 },
        eu_iso: { da: 48, a: 64, passo: 1 },
        diametro: { da: 15, a: 20, passo: 0.5 },
      };
      return consigliati[sistema ?? 'it'];
    }
    case 'fondo_semplice': {
      return { da: 35, a: 42, passo: 1 };
    }
    case 'tacco': {
      return { da: 40, a: 100, passo: 10 };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Le regole di crescita predefinite di una famiglia.
 * @param famiglia - Identificativo.
 * @returns Le regole, vuote dove la famiglia non ha serie.
 * @public
 */
export const regoleDiCrescita = (famiglia: IdFamiglia): readonly RegolaCrescita[] =>
  descrittori[famiglia]?.regole ?? [];

const nomeFileSicuro = (testo: string): string =>
  testo
    .toLowerCase()
    .replaceAll('⌀', 'd')
    .replaceAll(/[^a-z0-9]+/g, '')
    .slice(0, 24);

/**
 * L'asse della serie di una famiglia, per costruire il selettore degli estremi.
 * @param famiglia - Identificativo.
 * @param opzioni - Base e sistema (per gli anelli).
 * @returns L'asse, o undefined dove non c'è serie.
 * @public
 */
export function asseDellaSerie(
  famiglia: IdFamiglia,
  opzioni: { base?: unknown; variante?: string; sistema?: SistemaTaglia } = {},
): AsseSerie | undefined {
  const definizione = famiglie[famiglia];
  const descrittore = descrittori[famiglia];
  if (!definizione || !descrittore) {
    return undefined;
  }
  const base = definizione.normalizza(
    opzioni.base,
    opzioni.variante === undefined ? {} : { variante: opzioni.variante },
  );
  return descrittore.asse(base, { famiglia, ...(opzioni.sistema ? { sistema: opzioni.sistema } : {}) });
}

/**
 * Prepara la serie: i valori sull'asse, i parametri di ogni taglia con le regole di crescita e le misure chiave.
 * Lancia `RangeError` se la famiglia non ha serie, l'intervallo è vuoto o fuori dai limiti, o le taglie sono più
 * di `taglieMassimeSerie`.
 * @param richiesta - Famiglia, base, estremi, passo, regole.
 * @returns Il piano.
 * @public
 */
export function pianoSerie(richiesta: RichiestaSerie): PianoSerie {
  const definizione = famiglie[richiesta.famiglia];
  const descrittore = descrittori[richiesta.famiglia];
  if (!definizione || !descrittore) {
    throw new RangeError(`La famiglia ${richiesta.famiglia} non ha una serie per taglia.`);
  }
  const opzioni = richiesta.variante === undefined ? {} : { variante: richiesta.variante };
  const variante = richiesta.variante ?? definizione.varianti[0] ?? '';
  const grezza = isRecord(richiesta.base) ? structuredClone(richiesta.base) : {};
  if (richiesta.sistema && richiesta.famiglia === 'anello') {
    // Il base dato in un altro sistema si riporta al sistema della serie, alla taglia più vicina.
    const prima = definizione.normalizza(grezza, opzioni) as ParametriAnnidati;
    const sistemaPrima = leggiParametro(prima, 'taglia.sistema') as SistemaTaglia;
    if (sistemaPrima !== richiesta.sistema) {
      const diametro = diametroInterno(sistemaPrima, numeroDi(prima, 'taglia.valore'));
      scriviParametro(grezza as ParametriAnnidati, 'taglia.sistema', richiesta.sistema);
      scriviParametro(grezza as ParametriAnnidati, 'taglia.valore', tagliaDaDiametro(richiesta.sistema, diametro));
    }
  }
  const base = definizione.normalizza(grezza, opzioni) as ParametriAnnidati;
  const asse = descrittore.asse(base, richiesta);
  const [minimo, massimo] = asse.intervallo;
  const passo = richiesta.passo ?? asse.passo;
  if (!(passo > 0)) {
    throw new RangeError('Il passo della serie deve essere positivo.');
  }
  const valoreBase = numeroDi(base, asse.chiave);
  const da = richiesta.da ?? Math.max(minimo, valoreBase - 3 * passo);
  const a = richiesta.a ?? Math.min(massimo, da + 7 * passo);
  if (da > a) {
    throw new RangeError('Nella serie la prima taglia supera l’ultima.');
  }
  if (da < minimo - 1e-9 || a > massimo + 1e-9) {
    throw new RangeError(`La serie va da ${minimo} a ${massimo} (${asse.etichetta}).`);
  }
  const valori: number[] = [];
  for (let indice = 0; da + indice * passo <= a + 1e-9; indice++) {
    valori.push(arrotonda(da + indice * passo));
  }
  if (valori.length > taglieMassimeSerie) {
    throw new RangeError(`Una serie ha al massimo ${taglieMassimeSerie} taglie.`);
  }
  const regole = richiesta.regole ?? descrittore.regole;
  const posizioneBase = descrittore.posizione(base);
  const voci = valori.map((valore): VoceSerie => {
    const parametri = structuredClone(base);
    if (asse.sistema) {
      scriviParametro(parametri, 'taglia.sistema', asse.sistema);
    }
    scriviParametro(parametri, asse.chiave, valore);
    const delta = descrittore.posizione(parametri) - posizioneBase;
    for (const regola of regole) {
      const partenza = numeroDi(base, regola.chiave);
      if (Number.isFinite(partenza) && regola.pendenza !== 0) {
        scriviParametro(parametri, regola.chiave, arrotonda(partenza + regola.pendenza * delta, 3));
      }
    }
    // I limiti e i vincoli della famiglia valgono anche dentro la serie.
    const normalizzati = definizione.normalizza(parametri, opzioni) as ParametriAnnidati;
    const etichetta = descrittore.etichetta(normalizzati, asse);
    return {
      valore,
      etichetta,
      nomeFile: `${richiesta.famiglia}-${nomeFileSicuro(etichetta)}-${variante}`,
      parametri: normalizzati,
      misure: descrittore.misure(normalizzati),
    };
  });
  return { famiglia: richiesta.famiglia, variante, asse, regole, voci };
}
