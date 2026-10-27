import type { Esito, IdFamiglia, Processo } from '#famiglie/famiglia.js';

/**
 * Tipi delle verifiche di producibilità (E1): le misure della geometria vera di ogni pezzo, indipendenti dal
 * processo, e i controlli che ne nascono per un processo. Tutto dato semplice: attraversa il confine del worker e
 * l'assistente lo può leggere senza il kernel.
 */

/**
 * Un vettore in millimetri o una direzione negli assi del modello (Z in alto).
 * @public
 */
export type Vettore3 = readonly [number, number, number];

/**
 * Lo sformo di una faccia rispetto alla direzione di sformo `d` (`draftAnalysis`): il minimo e il massimo angolo
 * (gradi) verso `+d`. Uno stampo a due metà la stacca verso `+d` se `min ≥ 0`, verso `−d` se `max ≤ 0`; altrimenti la
 * faccia sta a cavallo del piano di divisione.
 * @public
 */
export type SformoFaccia = Readonly<{ min: number; max: number }>;

/**
 * Un foro: una parete cilindrica concava che gira attorno al suo asse per più di 200°, in una o più facce.
 * @public
 */
export type ForoMisurato = Readonly<{ facce: readonly number[]; diametro: number }>;

/**
 * Una griffa: un perno cilindrico convesso sottile che sale accanto a una pietra.
 * @public
 */
export type GriffaMisurata = Readonly<{
  facce: readonly number[];
  /** Diametro alla base (mm). */
  diametro: number;
  /** Quanto la punta sale sopra la cintura della pietra (mm). */
  sopraCintura: number;
}>;

/**
 * Le misure di un pezzo, indipendenti dal processo: le soglie le applica `esitiProducibilita`.
 * @public
 */
export type MisurePezzo = Readonly<{
  nome: string;
  /** `chiuso`: solido valido in un corpo; `aperto`: guscio o solido non valido; `piu_corpi`: più solidi separati. */
  stato: 'chiuso' | 'aperto' | 'piu_corpi';
  /** Pietra: esclusa dai controlli del metallo, serve alle griffe. */
  pietra: boolean;
  /** Numero di facce del corpo (gli indici delle facce sono quelli di `faces()`, come nel GLB). */
  facce: number;
  /** Spessore minimo per faccia (mm): il raggio verso l'interno del materiale fino all'uscita; Infinity se nessuno. */
  spessori: readonly number[];
  /** Il minimo di `spessori` e il punto in cui è stato misurato. */
  spessoreMinimo: number;
  doveSpessore?: Vettore3;
  /** Facce di fianchi di rilievo (quasi verticali, più basse di 0,5 mm): non contano per `spessoreMinimo`. */
  scalini: readonly number[];
  /** Il minimo degli spessori dei fianchi di rilievo (il tratto più sottile) e dove; Infinity se non ce n'è. */
  trattoMinimo: number;
  doveTratto?: Vettore3;
  /** Sformo per faccia, indice per indice. */
  sformi: readonly SformoFaccia[];
  /** Facce intrappolate rispetto alla direzione: un raggio da esse lungo il verso di uscita rincontra il pezzo. */
  intrappolate: readonly number[];
  fori: readonly ForoMisurato[];
  griffe: readonly GriffaMisurata[];
  /** Campioni della parete e dei sottosquadri. */
  campioni: number;
  /** Millisecondi. */
  tempo: number;
}>;

/**
 * Le misure di tutto il modello per una direzione di sformo.
 * @public
 */
export type MisureModello = Readonly<{ direzione: Vettore3; pezzi: readonly MisurePezzo[] }>;

/**
 * Come il visore mostra un controllo: le facce sotto la soglia, la mappa dello sformo, il pezzo intero.
 * @public
 */
export type EvidenzaControllo = 'facce' | 'sformo' | 'pezzo';

/**
 * Un controllo di producibilità: un esito (stesso contratto e stessi codici delle famiglie) con le facce da
 * evidenziare e da dove viene.
 * @public
 */
export type ControlloProducibilita = Esito & {
  /** Chiave stabile: codice e pezzo. */
  id: string;
  /** Unità di `valore` e `soglia`. */
  unita?: 'mm' | 'deg' | 'n';
  /** Facce del pezzo da evidenziare, con il loro livello. */
  facce?: ReadonlyArray<Readonly<{ faccia: number; livello: 'avviso' | 'blocco' }>>;
  evidenza?: EvidenzaControllo;
  /** Quante facce sono interessate (sformo, sottosquadri). */
  conteggio?: number;
  /** Misurato sulla geometria, dichiarato dalla famiglia, o entrambi (fusi in una riga). */
  fonti: ReadonlyArray<'geometria' | 'famiglia'>;
};

/**
 * Un pezzo da analizzare: nome (come nello STEP e nel GLB), processo e materiale scelti.
 * @public
 */
export type PezzoRichiesto = Readonly<{
  nome: string;
  processo: Processo;
  /** Chiave di `materiali.ts` (soglie per lega), se nota. */
  materiale?: string;
  pietra?: boolean;
}>;

/**
 * La famiglia del progetto, per unire le sue verifiche.
 * @public
 */
export type FamigliaRichiesta = Readonly<{
  id: IdFamiglia;
  variante?: string;
  parametri?: unknown;
  /** Processo delle verifiche della famiglia (default: quello del primo pezzo). */
  processo?: Processo;
}>;

/**
 * La richiesta al worker: lo STEP che il kernel del progetto esporta (Z in alto, mm), i pezzi e la direzione.
 * @public
 */
export type RichiestaProducibilita = Readonly<{
  step: Uint8Array<ArrayBuffer>;
  pezzi: readonly PezzoRichiesto[];
  direzione: Vettore3;
  famiglia?: FamigliaRichiesta;
  /** Campioni per faccia per parete e sottosquadri (default 8). */
  campioniPerFaccia?: number;
}>;

/**
 * La risposta: misure, esiti della famiglia (per il processo usato), controlli uniti e tempi (ms).
 * @public
 */
export type RispostaProducibilita = Readonly<{
  misure: MisureModello;
  esitiFamiglia: readonly Esito[];
  processoFamiglia?: Processo;
  controlli: readonly ControlloProducibilita[];
  tempi: Readonly<{ lettura: number; misure: number; famiglia: number; esiti: number; totale: number }>;
}>;
