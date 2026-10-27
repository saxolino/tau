/**
 * Cache delle mesh per pezzo.
 *
 * La tassellatura pesa il 47–70 % di una modifica di un parametro (studio text-to-cad, «Misura del 27 ottobre») e
 * si rifaceva per intero a ogni modifica e di nuovo nell'export GLB. Una modifica cambia di solito un pezzo solo:
 * gli altri hanno la stessa forma e la stessa tolleranza, quindi la stessa mesh. La chiave è l'impronta della forma
 * esatta, il `.smb` binario del corpo (senza perdite: due corpi con lo stesso `.smb` sono lo stesso corpo), più la
 * tolleranza. Le voci tengono solo array JavaScript, nessun oggetto del kernel: l'espulsione non ha nulla da
 * liberare nel WASM, e un pezzo liberato (`dispose`) non lascia voci che puntano al vuoto.
 *
 * @public
 */

import type * as SmlibModule from '@classcad/smlibwasm';
import type { GeometrySmlib } from '#smlib.types.js';

/** Le facce tassellate di un pezzo e se ogni triangolo sa da che faccia viene. @public */
export type FacceInCache = Readonly<{ faces: GeometrySmlib['faces']; faceMappingTrusted: boolean }>;

/** Gli spigoli campionati di un pezzo. @public */
export type SpigoliInCache = GeometrySmlib['edges'];

/** Quante voci e quanti byte (stimati) tiene una cache, e come è andata finora. @public */
export type StatoCacheMesh = Readonly<{
  voci: number;
  byte: number;
  colpi: number;
  mancati: number;
  espulsi: number;
}>;

/** Il tetto di una cache: oltre l'uno o l'altro si espelle la voce usata meno di recente. @public */
export type LimitiCacheMesh = Readonly<{ byte: number; voci: number }>;

type Voce = { readonly valore: FacceInCache | SpigoliInCache; readonly byte: number };

/** Byte per numero in un array JavaScript: stima prudente (un double occupa 8 byte). */
const bytePerNumero = 8;
/** Byte per gruppo di facce o di spigoli (tre numeri e l'oggetto). */
const bytePerGruppo = 48;

const byteFacce = (faces: GeometrySmlib['faces']): number =>
  (faces.triangles.length +
    faces.vertices.length +
    faces.normals.length +
    (faces.texCoords?.length ?? 0) +
    (faces.tangents?.length ?? 0)) *
    bytePerNumero +
  faces.faceGroups.length * bytePerGruppo;

const byteSpigoli = (edges: SpigoliInCache): number =>
  edges.lines.length * bytePerNumero + edges.edgeGroups.length * bytePerGruppo;

/**
 * Cache LRU delle mesh per pezzo, con un tetto di voci e di byte. Gli array restituiti sono condivisi fra i rendering:
 * chi li riceve li legge soltanto (la conversione in glTF ne fa copie).
 * @public
 */
export class CacheMesh {
  readonly #voci = new Map<string, Voce>();
  readonly #limiti: LimitiCacheMesh;
  #byte = 0;
  #colpi = 0;
  #mancati = 0;
  #espulsi = 0;

  /**
   * Una cache vuota.
   * @param limiti - Il tetto di voci e di byte.
   */
  public constructor(limiti: LimitiCacheMesh) {
    this.#limiti = limiti;
  }

  /**
   * Come sta la cache.
   * @returns Voci, byte e conteggi di colpi, mancati ed espulsioni.
   */
  public get stato(): StatoCacheMesh {
    return {
      voci: this.#voci.size,
      byte: this.#byte,
      colpi: this.#colpi,
      mancati: this.#mancati,
      espulsi: this.#espulsi,
    };
  }

  /**
   * Le facce di un pezzo, se la cache le ha.
   * @param chiave - Impronta della forma e tolleranza.
   * @returns Le facce, o undefined.
   */
  public leggiFacce(chiave: string): FacceInCache | undefined {
    return this.#leggi(`f|${chiave}`) as FacceInCache | undefined;
  }

  /**
   * Conserva le facce di un pezzo.
   * @param chiave - Impronta della forma e tolleranza.
   * @param valore - Le facce e la loro mappatura.
   */
  public scriviFacce(chiave: string, valore: FacceInCache): void {
    this.#scrivi(`f|${chiave}`, valore, byteFacce(valore.faces));
  }

  /**
   * Gli spigoli di un pezzo, se la cache li ha.
   * @param chiave - Impronta della forma e tolleranza.
   * @returns Gli spigoli, o undefined.
   */
  public leggiSpigoli(chiave: string): SpigoliInCache | undefined {
    return this.#leggi(`e|${chiave}`) as SpigoliInCache | undefined;
  }

  /**
   * Conserva gli spigoli di un pezzo.
   * @param chiave - Impronta della forma e tolleranza.
   * @param valore - Le polilinee degli spigoli.
   */
  public scriviSpigoli(chiave: string, valore: SpigoliInCache): void {
    this.#scrivi(`e|${chiave}`, valore, byteSpigoli(valore));
  }

  /** Svuota la cache (i conteggi restano). */
  public svuota(): void {
    this.#voci.clear();
    this.#byte = 0;
  }

  #leggi(chiave: string): FacceInCache | SpigoliInCache | undefined {
    const voce = this.#voci.get(chiave);
    if (voce === undefined) {
      this.#mancati++;
      return undefined;
    }
    // In coda: la più recente.
    this.#voci.delete(chiave);
    this.#voci.set(chiave, voce);
    this.#colpi++;
    return voce.valore;
  }

  #scrivi(chiave: string, valore: FacceInCache | SpigoliInCache, byte: number): void {
    const vecchia = this.#voci.get(chiave);
    if (vecchia !== undefined) {
      this.#voci.delete(chiave);
      this.#byte -= vecchia.byte;
    }
    if (byte > this.#limiti.byte) {
      return;
    }
    this.#voci.set(chiave, { valore, byte });
    this.#byte += byte;
    for (const [piuVecchia, voce] of this.#voci) {
      if (this.#byte <= this.#limiti.byte && this.#voci.size <= this.#limiti.voci) {
        break;
      }
      this.#voci.delete(piuVecchia);
      this.#byte -= voce.byte;
      this.#espulsi++;
    }
  }
}

/**
 * Le cache di un kernel: `fine` per l'anteprima a riposo e per gli export (le chiavi portano la tolleranza, quindi un
 * export riusa la mesh dell'anteprima solo se la tolleranza è la stessa), `interattiva` per le mesh grosse del
 * trascinamento. Sono separate: una mesh grossa non può finire in un export, e il trascinamento non espelle le mesh
 * fini dei pezzi che non cambia.
 * @public
 */
export type CacheMeshKernel = Readonly<{ fine: CacheMesh; interattiva: CacheMesh }>;

/**
 * Il tetto delle cache di un kernel, in byte stimati (8 per numero; nel heap gli array costano fino a una volta e mezza
 * tanto). Un modello di famiglia pesa 0,5–1 MB di mesh di vista e 2–3 MB di mesh di export: la cache fine tiene
 * qualche decina di versioni recenti, quella grossa i passi di un trascinamento.
 */
export const limitiCacheMesh = {
  fine: { byte: 24 * 1024 * 1024, voci: 256 },
  interattiva: { byte: 8 * 1024 * 1024, voci: 64 },
} as const satisfies Record<keyof CacheMeshKernel, LimitiCacheMesh>;

/**
 * Le cache di un kernel appena avviato.
 * @returns Una cache fine e una interattiva, vuote.
 * @public
 */
export const creaCacheMeshKernel = (): CacheMeshKernel => ({
  fine: new CacheMesh(limitiCacheMesh.fine),
  interattiva: new CacheMesh(limitiCacheMesh.interattiva),
});

/* oxlint-disable no-bitwise, unicorn/prefer-math-trunc, unicorn/numeric-separators-style -- MurmurHash3 x86_32 è definito su rotazioni, xor e moltiplicazioni a 32 bit; le costanti sono quelle dell'algoritmo. */
const ruota = (valore: number, passi: number): number => (valore << passi) | (valore >>> (32 - passi));

/**
 * MurmurHash3 x86_32 sulle parole a 32 bit dei byte, con costanti scelte: due corsie con costanti e semi diversi
 * danno 64 bit.
 * @param parole - I byte presi a quattro a quattro.
 * @param coda - Gli ultimi byte (meno di quattro).
 * @param corsia - Seme e costanti della corsia.
 * @returns L'hash a 32 bit senza segno.
 */
function murmur32(
  parole: Uint32Array<ArrayBuffer>,
  coda: Uint8Array<ArrayBuffer>,
  corsia: Readonly<{ seme: number; c1: number; c2: number }>,
): number {
  const { seme, c1, c2 } = corsia;
  let hash = seme;
  for (const parola of parole) {
    hash ^= Math.imul(ruota(Math.imul(parola, c1), 15), c2);
    hash = ruota(hash, 13);
    hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
  }
  if (coda.length > 0) {
    let resto = 0;
    for (let indice = coda.length - 1; indice >= 0; indice--) {
      resto = (resto << 8) | coda[indice]!;
    }
    hash ^= Math.imul(ruota(Math.imul(resto, c1), 15), c2);
  }
  hash ^= parole.length * 4 + coda.length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

const corsie = [
  { seme: 0x9747b28c, c1: 0xcc9e2d51, c2: 0x1b873593 },
  { seme: 0x3c6ef372, c1: 0x239b961b, c2: 0xab0e9789 },
] as const;
/* oxlint-enable no-bitwise, unicorn/prefer-math-trunc, unicorn/numeric-separators-style */

/**
 * Hash a 64 bit (due corsie da 32) di una sequenza di byte, con la lunghezza: non crittografico, deterministico nel
 * processo che lo calcola.
 * @param byte - La sequenza da riassumere (una vista che non parte da un multiplo di quattro si copia).
 * @returns Sedici cifre esadecimali, due punti e la lunghezza.
 * @public
 */
export function hashByte64(byte: Uint8Array<ArrayBuffer>): string {
  const allineati = byte.byteOffset % 4 === 0 ? byte : new Uint8Array(byte);
  const intere = Math.floor(allineati.length / 4);
  const parole = new Uint32Array(allineati.buffer, allineati.byteOffset, intere);
  const coda = allineati.subarray(intere * 4);
  return `${corsie.map((corsia) => murmur32(parole, coda, corsia).toString(16).padStart(8, '0')).join('')}:${allineati.length}`;
}

type SmlibLibrary = typeof SmlibModule;
/** Le forme che si tassellano dal B-rep (le mesh si leggono così come sono). @public */
export type FormaConImpronta = SmlibModule.Part | SmlibModule.Shell | SmlibModule.Face;

/** Impronte già calcolate, per oggetto: un corpo non cambia più dopo che è stato creato. */
const impronte = new WeakMap<WeakKey, string>();

/**
 * L'impronta della forma esatta di un corpo: l'hash del suo `.smb` binario (meno di un millisecondo per un modello di
 * famiglia). Si calcola una volta per oggetto: lo stesso corpo nell'anteprima e nell'export non si rilegge.
 * @param library - La libreria SMLib del kernel.
 * @param forma - Un corpo, un guscio o una faccia (la faccia passa da un guscio temporaneo, liberato subito).
 * @returns L'impronta.
 * @public
 */
export function improntaForma(library: SmlibLibrary, forma: FormaConImpronta): string {
  const nota = impronte.get(forma);
  if (nota !== undefined) {
    return nota;
  }
  let byte: Uint8Array<ArrayBuffer>;
  if (forma instanceof library.Face) {
    const guscio = forma.toShell();
    try {
      byte = new Uint8Array(library.toSmb(guscio, { ascii: false }));
    } finally {
      guscio.dispose();
    }
  } else {
    byte = new Uint8Array(library.toSmb(forma, { ascii: false }));
  }
  const impronta = hashByte64(byte);
  impronte.set(forma, impronta);
  return impronta;
}
