import type * as Smlib from '@classcad/smlibwasm';
import type {
  ForoMisurato,
  GriffaMisurata,
  MisureModello,
  MisurePezzo,
  SformoFaccia,
  Vettore3,
} from '#producibilita/tipi.js';

/**
 * Le misure della producibilità sulla geometria vera di un pezzo (E1), indipendenti dal processo: spessore per
 * faccia (raggi verso l'interno del materiale, come `pareteMinima` delle famiglie ma faccia per faccia), sformo per
 * faccia (`draftAnalysis`), facce intrappolate rispetto alla direzione di sformo (raggi lungo il verso di uscita),
 * fori (pareti cilindriche concave chiuse attorno all'asse) e griffe (perni sottili accanto a una pietra). Tutte
 * sopra la libreria passata: il worker passa la sua.
 */

type Lib = typeof Smlib;
type Punto = readonly [number, number, number];

/** Quanto si stacca il punto di partenza di un raggio dalla faccia (mm). */
const scostamento = 0.01;
/** Un colpo più vicino di così è la faccia di partenza sfiorata, non materiale (mm). */
const colpoMinimo = 1e-3;
/** Sotto questo |n·d| una faccia è parallela alla direzione: si prova l'uscita nei due versi. */
const quasiVerticale = 0.02;
/** Copertura attorno all'asse oltre la quale una parete cilindrica concava è un foro e non un raccordo (gradi). */
const coperturaForo = 200;
/** Oltre questo spessore nessuna soglia di parete guarda (la più alta è il legno, 6 mm): non serve la prova dello spigolo. */
const spessoreRilevante = 10;
/**
 * Altezza (mm, lungo la direzione di sformo) sotto la quale una faccia quasi verticale è un fianco di rilievo, non di
 * parete: il bordo in rilievo di una placca (0,3 mm), le lettere, il logo, un filo su un anello. Di questi fianchi si
 * misura la larghezza come per ogni altra faccia, ma la guarda `TRATTO_MIN` (tratto minimo del processo), non
 * `PARETE_MIN`: un filo largo 0,8 mm e alto 0,3 mm sopra una lastra di 1,5 mm non è una parete di 0,8 mm. I fianchi alti
 * almeno 0,5 mm restano pareti. Per il sottosquadro invece non si guardano: a quell'altezza il campione, a 0,01 mm dal
 * fianco, cade quasi sempre sotto il piano superiore del rilievo stesso (prova: sul logo triangolare il raggio verso
 * l'alto colpiva la faccia superiore del logo a 0,165 mm dalla partenza) e dà un sottosquadro falso; lo sformo mancante
 * lo dice `SFORMO`. Una faccia orizzontale non è mai uno scalino.
 */
const altezzaScalino = 0.5;
/** Raggio massimo di una griffa (mm): oltre è un gambo o una colonna. */
const raggioMassimoGriffa = 1;

const differenza = (a: Punto, b: Punto): Punto => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scalare = (a: Punto, b: Punto): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const per = (a: Punto, s: number): Punto => [a[0] * s, a[1] * s, a[2] * s];
const somma = (a: Punto, b: Punto): Punto => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lunghezza = (a: Punto): number => Math.hypot(a[0], a[1], a[2]);
const unitario = (a: Punto): Punto => {
  const l = lunghezza(a);
  return l > 0 ? per(a, 1 / l) : [0, 0, 1];
};
const vettoriale = (a: Punto, b: Punto): Punto => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

type MagliaFaccia = { vertices: ArrayLike<number>; triangles: ArrayLike<number> };

/** Le facce di un corpo con la loro maglia, presa una volta sola. */
type Faccia = { faccia: Smlib.Face; maglia: MagliaFaccia | undefined };

/**
 * Maglia rada di una faccia: serve solo a scegliere i campioni e a vedere quanto una parete gira attorno al suo asse,
 * non a disegnarla (la maglia predefinita costa dieci volte tanto).
 */
const tolleranzaMaglia = 0.05;
const angoloMaglia = 20;

const magliaDi = (faccia: Smlib.Face): MagliaFaccia | undefined => {
  try {
    return faccia.mesh(tolleranzaMaglia, angoloMaglia);
  } catch {
    return undefined;
  }
};

/**
 * I campioni di una faccia: il punto interno e fino a `quanti − 1` baricentri della sua maglia, presi a passo regolare
 * e riportati sulla faccia (deterministico, come `pareteMinima`).
 */
function campioniFaccia({ faccia, maglia }: Faccia, quanti: number): Array<{ punto: Punto; normale: Punto }> {
  const punti: Smlib.Vector[] = [faccia.interiorPoint()];
  if (quanti > 1 && maglia) {
    const triangoli = Math.floor(maglia.triangles.length / 3);
    const passo = Math.max(1, Math.floor(triangoli / (quanti - 1)));
    for (let indice = 0; indice < triangoli && punti.length < quanti; indice += passo) {
      const baricentro: [number, number, number] = [0, 0, 0];
      for (let angolo = 0; angolo < 3; angolo++) {
        const vertice = maglia.triangles[indice * 3 + angolo]! * 3;
        baricentro[0] += maglia.vertices[vertice]! / 3;
        baricentro[1] += maglia.vertices[vertice + 1]! / 3;
        baricentro[2] += maglia.vertices[vertice + 2]! / 3;
      }
      punti.push(faccia.closestPoint(baricentro));
    }
  }
  return punti.map((punto) => ({ punto: punto.toArray(), normale: faccia.normalAt(punto).toArray() }));
}

/** Lo sformo di ogni faccia, indice per indice (la lista di `draftAnalysis` segue `faces()`; se no si cerca). */
function sformiPerFaccia(forma: Smlib.Part, facce: readonly Smlib.Face[], direzione: Vettore3): SformoFaccia[] {
  const analisi = [...forma.draftAnalysis(direzione, { minAngle: 0 })];
  const allineata =
    analisi.length === facce.length && analisi.every((draft, indice) => draft.face.equals(facce[indice]));
  return facce.map((faccia, indice) => {
    const draft = allineata ? analisi[indice] : analisi.find((candidato) => candidato.face.equals(faccia));
    return draft ? { min: draft.minAngle, max: draft.maxAngle } : { min: 0, max: 0 };
  });
}

type Cilindro = {
  indice: number;
  raggio: number;
  origine: Punto;
  asse: Punto;
  /** Settori di 10° attorno all'asse coperti dalla faccia. */
  settori: Set<number>;
};

/** I settori di 10° attorno all'asse che la maglia di una faccia copre. */
function settoriAttorno(maglia: MagliaFaccia | undefined, origine: Punto, asse: Punto): Set<number> {
  const settori = new Set<number>();
  if (!maglia) {
    return settori;
  }
  const riferimento: Punto = Math.abs(asse[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unitario(vettoriale(asse, riferimento));
  const w = vettoriale(asse, u);
  for (let vertice = 0; vertice + 2 < maglia.vertices.length; vertice += 3) {
    const relativo = differenza(
      [maglia.vertices[vertice]!, maglia.vertices[vertice + 1]!, maglia.vertices[vertice + 2]!],
      origine,
    );
    const angolo = (Math.atan2(scalare(relativo, w), scalare(relativo, u)) * 180) / Math.PI;
    settori.add(Math.floor((angolo + 360) / 10) % 36);
  }
  return settori;
}

/** Le pareti cilindriche di un corpo: concave (fori, raccordi interni) e convesse (perni, raccordi esterni). */
function cilindri(facce: readonly Faccia[]): { concavi: Cilindro[]; convessi: Cilindro[] } {
  const concavi: Cilindro[] = [];
  const convessi: Cilindro[] = [];
  for (const [indice, { faccia, maglia }] of facce.entries()) {
    if (faccia.geomType !== 'cylinder') {
      continue;
    }
    let curvatura: Smlib.Curvature;
    let asse: Smlib.Axis;
    try {
      curvatura = faccia.curvatureAt();
      asse = faccia.axis;
    } catch {
      continue;
    }
    const minima = Math.min(curvatura.k1, curvatura.k2);
    const massima = Math.max(curvatura.k1, curvatura.k2);
    const origine = asse.origin.toArray();
    const direzione = unitario(asse.direction.toArray());
    const cilindro = {
      indice,
      raggio: faccia.radius,
      origine,
      asse: direzione,
      settori: settoriAttorno(maglia, origine, direzione),
    };
    if (minima < -1e-6) {
      concavi.push(cilindro);
    } else if (massima > 1e-6) {
      convessi.push(cilindro);
    }
  }
  return { concavi, convessi };
}

const distanzaDallAsse = (punto: Punto, origine: Punto, asse: Punto): number => {
  const relativo = differenza(punto, origine);
  return lunghezza(differenza(relativo, per(asse, scalare(relativo, asse))));
};

/** I fori: pareti cilindriche concave dello stesso asse e raggio che insieme girano per più di 200°. */
function foriDi(concavi: readonly Cilindro[]): ForoMisurato[] {
  const gruppi: Cilindro[][] = [];
  for (const cilindro of concavi) {
    const gruppo = gruppi.find(([primo]) => {
      return (
        primo !== undefined &&
        Math.abs(primo.raggio - cilindro.raggio) < 1e-3 &&
        Math.abs(Math.abs(scalare(primo.asse, cilindro.asse)) - 1) < 1e-6 &&
        distanzaDallAsse(cilindro.origine, primo.origine, primo.asse) < 1e-3
      );
    });
    if (gruppo) {
      gruppo.push(cilindro);
    } else {
      gruppi.push([cilindro]);
    }
  }
  return gruppi.flatMap((gruppo) => {
    const settori = new Set(gruppo.flatMap((cilindro) => [...cilindro.settori]));
    return settori.size * 10 >= coperturaForo
      ? [{ facce: gruppo.map((cilindro) => cilindro.indice), diametro: 2 * gruppo[0]!.raggio }]
      : [];
  });
}

/**
 * Una pietra del modello: centro, raggio in pianta e quota della cintura (dove è più larga).
 * @public
 */
export type PietraMisurata = Readonly<{ centro: Punto; raggio: number; cintura: number }>;

/**
 * Centro, raggio e cintura di una pietra: la cintura è la quota dei vertici più lontani dall'asse verticale.
 * @param pietra - Il corpo della pietra.
 * @returns La pietra misurata, o undefined se non si lascia misurare.
 * @public
 */
export function misuraPietra(pietra: Smlib.Part): PietraMisurata | undefined {
  try {
    const { min, max } = pietra.bbox();
    const centro: Punto = [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2];
    const maglia = pietra.mesh();
    let raggio = 0;
    let cintura = centro[2];
    for (let vertice = 0; vertice + 2 < maglia.vertices.length; vertice += 3) {
      const distanza = Math.hypot(maglia.vertices[vertice]! - centro[0], maglia.vertices[vertice + 1]! - centro[1]);
      if (distanza > raggio + 1e-6) {
        raggio = distanza;
        cintura = maglia.vertices[vertice + 2]!;
      }
    }
    return raggio > 0 ? { centro, raggio, cintura } : undefined;
  } catch {
    return undefined;
  }
}

/** Le griffe: perni convessi sottili, quasi verticali, attorno a una pietra, con la loro punta. */
function griffeDi(
  facce: readonly Faccia[],
  convessi: readonly Cilindro[],
  pietre: readonly PietraMisurata[],
): GriffaMisurata[] {
  const griffe: GriffaMisurata[] = [];
  const tutte = facce.map(({ faccia }) => faccia);
  for (const cilindro of convessi) {
    if (cilindro.raggio > raggioMassimoGriffa || Math.abs(cilindro.asse[2]) < 0.7) {
      continue;
    }
    const faccia = tutte[cilindro.indice]!;
    const scatola = faccia.bbox();
    let punta = scatola.max.z;
    const cappello: number[] = [];
    for (const vicina of faccia.neighbors()) {
      const box = vicina.bbox();
      if (box.min.z >= scatola.max.z - 1e-3) {
        punta = Math.max(punta, box.max.z);
        const indice = tutte.findIndex((altra) => altra.equals(vicina));
        if (indice !== -1) {
          cappello.push(indice);
        }
      }
    }
    const asseSulPiano: Punto = [
      (scatola.min.x + scatola.max.x) / 2,
      (scatola.min.y + scatola.max.y) / 2,
      (scatola.min.z + scatola.max.z) / 2,
    ];
    const pietra = pietre.find(
      (candidata) =>
        Math.hypot(asseSulPiano[0] - candidata.centro[0], asseSulPiano[1] - candidata.centro[1]) <=
          candidata.raggio + cilindro.raggio + 1 && punta >= candidata.cintura - 1,
    );
    if (pietra) {
      griffe.push({
        facce: [cilindro.indice, ...cappello],
        diametro: 2 * cilindro.raggio,
        sopraCintura: punta - pietra.cintura,
      });
    }
  }
  return griffe;
}

/**
 * Un colpo che misura materiale vero, non lo spigolo da cui parte il campione. Un campione che cade sul bordo della sua
 * faccia (il punto interno di una faccia riletta dallo STEP può stare sul bordo) colpisce subito la faccia vicina,
 * quasi senza staccarsene: la faccia colpita dista dal campione molto meno del raggio. Su una parete sottile vera (o
 * un cuneo fino a 60°) la faccia colpita dista dal campione almeno metà del raggio; un raggio che esce dalla faccia da
 * cui parte (un filo tondo, un tubo) conta sempre.
 */
function colpoVero(colpo: Smlib.Hit<Smlib.Face>, { punto, da }: Readonly<{ punto: Punto; da: Smlib.Face }>): boolean {
  if (colpo.distance <= colpoMinimo) {
    return false;
  }
  try {
    // Attraverso un filo tondo o un tubo il raggio esce dalla stessa faccia: la distanza dalla faccia non dice nulla.
    return colpo.face.equals(da) || colpo.face.distanceTo(punto) >= 0.5 * colpo.distance;
  } catch {
    return true;
  }
}

/** Una faccia quasi verticale (rispetto a `d`) più bassa di `altezzaScalino`. */
function èScalino(faccia: Smlib.Face, d: Punto): boolean {
  try {
    const { min, max } = faccia.bbox();
    const angoli = [min.x, max.x].flatMap((x) =>
      [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => scalare([x, y, z], d))),
    );
    const altezza = Math.max(...angoli) - Math.min(...angoli);
    if (altezza > altezzaScalino) {
      return false;
    }
    const punto = faccia.interiorPoint();
    return Math.abs(scalare(faccia.normalAt(punto).toArray(), d)) < 0.3;
  } catch {
    return false;
  }
}

/** Spessori per faccia e facce intrappolate con un solo `raycastMany` (l'albero dei raggi si costruisce una volta). */
function raggi(
  forma: Smlib.Part,
  facce: readonly Faccia[],
  { direzione, campioniPerFaccia }: Readonly<{ direzione: Vettore3; campioniPerFaccia: number }>,
): {
  spessori: number[];
  minimo: number;
  dove?: Punto;
  tratto: number;
  doveTratto?: Punto;
  scalini: number[];
  intrappolate: number[];
  campioni: number;
} {
  const d = unitario(direzione);
  const scalini = new Set<number>();
  const origini: Punto[] = [];
  const direzioni: Punto[] = [];
  /** Per raggio: faccia, tipo (spessore, uscita), e per i quasi verticali il gemello dell'altro verso. */
  const legami: Array<{ faccia: number; tipo: 'spessore' | 'uscita' | 'uscita_doppia'; punto: Punto; da: Smlib.Face }> =
    [];
  for (const [indice, faccia] of facce.entries()) {
    const scalino = èScalino(faccia.faccia, d);
    if (scalino) {
      scalini.add(indice);
    }
    for (const { punto, normale } of campioniFaccia(faccia, campioniPerFaccia)) {
      origini.push(differenza(punto, per(normale, scostamento)));
      direzioni.push(per(normale, -1));
      const da = faccia.faccia;
      legami.push({ faccia: indice, tipo: 'spessore', punto, da });
      if (scalino) {
        continue;
      }
      const fuori = somma(punto, per(normale, scostamento));
      const verso = scalare(normale, d);
      if (Math.abs(verso) < quasiVerticale) {
        origini.push(fuori, fuori);
        direzioni.push(d, per(d, -1));
        legami.push(
          { faccia: indice, tipo: 'uscita_doppia', punto, da },
          { faccia: indice, tipo: 'uscita_doppia', punto, da },
        );
      } else {
        origini.push(fuori);
        direzioni.push(per(d, Math.sign(verso)));
        legami.push({ faccia: indice, tipo: 'uscita', punto, da });
      }
    }
  }
  const spessori = facce.map(() => Number.POSITIVE_INFINITY);
  const intrappolate = new Set<number>();
  let minimo = Number.POSITIVE_INFINITY;
  let dove: Punto | undefined;
  let tratto = Number.POSITIVE_INFINITY;
  let doveTratto: Punto | undefined;
  const campioniTratto = new Map<number, Array<{ spessore: number; punto: Punto }>>();
  if (origini.length === 0) {
    return { spessori, minimo, tratto, scalini: [], intrappolate: [], campioni: 0 };
  }
  const colpi = forma.raycastMany(origini, direzioni);
  for (let indice = 0; indice < legami.length; indice++) {
    const legame = legami[indice]!;
    const colpo = colpi[indice];
    if (legame.tipo === 'spessore') {
      // La prova dello spigolo costa una distanza: solo per i colpi che abbassano il minimo della faccia e che una
      // soglia di parete può guardare (uno spigolo dà solo colpi corti: quelli lunghi sono veri).
      const spessore = colpo ? colpo.distance + scostamento : Number.POSITIVE_INFINITY;
      if (
        colpo &&
        colpo.distance > colpoMinimo &&
        spessore < spessori[legame.faccia]! &&
        (spessore >= spessoreRilevante || colpoVero(colpo, legame))
      ) {
        if (scalini.has(legame.faccia)) {
          // Di un fianco di rilievo vale la mediana dei campioni: alle punte acute dei contorni (lettere, logo) lo
          // spessore tende a zero senza che il tratto sia sottile; il valore del fianco è quello tipico.
          const campioniFaccia = campioniTratto.get(legame.faccia) ?? [];
          campioniFaccia.push({ spessore, punto: origini[indice]! });
          campioniTratto.set(legame.faccia, campioniFaccia);
          continue;
        }
        spessori[legame.faccia] = spessore;
        if (spessore < minimo) {
          minimo = spessore;
          dove = origini[indice];
        }
      }
      continue;
    }
    const tocca = colpo !== null && colpo !== undefined && colpoVero(colpo, legame);
    if (legame.tipo === 'uscita') {
      if (tocca) {
        intrappolate.add(legame.faccia);
      }
    } else {
      // I due versi di un punto quasi verticale sono raggi consecutivi: intrappolato se nessuno dei due esce.
      const gemello = colpi[indice + 1];
      const toccaGemello = gemello !== null && gemello !== undefined && colpoVero(gemello, legame);
      if (tocca && toccaGemello) {
        intrappolate.add(legame.faccia);
      }
      indice++;
    }
  }
  for (const [faccia, campioni] of campioniTratto) {
    const ordinati = campioni.toSorted((a, b) => a.spessore - b.spessore);
    const tipico = ordinati[Math.floor((ordinati.length - 1) / 2)]!;
    spessori[faccia] = tipico.spessore;
    if (tipico.spessore < tratto) {
      tratto = tipico.spessore;
      doveTratto = tipico.punto;
    }
  }
  return {
    spessori,
    minimo,
    ...(dove ? { dove } : {}),
    tratto,
    ...(doveTratto ? { doveTratto } : {}),
    scalini: [...scalini].toSorted((a, b) => a - b),
    intrappolate: [...intrappolate].toSorted((a, b) => a - b),
    campioni: legami.filter(({ tipo }) => tipo === 'spessore').length,
  };
}

/**
 * Opzioni della misura di un pezzo.
 * @public
 */
export type OpzioniMisura = Readonly<{
  nome: string;
  direzione: Vettore3;
  pietra?: boolean;
  /** Le pietre del modello, per le griffe. */
  pietre?: readonly PietraMisurata[];
  campioniPerFaccia?: number;
}>;

/**
 * Misura un pezzo: stato del solido, spessori, sformi, facce intrappolate, fori e griffe.
 * @param lib - Libreria SMLib.
 * @param forma - Il corpo del pezzo (un guscio o una maglia contano come pezzo aperto).
 * @param opzioni - Nome, direzione di sformo, se è una pietra, le pietre del modello, campioni per faccia.
 * @returns Le misure.
 * @public
 */
export function misuraPezzo(lib: Lib, forma: unknown, opzioni: OpzioniMisura): MisurePezzo {
  const inizio = performance.now();
  const vuote = {
    nome: opzioni.nome,
    pietra: opzioni.pietra === true,
    spessori: [],
    spessoreMinimo: Number.POSITIVE_INFINITY,
    trattoMinimo: Number.POSITIVE_INFINITY,
    scalini: [],
    sformi: [],
    intrappolate: [],
    fori: [],
    griffe: [],
    campioni: 0,
  };
  const contaFacce = (): number => {
    try {
      return forma instanceof lib.Shape ? [...(forma as Smlib.Shell).faces()].length : 0;
    } catch {
      return 0;
    }
  };
  if (!(forma instanceof lib.Part) || !forma.isValid()) {
    return { ...vuote, stato: 'aperto', facce: contaFacce(), tempo: performance.now() - inizio };
  }
  if (forma.solids().length !== 1) {
    return { ...vuote, stato: 'piu_corpi', facce: contaFacce(), tempo: performance.now() - inizio };
  }
  const facce: Faccia[] = [...forma.faces()].map((faccia) => ({ faccia, maglia: magliaDi(faccia) }));
  if (opzioni.pietra) {
    return { ...vuote, stato: 'chiuso', facce: facce.length, tempo: performance.now() - inizio };
  }
  const campioniPerFaccia = Math.max(1, opzioni.campioniPerFaccia ?? 8);
  const misurati = raggi(forma, facce, { direzione: opzioni.direzione, campioniPerFaccia });
  const { concavi, convessi } = cilindri(facce);
  return {
    nome: opzioni.nome,
    stato: 'chiuso',
    pietra: false,
    facce: facce.length,
    spessori: misurati.spessori,
    spessoreMinimo: misurati.minimo,
    ...(misurati.dove ? { doveSpessore: misurati.dove } : {}),
    trattoMinimo: misurati.tratto,
    ...(misurati.doveTratto ? { doveTratto: misurati.doveTratto } : {}),
    scalini: misurati.scalini,
    sformi: sformiPerFaccia(
      forma,
      facce.map(({ faccia }) => faccia),
      opzioni.direzione,
    ),
    intrappolate: misurati.intrappolate,
    fori: foriDi(concavi),
    griffe: opzioni.pietre?.length ? griffeDi(facce, convessi, opzioni.pietre) : [],
    campioni: misurati.campioni,
    tempo: performance.now() - inizio,
  };
}

/**
 * Misura tutti i pezzi di un modello per una direzione di sformo; le pietre servono alle griffe dei metalli.
 * @param lib - Libreria SMLib.
 * @param pezzi - Nome, corpo e se è una pietra.
 * @param opzioni - Direzione di sformo e campioni per faccia.
 * @returns Le misure del modello.
 * @public
 */
export function misuraModello(
  lib: Lib,
  pezzi: ReadonlyArray<Readonly<{ nome: string; forma: unknown; pietra?: boolean }>>,
  opzioni: Readonly<{ direzione: Vettore3; campioniPerFaccia?: number }>,
): MisureModello {
  const pietre = pezzi.flatMap(({ forma, pietra }) => {
    const misurata = pietra && forma instanceof lib.Part ? misuraPietra(forma) : undefined;
    return misurata ? [misurata] : [];
  });
  return {
    direzione: opzioni.direzione,
    pezzi: pezzi.map(({ nome, forma, pietra }) =>
      misuraPezzo(lib, forma, {
        nome,
        direzione: opzioni.direzione,
        ...(pietra ? { pietra } : {}),
        pietre,
        ...(opzioni.campioniPerFaccia === undefined ? {} : { campioniPerFaccia: opzioni.campioniPerFaccia }),
      }),
    ),
  };
}
