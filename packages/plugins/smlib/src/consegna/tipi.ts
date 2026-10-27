/**
 * Tipi della consegna (E3a): lo STEP, il DXF e i disegni della tavola che SinopiaCAD consegna al laboratorio e al
 * fornitore, scritti e riletti con SMLib (Apache 2.0) nel worker della consegna. Tutto dato semplice: attraversa il
 * confine del worker.
 */

/**
 * Un vettore in millimetri (X, Y, Z del modello, Z in alto).
 * @public
 */
export type Ingombro = readonly [number, number, number];

/**
 * Il materiale di un pezzo come lo porta la consegna: chiave della tabella dei materiali, nome leggibile e colore.
 * @public
 */
export type MaterialeConsegna = Readonly<{ chiave: string; nome: string; colore: string }>;

/**
 * Un pezzo del modello: nome (come nello STEP e nel GLB), volume esatto misurato dal kernel, materiale scelto.
 * @public
 */
export type PezzoConsegna = Readonly<{
  nome: string;
  /** Volume esatto del solido (mm³) come lo misura il kernel del progetto: lo STEP riletto deve tornare uguale. */
  volumeMm3?: number;
  materiale?: MaterialeConsegna;
  /** Pezzo piano per dichiarazione del processo (tranciatura, taglio): il DXF ne dà il contorno. */
  piano?: boolean;
}>;

/**
 * Perché un file non si consegna.
 * @public
 */
export type ProblemaConsegna = 'read' | 'names' | 'solids' | 'invalid' | 'volume' | 'selection' | 'write';

/**
 * Un pezzo riletto dal file consegnato.
 * @public
 */
export type PezzoRiletto = Readonly<{
  nome: string;
  /** Nome del prodotto nel file: il pezzo e il suo materiale. */
  prodotto: string;
  solidi: number;
  volumeMm3: number;
  valido: boolean;
  ingombro: Ingombro;
}>;

/**
 * Un file non consegnabile, con i pezzi che lo rendono tale.
 * @public
 */
export type DaCorreggere = Readonly<{ stato: 'da_correggere'; problema: ProblemaConsegna; pezzi?: readonly string[] }>;

/**
 * La richiesta dello STEP da consegnare: lo STEP che il kernel del progetto esporta (Z in alto, mm), i pezzi del
 * modello, quelli scelti (assente = tutti) e il nome del progetto (nome dell'assieme).
 * @public
 */
export type RichiestaStep = Readonly<{
  step: Uint8Array<ArrayBuffer>;
  pezzi: readonly PezzoConsegna[];
  selezionati?: readonly string[];
  progetto: string;
}>;

/**
 * Lo STEP consegnabile: riscritto da SMLib (un prodotto per pezzo, col materiale nel nome e nel colore) e riletto.
 * @public
 */
export type EsitoStep =
  | Readonly<{
      stato: 'verificato';
      step: Uint8Array<ArrayBuffer>;
      pezzi: readonly PezzoRiletto[];
      /** Ingombro di tutti i pezzi consegnati insieme (mm). */
      ingombro: Ingombro;
    }>
  | DaCorreggere;

/**
 * La rilettura di un file convertito da un altro motore (IGES): stessi pezzi, stessi volumi, un solido ciascuno.
 * @public
 */
export type RichiestaRilettura = Readonly<{
  formato: 'iges';
  file: Uint8Array<ArrayBuffer>;
  attesi: ReadonlyArray<Readonly<{ nome: string; volumeMm3: number }>>;
}>;

/**
 * L'esito di una rilettura.
 * @public
 */
export type EsitoRilettura = Readonly<{ stato: 'verificato'; pezzi: readonly PezzoRiletto[] }> | DaCorreggere;

/**
 * Come si disegna il DXF: il contorno in vera grandezza dei pezzi piani, oppure le tre viste (fronte, alto, lato).
 * @public
 */
export type ModoDxf = 'contorno' | 'viste';

/**
 * La richiesta del DXF: lo STEP consegnabile (o quello del kernel) e i pezzi.
 * @public
 */
export type RichiestaDxf = Readonly<{
  step: Uint8Array<ArrayBuffer>;
  pezzi: readonly PezzoConsegna[];
  selezionati?: readonly string[];
  /** Assente = scelto dalla forma: contorno se ogni pezzo scelto è piano, altrimenti viste. */
  modo?: ModoDxf;
}>;

/**
 * Il DXF consegnabile e la sua rilettura.
 * @public
 */
export type EsitoDxf =
  | Readonly<{
      stato: 'verificato';
      dxf: string;
      modo: ModoDxf;
      /** Catene chiuse rilette dal file. */
      contorni: number;
      /** Entità di disegno nel file (LINE, ARC, CIRCLE, SPLINE, ELLIPSE). */
      entita: number;
    }>
  | DaCorreggere;

/**
 * Una vista della tavola: linee in vista e nascoste come percorsi SVG (mm, y verso il basso) e il loro riquadro.
 * @public
 */
export type VistaTavola = Readonly<{
  nome: 'front' | 'left' | 'top' | 'iso';
  visibili: string;
  nascoste: string;
  /** Riquadro delle linee, in coordinate SVG (mm). */
  riquadro: Readonly<{ x: number; y: number; larghezza: number; altezza: number }>;
}>;

/**
 * La richiesta dei disegni della tavola.
 * @public
 */
export type RichiestaTavola = Readonly<{ step: Uint8Array<ArrayBuffer>; selezionati?: readonly string[] }>;

/**
 * I disegni della tavola: le viste ortogonali (primo diedro, ISO) e l'isometrica, l'ingombro di tutto e di ogni pezzo.
 * @public
 */
export type EsitoTavola =
  | Readonly<{
      stato: 'pronto';
      viste: readonly VistaTavola[];
      ingombro: Ingombro;
      pezzi: ReadonlyArray<Readonly<{ nome: string; ingombro: Ingombro; volumeMm3: number }>>;
    }>
  | DaCorreggere;
