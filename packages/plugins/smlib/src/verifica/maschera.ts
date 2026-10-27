import { decodificaPng } from '#verifica/png.js';
import type { ImmagineRaster } from '#verifica/png.js';
import { LATO_VERIFICA } from '#verifica/silhouette.js';
import type { MascheraBinaria } from '#verifica/silhouette.js';

/**
 * Maschera di riferimento della verifica D3 (specifica §3.2, task T-D3-02): da una maschera PNG o alfa (SAM di
 * Sinopia: bianco = parte; oppure ritaglio trasparente) a una maschera binaria quadrata di 256 px, con la sua regione di
 * validità e i momenti per inizializzare la camera.
 *
 * Passi: soglia `> 127` sul canale scelto → componente connessa più grande (8-connessa; i suoi buchi restano buchi:
 * il foro di una fibbia) → riquadro quadrato attorno al riquadro della componente con il 12 % di margine per lato →
 * riduzione a 256 per **media d'area esatta** (tabella delle somme: la copertura frazionaria di ogni pixel d'uscita) e
 * soglia 0,5. Regione valida `V`: i pixel che cadono per almeno metà dentro la foto (oltre il bordo non si sa) meno una
 * fascia dell'8 % del lato sui lati dichiarati occlusi (lì la parte è coperta e il confronto non conta).
 */

export type LatoOccluso = 'alto' | 'basso' | 'sinistra' | 'destra';

/** Canale che porta la parte: `auto` = alfa se l'immagine ne ha uno non pieno, altrimenti il rosso (o il grigio). */
export type CanaleMaschera = 'auto' | 'rosso' | 'alfa' | 'luminanza';

export type OpzioniMaschera = {
  /** Lato della maschera d'uscita (predefinito 256). */
  lato?: number;
  /** Margine per lato attorno al riquadro della parte, frazione del lato maggiore (predefinito 0,12). */
  margine?: number;
  canale?: CanaleMaschera;
  /** Soglia sul canale (predefinito 127: acceso se maggiore). */
  soglia?: number;
  latiOcclusi?: readonly LatoOccluso[];
  /** Fascia esclusa sui lati occlusi, frazione del lato (predefinito 0,08). */
  fasciaOcclusa?: number;
  /** Pixel per millimetro della foto, se la scala è nota. */
  pxPerMm?: number | null;
};

/** Momenti della maschera, in pixel della maschera. */
export type MomentiMaschera = {
  area: number;
  baricentro: [number, number];
  /** Angolo dell'asse principale in gradi, antiorario con l'alto dell'immagine verso l'alto, in (−90, 90]. */
  angoloAsse: number;
  /** Semiassi dell'ellisse equivalente (2·σ lungo gli assi principali), maggiore poi minore. */
  semiassi: [number, number];
};

export type MascheraPreparata = MascheraBinaria & {
  /** Regione valida (1 = il pixel conta nel confronto). */
  valida: Uint8Array;
  /** Copertura frazionaria di ogni pixel (0–1) prima della soglia: il bordo con precisione sotto il pixel. */
  copertura: Float32Array;
  /** Fattore foto → maschera: un pixel della foto vale `k` pixel della maschera. */
  k: number;
  /** Angolo in alto a sinistra della maschera nella foto (pixel della foto, frazionari). */
  origine: [number, number];
  /** Riquadro della parte nella foto `[x0, y0, x1, y1]` (pixel inclusi). */
  riquadroFoto: [number, number, number, number];
  /** Dimensioni della foto. */
  foto: { larghezza: number; altezza: number };
  /** Pixel della maschera per millimetro (`pxPerMm · k`), se la scala della foto è nota. */
  pxPerMm: number | null;
  momenti: MomentiMaschera;
};

const valoreCanale = (immagine: ImmagineRaster, canale: Exclude<CanaleMaschera, 'auto'>, indice: number): number => {
  const { canali, dati } = immagine;
  const k = indice * canali;
  switch (canale) {
    case 'alfa': {
      return canali === 2 || canali === 4 ? dati[k + canali - 1]! : 255;
    }
    case 'luminanza': {
      return canali >= 3 ? 0.299 * dati[k]! + 0.587 * dati[k + 1]! + 0.114 * dati[k + 2]! : dati[k]!;
    }
    default: {
      return dati[k]!;
    }
  }
};

const scegliCanale = (immagine: ImmagineRaster, richiesto: CanaleMaschera): Exclude<CanaleMaschera, 'auto'> => {
  if (richiesto !== 'auto') {
    return richiesto;
  }
  if (immagine.canali === 2 || immagine.canali === 4) {
    const n = immagine.larghezza * immagine.altezza;
    for (let indice = 0; indice < n; indice++) {
      if (immagine.dati[indice * immagine.canali + immagine.canali - 1]! < 255) {
        return 'alfa';
      }
    }
  }
  return 'rosso';
};

/**
 * La componente 8-connessa più grande dei pixel accesi (i buchi restano spenti).
 * @param acceso - Pixel accesi della foto.
 * @param larghezza - Larghezza della foto.
 * @param altezza - Altezza della foto.
 * @returns La componente (0/1) e il suo riquadro, o null se non c'è nulla.
 */
export function componentePiuGrande(
  acceso: Uint8Array,
  larghezza: number,
  altezza: number,
): { dati: Uint8Array; riquadro: [number, number, number, number] } | null {
  const etichette = new Int32Array(larghezza * altezza);
  const pila = new Int32Array(larghezza * altezza);
  let [migliore, dimensioneMigliore, prossima] = [0, 0, 1];
  for (let inizio = 0; inizio < acceso.length; inizio++) {
    if (!acceso[inizio] || etichette[inizio]) {
      continue;
    }
    const etichetta = prossima++;
    let [cima, dimensione] = [0, 0];
    pila[cima++] = inizio;
    etichette[inizio] = etichetta;
    while (cima > 0) {
      const p = pila[--cima]!;
      dimensione++;
      const x = p % larghezza;
      const y = (p - x) / larghezza;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= altezza) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= larghezza) {
            continue;
          }
          const q = yy * larghezza + xx;
          if (acceso[q] && !etichette[q]) {
            etichette[q] = etichetta;
            pila[cima++] = q;
          }
        }
      }
    }
    if (dimensione > dimensioneMigliore) {
      [migliore, dimensioneMigliore] = [etichetta, dimensione];
    }
  }
  if (migliore === 0) {
    return null;
  }
  const dati = new Uint8Array(larghezza * altezza);
  let [x0, y0, x1, y1] = [larghezza, altezza, -1, -1];
  for (let p = 0; p < etichette.length; p++) {
    if (etichette[p] === migliore) {
      dati[p] = 1;
      const x = p % larghezza;
      const y = (p - x) / larghezza;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { dati, riquadro: [x0, y0, x1, y1] };
}

/**
 * Momenti di una maschera binaria (area, baricentro, asse principale).
 * @param maschera - Maschera binaria.
 * @param valida - Pixel che contano (predefinito: tutti).
 * @returns I momenti, in pixel.
 */
export function momenti(maschera: MascheraBinaria, valida?: Uint8Array): MomentiMaschera {
  const { larghezza, altezza, dati } = maschera;
  let [n, sx, sy] = [0, 0, 0];
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      const p = y * larghezza + x;
      if (dati[p] && (!valida || valida[p])) {
        n++;
        sx += x + 0.5;
        sy += y + 0.5;
      }
    }
  }
  if (n === 0) {
    return { area: 0, baricentro: [larghezza / 2, altezza / 2], angoloAsse: 0, semiassi: [0, 0] };
  }
  const [mx, my] = [sx / n, sy / n];
  let [sxx, syy, sxy] = [0, 0, 0];
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      const p = y * larghezza + x;
      if (dati[p] && (!valida || valida[p])) {
        const [dx, dy] = [x + 0.5 - mx, my - (y + 0.5)];
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
    }
  }
  [sxx, syy, sxy] = [sxx / n, syy / n, sxy / n];
  const angolo = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
  const media = (sxx + syy) / 2;
  const scarto = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  return {
    area: n,
    baricentro: [mx, my],
    angoloAsse: angolo <= -90 ? angolo + 180 : angolo,
    semiassi: [2 * Math.sqrt(media + scarto), 2 * Math.sqrt(Math.max(0, media - scarto))],
  };
}

/**
 * Prepara la maschera di riferimento da pixel già decodificati.
 * @param immagine - Foto della maschera (qualsiasi numero di canali).
 * @param opzioni - Lato, margine, canale, soglia, lati occlusi, scala.
 * @returns La maschera 256² con validità, fattore `k`, origine e momenti.
 */
export function preparaMaschera(immagine: ImmagineRaster, opzioni: OpzioniMaschera = {}): MascheraPreparata {
  const lato = opzioni.lato ?? LATO_VERIFICA;
  const margine = opzioni.margine ?? 0.12;
  const soglia = opzioni.soglia ?? 127;
  const { larghezza: W, altezza: H } = immagine;
  const canale = scegliCanale(immagine, opzioni.canale ?? 'auto');
  const acceso = new Uint8Array(W * H);
  for (let indice = 0; indice < acceso.length; indice++) {
    acceso[indice] = valoreCanale(immagine, canale, indice) > soglia ? 1 : 0;
  }
  const componente = componentePiuGrande(acceso, W, H);
  if (!componente) {
    throw new RangeError('La maschera è vuota: nessun pixel sopra la soglia.');
  }
  const [bx0, by0, bx1, by1] = componente.riquadro;
  const latoFoto = Math.max(bx1 - bx0 + 1, by1 - by0 + 1) * (1 + 2 * margine);
  const k = lato / latoFoto;
  const origine: [number, number] = [(bx0 + bx1 + 1) / 2 - latoFoto / 2, (by0 + by1 + 1) / 2 - latoFoto / 2];

  // Tabella delle somme (W+1)·(H+1): F(x, y) = pixel accesi in [0, x) × [0, y); fra i nodi F è bilineare.
  const larghezzaTabella = W + 1;
  const tabella = new Uint32Array(larghezzaTabella * (H + 1));
  for (let y = 0; y < H; y++) {
    let riga = 0;
    for (let x = 0; x < W; x++) {
      riga += componente.dati[y * W + x]!;
      tabella[(y + 1) * larghezzaTabella + x + 1] = tabella[y * larghezzaTabella + x + 1]! + riga;
    }
  }
  const F = (x: number, y: number): number => {
    const cx = Math.min(W, Math.max(0, x));
    const cy = Math.min(H, Math.max(0, y));
    const ix = Math.min(W - 1, Math.floor(cx));
    const iy = Math.min(H - 1, Math.floor(cy));
    const [fx, fy] = [cx - ix, cy - iy];
    const f00 = tabella[iy * larghezzaTabella + ix]!;
    const f10 = tabella[iy * larghezzaTabella + ix + 1]!;
    const f01 = tabella[(iy + 1) * larghezzaTabella + ix]!;
    const f11 = tabella[(iy + 1) * larghezzaTabella + ix + 1]!;
    return f00 + fx * (f10 - f00) + fy * (f01 - f00) + fx * fy * (f11 - f10 - f01 + f00);
  };

  const dati = new Uint8Array(lato * lato);
  const valida = new Uint8Array(lato * lato);
  const coperture = new Float32Array(lato * lato);
  const passo = 1 / k;
  const area = passo * passo;
  const fascia = Math.round((opzioni.fasciaOcclusa ?? 0.08) * lato);
  const occlusi = new Set(opzioni.latiOcclusi ?? []);
  for (let j = 0; j < lato; j++) {
    const ya = origine[1] + j * passo;
    const yb = ya + passo;
    const dentroY = Math.max(0, Math.min(H, yb) - Math.max(0, ya));
    for (let i = 0; i < lato; i++) {
      const xa = origine[0] + i * passo;
      const xb = xa + passo;
      const p = j * lato + i;
      const copertura = (F(xb, yb) - F(xa, yb) - F(xb, ya) + F(xa, ya)) / area;
      coperture[p] = copertura;
      dati[p] = copertura >= 0.5 ? 1 : 0;
      const dentro = (Math.max(0, Math.min(W, xb) - Math.max(0, xa)) * dentroY) / area;
      const inFascia =
        (occlusi.has('alto') && j < fascia) ||
        (occlusi.has('basso') && j >= lato - fascia) ||
        (occlusi.has('sinistra') && i < fascia) ||
        (occlusi.has('destra') && i >= lato - fascia);
      valida[p] = dentro >= 0.5 && !inFascia ? 1 : 0;
    }
  }
  const maschera: MascheraBinaria = { larghezza: lato, altezza: lato, dati };
  return {
    ...maschera,
    valida,
    copertura: coperture,
    k,
    origine,
    riquadroFoto: componente.riquadro,
    foto: { larghezza: W, altezza: H },
    pxPerMm: opzioni.pxPerMm ? opzioni.pxPerMm * k : null,
    momenti: momenti(maschera, valida),
  };
}

/**
 * Prepara la maschera da un file PNG (decodificato senza canvas: vale nel worker e nei test).
 * @param png - Contenuto del file.
 * @param opzioni - Come `preparaMaschera`.
 * @returns La maschera preparata.
 */
export async function preparaMascheraPng(png: Uint8Array, opzioni: OpzioniMaschera = {}): Promise<MascheraPreparata> {
  return preparaMaschera(await decodificaPng(png), opzioni);
}
