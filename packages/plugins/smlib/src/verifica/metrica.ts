import type { DefinizioneParametro } from '#famiglie/famiglia.js';
import { leggiParametro } from '#famiglie/parametri.js';
import type { ImmagineRaster } from '#verifica/png.js';
import type { MascheraBinaria } from '#verifica/silhouette.js';

/**
 * Metrica della verifica D3 (specifica §3.3, task T-D3-03).
 *
 * - `IoU_V = |S ∧ M ∧ V| / |(S ∨ M) ∧ V|`.
 * - Chamfer simmetrico sui contorni, in mm: media della distanza dei pixel di contorno di S dal contorno di M più la
 *   media inversa, contando solo i pixel di contorno dentro V. La trasformata della distanza del contorno di M si
 *   calcola una volta (`preparaConfronto`); quella di S a ogni valutazione (trasformata euclidea esatta,
 *   Felzenszwalb–Huttenlocher, lineare nei pixel).
 * - Obiettivo `f = (1 − IoU_V) + 0,05·chamfer_mm + 0,02·Σ wᵢ·((pᵢ − p̂ᵢ)/σᵢ)² + 0,2·vincoli violati`, con
 *   `σᵢ = max(½·(maxᵢ − minᵢ), 1 unità)` e `wᵢ` la confidenza del classificatore (0 per un parametro non visibile).
 */

/** Pesi dell'obiettivo (§3.3). */
export const PESI_OBIETTIVO = { chamfer: 0.05, prior: 0.02, vincolo: 0.2 } as const;

/** La maschera di riferimento pronta per molti confronti. */
export type ConfrontoMaschera = {
  larghezza: number;
  altezza: number;
  /** Maschera M (0/1). */
  dati: Uint8Array;
  /** Regione valida V (0/1). */
  valida: Uint8Array;
  /** Pixel di contorno di M dentro V. */
  contorno: Int32Array;
  /** Distanza (px) di ogni pixel dal contorno di M. */
  distanzaContorno: Float32Array;
  /** Pixel di M dentro V. */
  areaValida: number;
};

/** Esito di un confronto silhouette ↔ maschera. */
export type Confronto = { iou: number; chamferPx: number; chamferMm: number };

const INFINITO = 1e20;

/** Trasformata 1D delle distanze al quadrato (inviluppo inferiore di parabole). */
function trasformata1D(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INFINITO;
  z[1] = INFINITO;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INFINITO;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) {
      k++;
    }
    d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
  }
}

/**
 * Trasformata euclidea esatta della distanza dai pixel accesi.
 * @param accesi - Pixel sorgente (1 = distanza 0).
 * @param larghezza - Larghezza.
 * @param altezza - Altezza.
 * @returns Distanza in pixel di ogni pixel dal più vicino acceso (molto grande se non ce n'è).
 */
export function trasformataDistanza(accesi: Uint8Array, larghezza: number, altezza: number): Float32Array {
  const n = Math.max(larghezza, altezza);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const griglia = new Float64Array(larghezza * altezza);
  for (let x = 0; x < larghezza; x++) {
    for (let y = 0; y < altezza; y++) {
      f[y] = accesi[y * larghezza + x] ? 0 : INFINITO;
    }
    trasformata1D(f, altezza, d, v, z);
    for (let y = 0; y < altezza; y++) {
      griglia[y * larghezza + x] = d[y]!;
    }
  }
  const uscita = new Float32Array(larghezza * altezza);
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      f[x] = griglia[y * larghezza + x]!;
    }
    trasformata1D(f, larghezza, d, v, z);
    for (let x = 0; x < larghezza; x++) {
      uscita[y * larghezza + x] = Math.sqrt(d[x]!);
    }
  }
  return uscita;
}

/**
 * Pixel di contorno: accesi con almeno un vicino (4-connesso) spento o fuori dall'immagine.
 * @param maschera - Maschera binaria.
 * @returns 1 sui pixel di contorno.
 */
export function contorno(maschera: MascheraBinaria): Uint8Array {
  const { larghezza, altezza, dati } = maschera;
  const uscita = new Uint8Array(larghezza * altezza);
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      const p = y * larghezza + x;
      if (
        dati[p] &&
        (x === 0 ||
          y === 0 ||
          x === larghezza - 1 ||
          y === altezza - 1 ||
          !dati[p - 1] ||
          !dati[p + 1] ||
          !dati[p - larghezza] ||
          !dati[p + larghezza])
      ) {
        uscita[p] = 1;
      }
    }
  }
  return uscita;
}

const indiciValidi = (bordo: Uint8Array, valida: Uint8Array): Int32Array => {
  const indici: number[] = [];
  for (let p = 0; p < bordo.length; p++) {
    if (bordo[p] && valida[p]) {
      indici.push(p);
    }
  }
  return Int32Array.from(indici);
};

/**
 * Prepara la maschera M e la regione V per molti confronti (contorno e sua trasformata della distanza).
 * @param maschera - Maschera di riferimento con la sua regione valida.
 * @returns Il confronto pronto.
 */
export function preparaConfronto(maschera: MascheraBinaria & { valida: Uint8Array }): ConfrontoMaschera {
  const { larghezza, altezza, dati, valida } = maschera;
  const bordo = contorno(maschera);
  let areaValida = 0;
  for (let p = 0; p < dati.length; p++) {
    areaValida += dati[p]! & valida[p]!;
  }
  return {
    larghezza,
    altezza,
    dati,
    valida,
    contorno: indiciValidi(bordo, valida),
    distanzaContorno: trasformataDistanza(bordo, larghezza, altezza),
    areaValida,
  };
}

/**
 * IoU sulla regione valida.
 * @param silhouette - Silhouette S.
 * @param riferimento - Maschera M con V.
 * @returns `|S ∧ M ∧ V| / |(S ∨ M) ∧ V|` (1 se entrambe vuote).
 */
export function iouValida(
  silhouette: MascheraBinaria,
  riferimento: Pick<ConfrontoMaschera, 'dati' | 'valida'>,
): number {
  let [intersezione, unione] = [0, 0];
  const { dati, valida } = riferimento;
  const s = silhouette.dati;
  for (let p = 0; p < s.length; p++) {
    if (valida[p]) {
      intersezione += s[p]! & dati[p]!;
      unione += s[p]! | dati[p]!;
    }
  }
  return unione === 0 ? 1 : intersezione / unione;
}

/**
 * Confronta una silhouette con la maschera preparata: IoU sulla regione valida e chamfer simmetrico dei contorni.
 * @param silhouette - Silhouette S (stesse dimensioni della maschera).
 * @param riferimento - Maschera preparata.
 * @param pxPerMm - Pixel per millimetro (per il chamfer in mm).
 * @returns IoU, chamfer in pixel e in mm.
 */
export function confronta(silhouette: MascheraBinaria, riferimento: ConfrontoMaschera, pxPerMm: number): Confronto {
  const iou = iouValida(silhouette, riferimento);
  const bordoS = contorno(silhouette);
  const indiciS = indiciValidi(bordoS, riferimento.valida);
  if (indiciS.length === 0 || riferimento.contorno.length === 0) {
    const chamferPx = Math.max(riferimento.larghezza, riferimento.altezza);
    return { iou, chamferPx, chamferMm: chamferPx / pxPerMm };
  }
  let andata = 0;
  for (const p of indiciS) {
    andata += riferimento.distanzaContorno[p]!;
  }
  const distanzaS = trasformataDistanza(bordoS, silhouette.larghezza, silhouette.altezza);
  let ritorno = 0;
  for (const p of riferimento.contorno) {
    ritorno += distanzaS[p]!;
  }
  const chamferPx = andata / indiciS.length + ritorno / riferimento.contorno.length;
  return { iou, chamferPx, chamferMm: chamferPx / pxPerMm };
}

/** Stima del classificatore per il termine di prior: valori e confidenze per chiave. */
export type StimaParametri = {
  parametri: unknown;
  /** Confidenza 0–1 per chiave puntata (assente = 0,5). */
  confidenze?: Readonly<Record<string, number>>;
  /** Chiavi non visibili nella foto: peso 0. */
  nonVisibili?: readonly string[];
};

/**
 * Scarto tipico di un parametro per il prior: metà dell'intervallo, almeno un'unità (1 mm, 1°, 0,05 di frazione).
 * @param definizione - Definizione del parametro.
 * @returns σ.
 */
export function sigmaParametro(definizione: DefinizioneParametro): number {
  const minimo = definizione.unita === 'frazione' ? 0.05 : 1;
  if (definizione.min === undefined || definizione.max === undefined) {
    return minimo;
  }
  return Math.max(0.5 * (definizione.max - definizione.min), minimo);
}

/**
 * Termine di prior `Σ wᵢ·((pᵢ − p̂ᵢ)/σᵢ)²` sui parametri numerici dati.
 * @param p - Parametri valutati.
 * @param stima - Stima del classificatore.
 * @param definizioni - Definizioni dei parametri da considerare.
 * @returns La somma (senza il peso 0,02).
 */
export function prior(p: unknown, stima: StimaParametri, definizioni: readonly DefinizioneParametro[]): number {
  let somma = 0;
  const nonVisibili = new Set(stima.nonVisibili ?? []);
  for (const definizione of definizioni) {
    const valore = leggiParametro(p, definizione.chiave);
    const stimato = leggiParametro(stima.parametri, definizione.chiave);
    if (typeof valore !== 'number' || typeof stimato !== 'number' || nonVisibili.has(definizione.chiave)) {
      continue;
    }
    const peso = stima.confidenze?.[definizione.chiave] ?? 0.5;
    somma += peso * ((valore - stimato) / sigmaParametro(definizione)) ** 2;
  }
  return somma;
}

/**
 * Obiettivo dell'ottimizzatore.
 * @param termini - IoU, chamfer in mm, prior e vincoli violati.
 * @returns `f` (più piccolo è meglio; 0 = combacia e coincide con la stima).
 */
export function obiettivo(termini: { iou: number; chamferMm: number; prior?: number; violazioni?: number }): number {
  return (
    1 -
    termini.iou +
    PESI_OBIETTIVO.chamfer * termini.chamferMm +
    PESI_OBIETTIVO.prior * (termini.prior ?? 0) +
    PESI_OBIETTIVO.vincolo * (termini.violazioni ?? 0)
  );
}

/**
 * Immagine differenza per la chat e per il rientro del modello: rosso dove la silhouette non ha la maschera, blu dove la
 * maschera non ha la silhouette, grigio scuro dove combaciano; fuori dalla regione valida tutto più chiaro.
 * @param silhouette - Silhouette S.
 * @param riferimento - Maschera M con V.
 * @returns Immagine RGB.
 */
export function immagineDifferenza(
  silhouette: MascheraBinaria,
  riferimento: Pick<ConfrontoMaschera, 'larghezza' | 'altezza' | 'dati' | 'valida'>,
): ImmagineRaster {
  const { larghezza, altezza, dati: m, valida } = riferimento;
  const uscita = new Uint8Array(larghezza * altezza * 3);
  for (let p = 0; p < m.length; p++) {
    const s = silhouette.dati[p]!;
    let colore: [number, number, number] = [255, 255, 255];
    if (s && m[p]) {
      colore = [70, 70, 70];
    } else if (s) {
      colore = [220, 30, 30];
    } else if (m[p]) {
      colore = [30, 80, 230];
    }
    if (!valida[p]) {
      colore = colore.map((c) => Math.round(c + (255 - c) * 0.6)) as [number, number, number];
    }
    uscita.set(colore, p * 3);
  }
  return { larghezza, altezza, canali: 3, dati: uscita };
}
