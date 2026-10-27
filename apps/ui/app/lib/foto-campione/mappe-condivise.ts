/**
 * Mappe della foto del campione (SinopiaCAD D6) — CODICE GEMELLO CAD ↔ funzione `sinopiacad` di Sinopia.
 *
 * Lo stesso file, byte per byte, vive in `apps/ui/app/lib/foto-campione/mappe-condivise.ts` (CAD) e in
 * `supabase/functions/sinopiacad/foto/mappe-condivise.ts` (Sinopia): le impronte SHA-256 nei test dei due repo lo
 * tengono uguale. Niente import, niente DOM, niente GPU: gira nel browser, in un worker, in Node e in Deno.
 *
 * Dal GLB del modello (glTF, metri, Y in alto) alle mappe di una vista: ombreggiato neutro, profondità (vicino =
 * chiaro, la convenzione di ControlNet), normali nello spazio della camera, bordi e sagoma. Camera ortografica e luce
 * fisse per vista, nel telaio di Tau (millimetri, Z in alto) e con la convenzione della verifica D3: azimuth 0 guarda
 * il fronte (camera su −Y), 90 dal lato destro, elevation dall'alto. Uno z-buffer in TypeScript: lo stesso modello dà
 * gli stessi byte ovunque. Sinopia rende le mappe dalla versione inviata del modello (così la provenienza degli
 * ingressi della foto è del server); il CAD le rende per confrontare la sagoma della foto e per capire se il modello a
 * schermo è ancora quello inviato.
 */

/** Pixel riga per riga dall'alto a sinistra, `canali` byte ciascuno (1 grigio, 3 RGB, 4 RGBA). */
export type RasterFoto = {
  larghezza: number;
  altezza: number;
  canali: 1 | 2 | 3 | 4;
  dati: Uint8Array | Uint8ClampedArray;
};

/** Maschera binaria: `dati[y * larghezza + x]` vale 1 dove c'è il modello. */
export type SagomaFoto = { larghezza: number; altezza: number; dati: Uint8Array };

/** Il modello come lo usano le mappe: triangoli con le normali ai vertici e spigoli B-rep, in mm, Z in alto. */
export type MeshFoto = Readonly<{
  /** Nove numeri per triangolo: tre vertici. */
  triangoli: Float32Array;
  /** Nove numeri per triangolo: la normale unitaria a ogni vertice (quella della faccia se il GLB non ne ha). */
  normali: Float32Array;
  /** Sei numeri per segmento: i due estremi di uno spigolo. */
  segmenti: Float32Array;
}>;

export const vistePhoto = ['fronte', 'tre-quarti', 'dettaglio'] as const;
/** Una vista della foto del campione. */
export type VistaFoto = (typeof vistePhoto)[number];

/** Il lato delle mappe: l'uscita quadrata 1K del modello d'immagine, così foto e render si confrontano pixel per pixel. */
export const latoMappe = 1024;

type DefinizioneVista = Readonly<{ azimuth: number; elevation: number; margine: number; zoom: number }>;

/**
 * La camera fissa di ogni vista. «Dettaglio» è la camera di tre quarti avvicinata 1,9 volte sul centro del modello; il
 * «fronte» di un pezzo piatto guarda dall'alto (vedi `rapportoPiatto`).
 */
export const definizioniViste: Readonly<Record<VistaFoto, DefinizioneVista>> = {
  fronte: { azimuth: 0, elevation: 6, margine: 0.12, zoom: 1 },
  'tre-quarti': { azimuth: 35, elevation: 22, margine: 0.12, zoom: 1 },
  dettaglio: { azimuth: 35, elevation: 22, margine: 0.12, zoom: 1.9 },
};

/**
 * Un pezzo è piatto quando la sua altezza (Z) è al massimo metà del lato maggiore in pianta: fibbia, placca, fondo. Il
 * suo «fronte» è la faccia che mostra disteso, quindi «fronte» lo guarda dall'alto, non di taglio.
 */
export const rapportoPiatto = 0.5;

/** Le mappe e la sagoma di una vista. */
export type MappeFoto = Readonly<{
  vista: VistaFoto;
  /** La camera usata davvero: il «fronte» di un pezzo piatto guarda dall'alto (elevation 90°). */
  camera: Readonly<{ azimuth: number; elevation: number }>;
  lato: number;
  /** Pixel per millimetro della camera. */
  pxPerMm: number;
  /** Grigio neutro su bianco (1 canale). */
  ombreggiata: RasterFoto;
  /** Profondità: vicino 255, lontano 40, fondo 0 (1 canale). */
  profondita: RasterFoto;
  /** Normali nello spazio della camera in RGB, fondo (128, 128, 255) (3 canali). */
  normali: RasterFoto;
  /** Spigoli visibili e contorno, nero su bianco (1 canale). */
  bordi: RasterFoto;
  sagoma: SagomaFoto;
}>;

// ---------------------------------------------------------------------------------------------------------------------
// GLB → mesh
// ---------------------------------------------------------------------------------------------------------------------

type Matrice = Float64Array;
type GltfNodo = {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};
type GltfAccessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type?: string;
  normalized?: boolean;
  sparse?: unknown;
};
type GltfVista = { byteOffset?: number; byteLength: number; byteStride?: number };
type GltfPrimitiva = { attributes: Record<string, number | undefined>; indices?: number; mode?: number };
/** Il JSON di un GLB, ristretto a ciò che le mappe leggono. */
export type GltfJson = {
  extensionsUsed?: string[];
  extensions?: Record<string, unknown>;
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNodo[];
  meshes?: Array<{ primitives: GltfPrimitiva[] }>;
  accessors?: GltfAccessor[];
  bufferViews?: GltfVista[];
};

const MAGIA_GLB = 0x46_54_6c_67;
const BLOCCO_JSON = 0x4e_4f_53_4a;
const BLOCCO_BIN = 0x00_4e_49_42;
const FLOAT = 5126;
const BYTE_COMPONENTE: Readonly<Record<number, number>> = { 5121: 1, 5123: 2, 5125: 4 };
const MODO_LINEE = 1;
const MODO_TRIANGOLI = 4;
/**
 * Tetti contro un GLB ostile (il file lo carica l'utente): oltre, il GLB non è un modello da foto e si rifiuta prima di
 * bloccare chi lo rende. I nodi formano un albero (glTF 2.0): un nodo raggiunto due volte — ciclo o due genitori — è
 * rifiutato, così le istanze ripetute non moltiplicano il lavoro.
 */
export const TETTI_GLB = {
  nodi: 10_000,
  primitive: 20_000,
  /** Vertici letti in tutto (accessor POSITION), ripetizioni comprese. */
  vertici: 2_000_000,
  triangoli: 400_000,
  segmenti: 200_000,
} as const;
/** Passi di disegno degli spigoli per pixel della mappa: oltre, gli spigoli restanti non si disegnano. */
const PASSI_SPIGOLI_PER_PIXEL = 16;

/** Matrice 4×4 per colonne, come glTF. */
function moltiplica(a: Matrice, b: Matrice): Matrice {
  const uscita = new Float64Array(16);
  for (let colonna = 0; colonna < 4; colonna++) {
    for (let riga = 0; riga < 4; riga++) {
      let somma = 0;
      for (let k = 0; k < 4; k++) {
        somma += a[k * 4 + riga]! * b[colonna * 4 + k]!;
      }
      uscita[colonna * 4 + riga] = somma;
    }
  }
  return uscita;
}

function matriceNodo(nodo: GltfNodo): Matrice {
  if (nodo.matrix?.length === 16) {
    return Float64Array.from(nodo.matrix);
  }
  const [tx = 0, ty = 0, tz = 0] = nodo.translation ?? [];
  const [x = 0, y = 0, z = 0, w = 1] = nodo.rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = nodo.scale ?? [];
  const [xx, yy, zz, xy, xz, yz, wx, wy, wz] = [x * x, y * y, z * z, x * y, x * z, y * z, w * x, w * y, w * z];
  return Float64Array.of(
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  );
}

/** glTF è Y in alto in metri; il telaio di Tau è Z in alto in millimetri: (x, y, z) → (x, −z, y) × 1000. */
const versoTau: Matrice = Float64Array.of(1000, 0, 0, 0, 0, 0, 1000, 0, 0, -1000, 0, 0, 0, 0, 0, 1);

/** La matrice delle normali: inversa trasposta della parte 3×3 (righe per colonne, 9 numeri). */
function matriceNormali(m: Matrice): Float64Array {
  const [a, b, c, d, e, f, g, h, i] = [m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const k = Math.abs(det) < 1e-30 ? 0 : 1 / det;
  // M = [a d g; b e h; c f i] (righe). L'inversa trasposta è la matrice dei cofattori diviso il determinante.
  return Float64Array.of(
    (e * i - f * h) * k,
    (c * h - b * i) * k,
    (b * f - c * e) * k,
    (f * g - d * i) * k,
    (a * i - c * g) * k,
    (c * d - a * f) * k,
    (d * h - e * g) * k,
    (b * g - a * h) * k,
    (a * e - b * d) * k,
  );
}

/**
 * Il JSON e il blocco BIN di un GLB.
 *
 * @param contenuto - I byte del GLB.
 * @returns JSON e vista sul BIN.
 */
export function leggiGlb(contenuto: Uint8Array): { json: GltfJson; bin: Uint8Array } {
  const vista = new DataView(contenuto.buffer, contenuto.byteOffset, contenuto.byteLength);
  if (contenuto.byteLength < 20 || vista.getUint32(0, true) !== MAGIA_GLB) {
    throw new Error('Mappe: non è un GLB.');
  }
  let json: GltfJson | undefined;
  let bin: Uint8Array = new Uint8Array(0);
  for (let posizione = 12; posizione + 8 <= contenuto.byteLength; ) {
    const lunghezza = vista.getUint32(posizione, true);
    const tipo = vista.getUint32(posizione + 4, true);
    const inizio = posizione + 8;
    if (inizio + lunghezza > contenuto.byteLength) {
      throw new Error('Mappe: GLB troncato.');
    }
    if (tipo === BLOCCO_JSON) {
      json = JSON.parse(new TextDecoder().decode(contenuto.subarray(inizio, inizio + lunghezza))) as GltfJson;
    } else if (tipo === BLOCCO_BIN) {
      bin = contenuto.subarray(inizio, inizio + lunghezza);
    }
    posizione = inizio + lunghezza + ((4 - (lunghezza % 4)) % 4);
  }
  if (!json) {
    throw new Error('Mappe: GLB senza JSON.');
  }
  return { json, bin };
}

/** Un accessor convalidato contro il SUO bufferView: dove comincia nel BIN, il passo, quanti elementi. */
type AccessorLetto = Readonly<{ inizio: number; passo: number; count: number; dimensione: number }>;

const interoNonNegativo = (valore: unknown): valore is number =>
  typeof valore === 'number' && Number.isSafeInteger(valore) && valore >= 0;

/**
 * Convalida un accessor prima di allocare qualsiasi cosa: `count` intero sicuro, `byteStride` come vuole glTF (multiplo
 * di 4, non minore dell'elemento, al massimo 252), l'ultimo elemento dentro il range del suo bufferView e il bufferView
 * dentro il BIN.
 */
function convalidaAccessor(json: GltfJson, bin: Uint8Array, indice: number, tipo: 'VEC3' | 'SCALAR'): AccessorLetto {
  const accessor = json.accessors?.[indice];
  if (!accessor || !interoNonNegativo(accessor.count) || (accessor.type !== undefined && accessor.type !== tipo)) {
    throw new Error('Mappe: accessor non valido.');
  }
  const float = tipo === 'VEC3';
  const byteComponente = float
    ? accessor.componentType === FLOAT
      ? 4
      : undefined
    : BYTE_COMPONENTE[accessor.componentType];
  if (byteComponente === undefined || accessor.sparse || (float && accessor.normalized)) {
    throw new Error(
      float ? 'Mappe: si leggono solo accessor float semplici.' : 'Mappe: accessor degli indici illeggibile.',
    );
  }
  const dimensione = float ? 3 * byteComponente : byteComponente;
  const vista = interoNonNegativo(accessor.bufferView) ? json.bufferViews?.[accessor.bufferView] : undefined;
  const inizioVista = vista?.byteOffset ?? 0;
  const offset = accessor.byteOffset ?? 0;
  if (
    !vista ||
    !interoNonNegativo(inizioVista) ||
    !interoNonNegativo(vista.byteLength) ||
    inizioVista + vista.byteLength > bin.byteLength ||
    !interoNonNegativo(offset)
  ) {
    throw new Error('Mappe: bufferView fuori dal buffer.');
  }
  const passo = vista.byteStride ?? dimensione;
  if (
    vista.byteStride !== undefined &&
    (!interoNonNegativo(vista.byteStride) ||
      vista.byteStride % 4 !== 0 ||
      vista.byteStride < dimensione ||
      vista.byteStride > 252)
  ) {
    throw new Error('Mappe: byteStride non valido.');
  }
  if (accessor.count > 0 && offset + (accessor.count - 1) * passo + dimensione > vista.byteLength) {
    throw new Error('Mappe: accessor fuori dal suo bufferView.');
  }
  return { inizio: inizioVista + offset, passo, count: accessor.count, dimensione: byteComponente };
}

function leggiFloat(bin: Uint8Array, letto: AccessorLetto): Float32Array {
  const dati = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const uscita = new Float32Array(letto.count * 3);
  for (let elemento = 0; elemento < letto.count; elemento++) {
    for (let componente = 0; componente < 3; componente++) {
      uscita[elemento * 3 + componente] = dati.getFloat32(letto.inizio + elemento * letto.passo + componente * 4, true);
    }
  }
  return uscita;
}

function leggiIndici(bin: Uint8Array, letto: AccessorLetto | undefined, conteggio: number): Uint32Array {
  if (letto === undefined) {
    return Uint32Array.from({ length: conteggio }, (_, elemento) => elemento);
  }
  const dati = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const uscita = new Uint32Array(letto.count);
  for (let elemento = 0; elemento < letto.count; elemento++) {
    const posizione = letto.inizio + elemento * letto.passo;
    const valore =
      letto.dimensione === 1
        ? dati.getUint8(posizione)
        : letto.dimensione === 2
          ? dati.getUint16(posizione, true)
          : dati.getUint32(posizione, true);
    if (valore >= conteggio) {
      throw new Error('Mappe: indice oltre i vertici.');
    }
    uscita[elemento] = valore;
  }
  return uscita;
}

/**
 * Legge un GLB in triangoli e spigoli nel telaio di Tau.
 *
 * @param contenuto - I byte del GLB.
 * @returns Triangoli con le normali, e segmenti degli spigoli.
 */
export function meshDaGlb(contenuto: Uint8Array): MeshFoto {
  const { json, bin } = leggiGlb(contenuto);
  const triangoli: number[] = [];
  const normali: number[] = [];
  const segmenti: number[] = [];
  const nodi = json.nodes ?? [];
  const mesh = json.meshes ?? [];
  if (nodi.length > TETTI_GLB.nodi) {
    throw new Error('Mappe: troppi nodi per una foto.');
  }
  const visitati = new Set<number>();
  let [primitive, vertici] = [0, 0];

  const visita = (indice: number, padre: Matrice, profondita: number): void => {
    const nodo = nodi[indice];
    if (!nodo || profondita > 64) {
      return;
    }
    if (visitati.has(indice)) {
      throw new Error('Mappe: nodi ciclici o con due genitori.');
    }
    visitati.add(indice);
    if (visitati.size > TETTI_GLB.nodi) {
      throw new Error('Mappe: troppi nodi per una foto.');
    }
    const mondo = moltiplica(padre, matriceNodo(nodo));
    const n = matriceNormali(mondo);
    const punto = (sorgente: Float32Array, vertice: number): [number, number, number] => {
      const [x, y, z] = [sorgente[vertice * 3]!, sorgente[vertice * 3 + 1]!, sorgente[vertice * 3 + 2]!];
      return [
        mondo[0]! * x + mondo[4]! * y + mondo[8]! * z + mondo[12]!,
        mondo[1]! * x + mondo[5]! * y + mondo[9]! * z + mondo[13]!,
        mondo[2]! * x + mondo[6]! * y + mondo[10]! * z + mondo[14]!,
      ];
    };
    for (const primitiva of nodo.mesh === undefined ? [] : (mesh[nodo.mesh]?.primitives ?? [])) {
      if (++primitive > TETTI_GLB.primitive) {
        throw new Error('Mappe: troppe primitive per una foto.');
      }
      const modo = primitiva.mode ?? MODO_TRIANGOLI;
      const indicePosizioni = primitiva.attributes['POSITION'];
      if (indicePosizioni === undefined || (modo !== MODO_TRIANGOLI && modo !== MODO_LINEE)) {
        continue;
      }
      // Prima di allocare: accessor convalidati e conteggi DICHIARATI sommati ai tetti.
      const accessorPosizioni = convalidaAccessor(json, bin, indicePosizioni, 'VEC3');
      const indiceNormali = modo === MODO_TRIANGOLI ? primitiva.attributes['NORMAL'] : undefined;
      const accessorNormali =
        indiceNormali === undefined ? undefined : convalidaAccessor(json, bin, indiceNormali, 'VEC3');
      if (accessorNormali && accessorNormali.count !== accessorPosizioni.count) {
        throw new Error('Mappe: normali e posizioni di lunghezza diversa.');
      }
      const accessorIndici =
        primitiva.indices === undefined ? undefined : convalidaAccessor(json, bin, primitiva.indices, 'SCALAR');
      vertici += accessorPosizioni.count + (accessorNormali?.count ?? 0);
      if (vertici > TETTI_GLB.vertici) {
        throw new Error('Mappe: troppi vertici per una foto.');
      }
      const elementi = accessorIndici?.count ?? accessorPosizioni.count;
      if (
        modo === MODO_LINEE
          ? segmenti.length / 6 + Math.floor(elementi / 2) > TETTI_GLB.segmenti
          : triangoli.length / 9 + Math.floor(elementi / 3) > TETTI_GLB.triangoli
      ) {
        throw new Error(
          modo === MODO_LINEE ? 'Mappe: troppi spigoli per una foto.' : 'Mappe: troppi triangoli per una foto.',
        );
      }
      const posizioni = leggiFloat(bin, accessorPosizioni);
      const indici = leggiIndici(bin, accessorIndici, accessorPosizioni.count);
      if (modo === MODO_LINEE) {
        for (let elemento = 0; elemento + 1 < indici.length; elemento += 2) {
          segmenti.push(...punto(posizioni, indici[elemento]!), ...punto(posizioni, indici[elemento + 1]!));
        }
        continue;
      }
      const normaliSorgente = accessorNormali === undefined ? undefined : leggiFloat(bin, accessorNormali);
      for (let elemento = 0; elemento + 2 < indici.length; elemento += 3) {
        const angoli = [indici[elemento]!, indici[elemento + 1]!, indici[elemento + 2]!];
        const p = angoli.map((vertice) => punto(posizioni, vertice));
        const [ux, uy, uz] = [p[1]![0] - p[0]![0], p[1]![1] - p[0]![1], p[1]![2] - p[0]![2]];
        const [vx, vy, vz] = [p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2]];
        let faccia = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        const lunghezzaFaccia = Math.hypot(faccia[0]!, faccia[1]!, faccia[2]!) || 1;
        faccia = faccia.map((valore) => valore / lunghezzaFaccia);
        for (const [angolo, vertice] of angoli.entries()) {
          triangoli.push(...p[angolo]!);
          if (normaliSorgente) {
            const [x, y, z] = [
              normaliSorgente[vertice * 3]!,
              normaliSorgente[vertice * 3 + 1]!,
              normaliSorgente[vertice * 3 + 2]!,
            ];
            const r = [
              n[0]! * x + n[1]! * y + n[2]! * z,
              n[3]! * x + n[4]! * y + n[5]! * z,
              n[6]! * x + n[7]! * y + n[8]! * z,
            ];
            const lunghezza = Math.hypot(r[0]!, r[1]!, r[2]!) || 1;
            normali.push(r[0]! / lunghezza, r[1]! / lunghezza, r[2]! / lunghezza);
          } else {
            normali.push(faccia[0]!, faccia[1]!, faccia[2]!);
          }
        }
      }
    }
    for (const figlio of nodo.children ?? []) {
      visita(figlio, mondo, profondita + 1);
    }
  };

  // Senza scena: le radici sono i nodi che non sono figli di nessuno.
  const figli = new Set(nodi.flatMap((nodo) => nodo.children ?? []));
  const radici = json.scenes?.[json.scene ?? 0]?.nodes ?? nodi.map((_, indice) => indice).filter((i) => !figli.has(i));
  for (const radice of radici) {
    visita(radice, versoTau, 0);
  }
  return {
    triangoli: Float32Array.from(triangoli),
    normali: Float32Array.from(normali),
    segmenti: Float32Array.from(segmenti),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Camera e z-buffer
// ---------------------------------------------------------------------------------------------------------------------

type Vettore = readonly [number, number, number];

const radianti = (gradi: number): number => (gradi * Math.PI) / 180;

/** Gli assi della camera (convenzione della verifica D3, `assiCamera` di `@taucad/smlib/verifica`), rollo nullo. */
export function assiFoto(azimuth: number, elevation: number): { direzione: Vettore; su: Vettore; destra: Vettore } {
  const a = radianti(azimuth);
  const e = radianti(elevation);
  const direzione: Vettore = [-Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), -Math.sin(e)];
  const su: Vettore = [-Math.sin(e) * Math.sin(a), Math.sin(e) * Math.cos(a), Math.cos(e)];
  const destra: Vettore = [
    direzione[1] * su[2] - direzione[2] * su[1],
    direzione[2] * su[0] - direzione[0] * su[2],
    direzione[0] * su[1] - direzione[1] * su[0],
  ];
  return { direzione, su, destra };
}

/** La luce chiave, fissa nello spazio della camera (x destra, y su, z verso la camera): dall'alto a sinistra, davanti. */
const luce: Vettore = ((): Vettore => {
  const [x, y, z] = [-0.45, 0.62, 0.64];
  const lunghezza = Math.hypot(x, y, z);
  return [x / lunghezza, y / lunghezza, z / lunghezza];
})();

const PROFONDITA_VICINA = 255;
const PROFONDITA_LONTANA = 40;

const dot = (ax: number, ay: number, az: number, b: Vettore): number => ax * b[0] + ay * b[1] + az * b[2];

/** Se il modello è disteso (estensione Z ≤ metà della maggiore fra X e Y). */
function isPiatto(triangoli: Float32Array): boolean {
  const minimo = [Infinity, Infinity, Infinity];
  const massimo = [-Infinity, -Infinity, -Infinity];
  for (let indice = 0; indice < triangoli.length; indice++) {
    const asse = indice % 3;
    minimo[asse] = Math.min(minimo[asse]!, triangoli[indice]!);
    massimo[asse] = Math.max(massimo[asse]!, triangoli[indice]!);
  }
  const [x, y, z] = [0, 1, 2].map((asse) => massimo[asse]! - minimo[asse]!);
  return z! <= rapportoPiatto * Math.max(x!, y!);
}

/**
 * Rende le mappe di una vista.
 *
 * @param mesh - Triangoli e spigoli del modello (`meshDaGlb`).
 * @param vista - La vista (margine e zoom; e la camera, se non è data).
 * @param lato - Il lato delle immagini quadrate.
 * @param camera - Una camera esplicita al posto di quella della vista (il confronto del CAD guarda anche da dietro e
 *   dal basso); con una camera esplicita il «fronte» non si gira dall'alto per i pezzi piatti.
 * @returns Le mappe e la sagoma.
 */
export function rendiMappe(
  mesh: MeshFoto,
  vista: VistaFoto,
  lato: number = latoMappe,
  camera?: Readonly<{ azimuth: number; elevation: number }>,
): MappeFoto {
  const definizione = camera ? { ...definizioniViste[vista], ...camera } : definizioniViste[vista];
  const { triangoli, normali: normaliMesh, segmenti } = mesh;
  const vertici = triangoli.length / 3;
  if (vertici < 3) {
    throw new Error('Sample photo: the model has no surface to photograph.');
  }
  const elevation = !camera && vista === 'fronte' && isPiatto(triangoli) ? 90 : definizione.elevation;
  const { destra, su, direzione } = assiFoto(definizione.azimuth, elevation);

  // Coordinate sul piano dell'immagine (mm lungo destra e su) e profondità (mm lungo la direzione) di ogni vertice.
  const piano = new Float64Array(vertici * 3);
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let indice = 0; indice < vertici; indice++) {
    const [x, y, z] = [triangoli[indice * 3]!, triangoli[indice * 3 + 1]!, triangoli[indice * 3 + 2]!];
    const px = dot(x, y, z, destra);
    const py = dot(x, y, z, su);
    piano[indice * 3] = px;
    piano[indice * 3 + 1] = py;
    piano[indice * 3 + 2] = dot(x, y, z, direzione);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const estensione = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scala = ((lato * (1 - 2 * definizione.margine)) / estensione) * definizione.zoom;
  const [centroX, centroY] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const u = (px: number): number => lato / 2 + scala * (px - centroX);
  const v = (py: number): number => lato / 2 - scala * (py - centroY);

  const pixel = lato * lato;
  const zbuffer = new Float32Array(pixel).fill(Infinity);
  const normaleBuffer = new Float32Array(pixel * 3);

  for (let t = 0; t < vertici; t += 3) {
    const ax = u(piano[t * 3]!);
    const ay = v(piano[t * 3 + 1]!);
    const bx = u(piano[(t + 1) * 3]!);
    const by = v(piano[(t + 1) * 3 + 1]!);
    const cx = u(piano[(t + 2) * 3]!);
    const cy = v(piano[(t + 2) * 3 + 1]!);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) {
      continue;
    }
    const [da, db, dc] = [piano[t * 3 + 2]!, piano[(t + 1) * 3 + 2]!, piano[(t + 2) * 3 + 2]!];
    // Il pixel (x, y) copre [x, x+1) × [y, y+1) e si campiona nel centro.
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5));
    const x1 = Math.min(lato - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
    const y1 = Math.min(lato - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5;
        const wa = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) / area;
        const wb = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) / area;
        const wc = 1 - wa - wb;
        if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) {
          continue;
        }
        const profondita = wa * da + wb * db + wc * dc;
        const p = y * lato + x;
        if (profondita >= zbuffer[p]!) {
          continue;
        }
        zbuffer[p] = profondita;
        for (let asse = 0; asse < 3; asse++) {
          normaleBuffer[p * 3 + asse] =
            wa * normaliMesh[t * 3 + asse]! +
            wb * normaliMesh[(t + 1) * 3 + asse]! +
            wc * normaliMesh[(t + 2) * 3 + asse]!;
        }
      }
    }
  }

  let [vicino, lontano] = [Infinity, -Infinity];
  for (let p = 0; p < pixel; p++) {
    const profondita = zbuffer[p]!;
    if (profondita !== Infinity) {
      vicino = Math.min(vicino, profondita);
      lontano = Math.max(lontano, profondita);
    }
  }
  const intervallo = lontano - vicino;

  const sagoma = new Uint8Array(pixel);
  const ombreggiata = new Uint8Array(pixel).fill(255);
  const profonditaMappa = new Uint8Array(pixel);
  const normali = new Uint8Array(pixel * 3);
  for (let p = 0; p < pixel; p++) {
    const profondita = zbuffer[p]!;
    if (profondita === Infinity) {
      normali[p * 3] = 128;
      normali[p * 3 + 1] = 128;
      normali[p * 3 + 2] = 255;
      continue;
    }
    sagoma[p] = 1;
    profonditaMappa[p] = Math.round(
      intervallo > 1e-9
        ? PROFONDITA_VICINA - ((PROFONDITA_VICINA - PROFONDITA_LONTANA) * (profondita - vicino)) / intervallo
        : PROFONDITA_VICINA,
    );
    const [nx, ny, nz] = [normaleBuffer[p * 3]!, normaleBuffer[p * 3 + 1]!, normaleBuffer[p * 3 + 2]!];
    // Spazio della camera, a due facce: una normale che guarda via si gira verso la camera.
    let cxN = dot(nx, ny, nz, destra);
    let cyN = dot(nx, ny, nz, su);
    let czN = -dot(nx, ny, nz, direzione);
    const lunghezza = Math.hypot(cxN, cyN, czN) || 1;
    [cxN, cyN, czN] = [cxN / lunghezza, cyN / lunghezza, czN / lunghezza];
    if (czN < 0) {
      [cxN, cyN, czN] = [-cxN, -cyN, -czN];
    }
    normali[p * 3] = Math.round((cxN * 0.5 + 0.5) * 255);
    normali[p * 3 + 1] = Math.round((cyN * 0.5 + 0.5) * 255);
    normali[p * 3 + 2] = Math.round((czN * 0.5 + 0.5) * 255);
    // Grigio da studio: luce chiave più un riempimento dalla camera, lontano dal nero e dal bianco puri.
    const chiave = Math.max(0, cxN * luce[0] + cyN * luce[1] + czN * luce[2]);
    const tono = 0.16 + 0.62 * chiave + 0.14 * czN;
    ombreggiata[p] = Math.round(Math.min(0.9, Math.max(0.1, tono)) * 255);
  }

  // Bordi: il contorno della sagoma, poi ogni spigolo dove non è nascosto da una superficie.
  const bordi = new Uint8Array(pixel).fill(255);
  for (let y = 0; y < lato; y++) {
    for (let x = 0; x < lato; x++) {
      const p = y * lato + x;
      if (
        sagoma[p] === 1 &&
        (x === 0 ||
          y === 0 ||
          x === lato - 1 ||
          y === lato - 1 ||
          !sagoma[p - 1] ||
          !sagoma[p + 1] ||
          !sagoma[p - lato] ||
          !sagoma[p + lato])
      ) {
        bordi[p] = 0;
      }
    }
  }
  const tolleranza = Math.max(0.02 * intervallo, 2 / scala);
  let passiRestanti = PASSI_SPIGOLI_PER_PIXEL * pixel;
  for (let s = 0; s + 5 < segmenti.length && passiRestanti > 0; s += 6) {
    const [x0, y0, d0] = [
      u(dot(segmenti[s]!, segmenti[s + 1]!, segmenti[s + 2]!, destra)),
      v(dot(segmenti[s]!, segmenti[s + 1]!, segmenti[s + 2]!, su)),
      dot(segmenti[s]!, segmenti[s + 1]!, segmenti[s + 2]!, direzione),
    ];
    const [x1, y1, d1] = [
      u(dot(segmenti[s + 3]!, segmenti[s + 4]!, segmenti[s + 5]!, destra)),
      v(dot(segmenti[s + 3]!, segmenti[s + 4]!, segmenti[s + 5]!, su)),
      dot(segmenti[s + 3]!, segmenti[s + 4]!, segmenti[s + 5]!, direzione),
    ];
    const passi = Math.min(4 * lato, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2)));
    passiRestanti -= passi + 1;
    for (let passo = 0; passo <= passi; passo++) {
      const f = passo / passi;
      const [x, y, d] = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, d0 + (d1 - d0) * f];
      const [px, py] = [Math.floor(x), Math.floor(y)];
      if (px < 0 || py < 0 || px >= lato || py >= lato) {
        continue;
      }
      const p = py * lato + px;
      if (zbuffer[p] === Infinity || d <= zbuffer[p]! + tolleranza) {
        bordi[p] = 0;
        if (px + 1 < lato) {
          bordi[p + 1] = 0;
        }
      }
    }
  }

  const raster = (dati: Uint8Array, canali: 1 | 3): RasterFoto => ({ larghezza: lato, altezza: lato, canali, dati });
  return {
    vista,
    camera: { azimuth: definizione.azimuth, elevation },
    lato,
    pxPerMm: scala,
    ombreggiata: raster(ombreggiata, 1),
    profondita: raster(profonditaMappa, 1),
    normali: raster(normali, 3),
    bordi: raster(bordi, 1),
    sagoma: { larghezza: lato, altezza: lato, dati: sagoma },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// PNG e confronto
// ---------------------------------------------------------------------------------------------------------------------

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const TABELLA_CRC = ((): Uint32Array => {
  const tabella = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    tabella[n] = c >>> 0;
  }
  return tabella;
})();

function crc32(parti: readonly Uint8Array[]): number {
  let c = 0xff_ff_ff_ff;
  for (const parte of parti) {
    for (const byte of parte) {
      c = TABELLA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
    }
  }
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

function blocco(tipo: string, dati: Uint8Array): Uint8Array {
  const nome = new TextEncoder().encode(tipo);
  const uscita = new Uint8Array(12 + dati.length);
  const vista = new DataView(uscita.buffer);
  vista.setUint32(0, dati.length);
  uscita.set(nome, 4);
  uscita.set(dati, 8);
  vista.setUint32(8 + dati.length, crc32([nome, dati]));
  return uscita;
}

/**
 * Codifica un PNG a 8 bit (filtro «sub», deflate di `CompressionStream`, presente nel browser, in Node e in Deno).
 *
 * @param raster - I pixel (1 canale = grigio, 3 = RGB).
 * @returns Il file PNG.
 */
export async function codificaPngFoto(raster: RasterFoto): Promise<Uint8Array> {
  const { larghezza, altezza, canali, dati } = raster;
  const intestazione = new Uint8Array(13);
  const vista = new DataView(intestazione.buffer);
  vista.setUint32(0, larghezza);
  vista.setUint32(4, altezza);
  intestazione[8] = 8;
  intestazione[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[canali];
  const riga = larghezza * canali;
  const grezzo = new Uint8Array(altezza * (riga + 1));
  for (let y = 0; y < altezza; y++) {
    const inizio = y * (riga + 1);
    grezzo[inizio] = 1;
    const sorgente = y * riga;
    for (let i = 0; i < riga; i++) {
      grezzo[inizio + 1 + i] = (dati[sorgente + i]! - (i >= canali ? dati[sorgente + i - canali]! : 0)) & 0xff;
    }
  }
  const compresso = new Uint8Array(
    await new Response(new Blob([grezzo]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  );
  const parti = [
    Uint8Array.from(FIRMA_PNG),
    blocco('IHDR', intestazione),
    blocco('IDAT', compresso),
    blocco('IEND', new Uint8Array(0)),
  ];
  const uscita = new Uint8Array(parti.reduce((somma, parte) => somma + parte.length, 0));
  let scritto = 0;
  for (const parte of parti) {
    uscita.set(parte, scritto);
    scritto += parte.length;
  }
  return uscita;
}

/**
 * Intersezione su unione di due sagome della stessa dimensione.
 *
 * @param a - Una sagoma.
 * @param b - L'altra.
 * @returns IoU in [0, 1]; 1 se entrambe vuote.
 */
export function iouSagome(a: SagomaFoto, b: SagomaFoto): number {
  if (a.larghezza !== b.larghezza || a.altezza !== b.altezza) {
    throw new Error('Mappe: sagome di dimensioni diverse.');
  }
  let [intersezione, unione] = [0, 0];
  for (let p = 0; p < a.dati.length; p++) {
    const [x, y] = [a.dati[p]!, b.dati[p]!];
    intersezione += x & y;
    unione += x | y;
  }
  return unione === 0 ? 1 : intersezione / unione;
}

// ---------------------------------------------------------------------------------------------------------------------
// Impronta
// ---------------------------------------------------------------------------------------------------------------------

/**
 * SHA-256 esadecimale minuscolo (WebCrypto: browser, Node e Deno).
 *
 * @param bytes - I byte.
 * @returns 64 cifre esadecimali.
 */
export async function sha256Foto(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * L'impronta di una foto del campione: SHA-256 del GLB della versione inviata, vista, materiale (già normalizzato:
 * finitura solo sui metalli, «polished» se manca) e livello. È la chiave della cache (stessa impronta = stessa foto,
 * nessun secondo pagamento) e dello stato «da rifare» (un invio nuovo cambia il GLB). CAD e server la calcolano con
 * questa stessa funzione dagli stessi byte.
 *
 * @param ingresso - Impronta del GLB, vista, materiale, livello.
 * @returns 64 cifre esadecimali.
 */
export async function improntaFotoCampione(
  ingresso: Readonly<{
    glb: string;
    vista: VistaFoto;
    materiale: Readonly<{ id: string; finitura?: string }>;
    livello: string;
  }>,
): Promise<string> {
  const materiale =
    ingresso.materiale.finitura === undefined
      ? { id: ingresso.materiale.id }
      : { id: ingresso.materiale.id, finitura: ingresso.materiale.finitura };
  const testo = JSON.stringify({
    versione: 2,
    glb: ingresso.glb,
    vista: ingresso.vista,
    materiale,
    livello: ingresso.livello,
  });
  return sha256Foto(new TextEncoder().encode(testo));
}
