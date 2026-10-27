import type { SchedaParte } from '#riconoscimento/scheda-parte.js';

/**
 * Stima della scala (specifica D2 §2.5): cinque fonti in ordine di priorità, la prima disponibile vince. Le misure in
 * pixel si prendono sulla maschera della parte (pixel dell'immagine originale).
 */

/** Una maschera binaria (1 = parte), riga per riga: la stessa forma di `verifica/` (D3). @public */
export type MascheraBinaria = Readonly<{ larghezza: number; altezza: number; dati: Uint8Array<ArrayBuffer> }>;

/** Le fonti candidate della scala, ciascuna facoltativa. @public */
export type CandidatiScala = Readonly<{
  /** «Una misura che conosci» (`measure=<mm>:<cosa>`). */
  misura?: Readonly<{ valoreMm: number; cosa: string }>;
  /** Libreria componenti: `width_mm`/`height_mm` (immagini frontali, senza prospettiva). */
  libreria?: Readonly<{ larghezzaMm?: number; altezzaMm?: number }>;
  /** Catalogo fornitori: una misura di `technical_specs` (per esempio `inner_width_mm` di una fibbia). */
  catalogo?: Readonly<{ valoreMm: number; cosa: string }>;
  /** Taglia EU della scarpa intera nell'immagine, con l'estensione in pixel della parte «scarpa/suola». */
  taglia?: Readonly<{ taglia: number; lunghezzaPx?: number }>;
  /** Lunghezza del piede della forma del progetto (`shoe_lasts.foot_length_mm`). */
  forma?: Readonly<{ lunghezzaPiedeMm: number; lunghezzaPx?: number }>;
}>;

/** Confidenza per fonte (§2.5). @public */
export const confidenzaScala = { misura: 0.95, libreria: 0.9, catalogo: 0.9, taglia: 0.6, forma: 0.6 } as const;

/** Estensione della maschera: riquadro dei pixel accesi. @public */
export type Estensione = Readonly<{
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  larghezza: number;
  altezza: number;
}>;

/**
 * Il riquadro dei pixel accesi della maschera.
 * @param maschera - La maschera.
 * @returns L'estensione (larghezza e altezza in pixel, estremi inclusi), o undefined se la maschera è vuota.
 * @public
 */
export function estensioneMaschera(maschera: MascheraBinaria): Estensione | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < maschera.altezza; y++) {
    const riga = y * maschera.larghezza;
    for (let x = 0; x < maschera.larghezza; x++) {
      if (maschera.dati[riga + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < x0 ? undefined : { x0, y0, x1, y1, larghezza: x1 - x0 + 1, altezza: y1 - y0 + 1 };
}

/**
 * La larghezza (orizzontale) del foro interno più grande della maschera: la luce di una fibbia, il foro di un
 * occhiello. Un foro è una regione spenta che non tocca il bordo dell'immagine.
 * @param maschera - La maschera.
 * @returns La larghezza in pixel del foro di area massima, o undefined se non ci sono fori.
 * @public
 */
export function larghezzaForoInterno(maschera: MascheraBinaria): number | undefined {
  const { larghezza, altezza, dati } = maschera;
  const visto = new Uint8Array(larghezza * altezza);
  let migliore: { area: number; larghezza: number } | undefined;
  const coda = new Int32Array(larghezza * altezza);
  for (let inizio = 0; inizio < dati.length; inizio++) {
    if (dati[inizio] === 1 || visto[inizio] === 1) {
      continue;
    }
    let testa = 0;
    let fine = 0;
    coda[fine++] = inizio;
    visto[inizio] = 1;
    let area = 0;
    let bordo = false;
    let xMin = Infinity;
    let xMax = -Infinity;
    while (testa < fine) {
      const indice = coda[testa++]!;
      const x = indice % larghezza;
      const y = (indice - x) / larghezza;
      area++;
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      if (x === 0 || y === 0 || x === larghezza - 1 || y === altezza - 1) {
        bordo = true;
      }
      const vicini = [
        x > 0 ? indice - 1 : -1,
        x < larghezza - 1 ? indice + 1 : -1,
        indice - larghezza,
        indice + larghezza,
      ];
      for (const vicino of vicini) {
        if (vicino >= 0 && vicino < dati.length && !dati[vicino] && !visto[vicino]) {
          visto[vicino] = 1;
          coda[fine++] = vicino;
        }
      }
    }
    if (!bordo && (migliore === undefined || area > migliore.area)) {
      migliore = { area, larghezza: xMax - xMin + 1 };
    }
  }
  return migliore?.larghezza;
}

/** Su quale asse della maschera si legge una misura detta a parole. @public */
export type AsseMisura = 'orizzontale' | 'verticale' | 'lungo';

/**
 * L'asse di una misura detta a parole: altezza → verticale, larghezza/luce → orizzontale, il resto (lunghezza,
 * diametro, ⌀) → il lato lungo della maschera.
 * @param cosa - Che cosa misura il valore («altezza tacco», «larghezza», «⌀»).
 * @returns L'asse.
 * @public
 */
export function asseDaCosa(cosa: string): AsseMisura {
  const testo = cosa.toLocaleLowerCase('it');
  if (/altezz|height|alto|\bh\b/u.test(testo)) {
    return 'verticale';
  }
  if (/larghezz|width|luce|largo|\bl\b|inner/u.test(testo)) {
    return 'orizzontale';
  }
  return 'lungo';
}

/**
 * Pixel per millimetro da una misura nota sulla maschera, lungo l'asse della misura.
 * @param maschera - La maschera.
 * @param misura - Valore in mm e che cosa misura.
 * @returns I pixel per mm, o undefined con una maschera vuota.
 * @public
 */
export function pxPerMmDaMisura(
  maschera: MascheraBinaria,
  misura: Readonly<{ valoreMm: number; cosa: string }>,
): number | undefined {
  const estensione = estensioneMaschera(maschera);
  if (estensione === undefined || !(misura.valoreMm > 0)) {
    return undefined;
  }
  const asse = asseDaCosa(misura.cosa);
  const lunghezzaPx =
    asse === 'verticale'
      ? estensione.altezza
      : asse === 'orizzontale'
        ? estensione.larghezza
        : Math.max(estensione.larghezza, estensione.altezza);
  return lunghezzaPx / misura.valoreMm;
}

/**
 * Lunghezza della pianta dalla taglia EU (§2.5 punto 3): `taglia · 6,667 + 12` mm.
 * @param taglia - Taglia EU.
 * @returns La lunghezza in mm.
 * @public
 */
export const lunghezzaPiantaDaTaglia = (taglia: number): number => taglia * 6.667 + 12;

/** Le misure di catalogo che si leggono sul foro interno della maschera, non sull'ingombro. */
const misureDelForo = /inner|luce|foro|interna/u;

type Scala = NonNullable<SchedaParte['scala']>;

/**
 * Una scala con la confidenza della sua fonte; `pxPerMm` solo se è un numero positivo.
 * @param scala - Fonte, valore, che cosa misura e pixel per mm.
 * @returns La scala della scheda.
 */
const scalaDa = (scala: Readonly<{ tipo: Scala['tipo']; valoreMm: number; cosa: string; pxPerMm?: number }>): Scala => {
  const { pxPerMm, ...resto } = scala;
  return {
    ...resto,
    ...(pxPerMm === undefined || !Number.isFinite(pxPerMm) || pxPerMm <= 0 ? {} : { pxPerMm }),
    confidenza: confidenzaScala[scala.tipo],
  };
};

/**
 * Libreria: la larghezza se c'è, altrimenti l'altezza, letta sull'ingombro della maschera.
 * @param libreria - Le misure del componente.
 * @param maschera - La maschera della parte.
 * @returns La scala, o undefined senza misure.
 */
const scalaLibreria = (
  libreria: NonNullable<CandidatiScala['libreria']>,
  maschera?: MascheraBinaria,
): Scala | undefined => {
  const larghezza = libreria.larghezzaMm ?? 0;
  const altezza = libreria.altezzaMm ?? 0;
  if (larghezza <= 0 && altezza <= 0) {
    return undefined;
  }
  const misura = larghezza > 0 ? { valoreMm: larghezza, cosa: 'larghezza' } : { valoreMm: altezza, cosa: 'altezza' };
  return scalaDa({ tipo: 'libreria', ...misura, ...(maschera ? { pxPerMm: pxPerMmDaMisura(maschera, misura) } : {}) });
};

/**
 * Catalogo: una misura interna (luce, foro) si legge sul foro della maschera, le altre sull'ingombro.
 * @param catalogo - La misura di `technical_specs`.
 * @param maschera - La maschera della parte.
 * @returns La scala.
 */
const scalaCatalogo = (catalogo: NonNullable<CandidatiScala['catalogo']>, maschera?: MascheraBinaria): Scala => {
  if (!maschera) {
    return scalaDa({ tipo: 'catalogo', ...catalogo });
  }
  const foro = misureDelForo.test(catalogo.cosa.toLowerCase()) ? larghezzaForoInterno(maschera) : undefined;
  const pxPerMm = foro === undefined ? pxPerMmDaMisura(maschera, catalogo) : foro / catalogo.valoreMm;
  return scalaDa({ tipo: 'catalogo', ...catalogo, ...(pxPerMm === undefined ? {} : { pxPerMm }) });
};

/**
 * Taglia e forma: la lunghezza della pianta o del piede sull'estensione della parte «scarpa/suola».
 * @param misura - Fonte, lunghezza in mm, che cosa misura e la sua estensione in pixel.
 * @returns La scala.
 */
const scalaDaLunghezza = (
  misura: Readonly<{ tipo: 'taglia' | 'forma'; lunghezza: number; cosa: string; lunghezzaPx?: number }>,
): Scala =>
  scalaDa({
    tipo: misura.tipo,
    valoreMm: misura.lunghezza,
    cosa: misura.cosa,
    ...(misura.lunghezzaPx === undefined ? {} : { pxPerMm: misura.lunghezzaPx / misura.lunghezza }),
  });

/**
 * La scala della scheda della parte dalle fonti disponibili, nell'ordine di §2.5 (misura, Libreria, catalogo, taglia,
 * forma). Senza fonti: undefined, e il classificatore stima (fonte `stima`).
 * @param candidati - Le fonti note.
 * @param maschera - La maschera della parte, per misurare i pixel (facoltativa: senza, niente `pxPerMm`).
 * @returns La scala per `SchedaParte.scala`, o undefined.
 * @public
 */
export function scegliScala(candidati: CandidatiScala, maschera?: MascheraBinaria): SchedaParte['scala'] {
  const { misura, libreria, catalogo, taglia, forma } = candidati;
  if (misura && misura.valoreMm > 0) {
    return scalaDa({ tipo: 'misura', ...misura, ...(maschera ? { pxPerMm: pxPerMmDaMisura(maschera, misura) } : {}) });
  }
  const daLibreria = libreria ? scalaLibreria(libreria, maschera) : undefined;
  if (daLibreria) {
    return daLibreria;
  }
  if (catalogo && catalogo.valoreMm > 0) {
    return scalaCatalogo(catalogo, maschera);
  }
  if (taglia && taglia.taglia > 0) {
    const lunghezza = Math.round(lunghezzaPiantaDaTaglia(taglia.taglia) * 10) / 10;
    return scalaDaLunghezza({
      tipo: 'taglia',
      lunghezza,
      cosa: `pianta (taglia ${taglia.taglia})`,
      ...(taglia.lunghezzaPx === undefined ? {} : { lunghezzaPx: taglia.lunghezzaPx }),
    });
  }
  if (forma && forma.lunghezzaPiedeMm > 0) {
    return scalaDaLunghezza({
      tipo: 'forma',
      lunghezza: forma.lunghezzaPiedeMm,
      cosa: 'piede (forma)',
      ...(forma.lunghezzaPx === undefined ? {} : { lunghezzaPx: forma.lunghezzaPx }),
    });
  }
  return undefined;
}
