import type * as Smlib from '@classcad/smlibwasm';
import type { PezzoFamiglia } from '#famiglie/famiglia.js';
import type { ImmagineRaster } from '#verifica/png.js';

/**
 * Miniatura di una variante (SinopiaCAD D5) con il `render()` CPU di smlibwasm: nessuna dipendenza nuova, nessun
 * canvas, la stessa via nel worker e nei test. Il pezzo si rende al doppio della misura su un verde puro senza
 * antialias, poi si riduce 2 × 2 con il verde che diventa trasparenza: la miniatura sta bene sul tema chiaro e
 * sullo scuro, nei colori dei materiali, senza le linee nere degli spigoli (Fable 26 ott §2.2).
 */

/** Il riquadro di una resa (`Picture.frame`): pixel per unità e centro proiettato. */
export type Inquadratura = Readonly<{ scale: number; midX: number; midY: number }>;

/** Opzioni della miniatura. */
export type OpzioniAnteprima = Readonly<{
  larghezza: number;
  altezza: number;
  /** Vista di smlibwasm (predefinita la isometrica). */
  vista?: Smlib.RenderView;
  /** Riquadro di una resa precedente, perché le varianti si confrontino alla stessa scala. */
  inquadratura?: Inquadratura;
  /** Margine attorno al pezzo quando il riquadro non è dato (frazione della resa, predefinito 0,92). */
  zoom?: number;
}>;

const VERDE: readonly [number, number, number] = [0, 255, 0];

const verde = (pixel: ArrayLike<number>, k: number): boolean =>
  pixel[k] === VERDE[0] && pixel[k + 1] === VERDE[1] && pixel[k + 2] === VERDE[2];

/**
 * Riduce un blocco 2 × 2 della resa a un pixel RGBA: la media dei pixel non verdi, l'alfa dalla loro quota.
 * @param sorgente - Pixel RGB della resa al doppio della misura.
 * @param posto - Larghezza della resa e coordinate del pixel d'uscita.
 * @param uscita - Pixel RGBA della miniatura (scritti sul posto) e il loro indice.
 */
const riduci = (
  sorgente: ArrayLike<number>,
  posto: Readonly<{ larghezzaFine: number; x: number; y: number }>,
  uscita: Readonly<{ dati: Uint8Array<ArrayBuffer>; indice: number }>,
): void => {
  let [r, g, b, pieni] = [0, 0, 0, 0];
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const k = ((posto.y * 2 + dy) * posto.larghezzaFine + (posto.x * 2 + dx)) * 3;
    if (!verde(sorgente, k)) {
      r += sorgente[k]!;
      g += sorgente[k + 1]!;
      b += sorgente[k + 2]!;
      pieni++;
    }
  }
  if (pieni > 0) {
    const { dati, indice } = uscita;
    dati[indice] = Math.round(r / pieni);
    dati[indice + 1] = Math.round(g / pieni);
    dati[indice + 2] = Math.round(b / pieni);
    dati[indice + 3] = Math.round((pieni / 4) * 255);
  }
};

/**
 * Rende i pezzi di una famiglia in una miniatura RGBA trasparente.
 * @param lib - Libreria SMLib.
 * @param pezzi - Pezzi costruiti (con il colore del loro materiale).
 * @param opzioni - Misura, vista e riquadro.
 * @returns I pixel RGBA e il riquadro usato (da passare alle varianti).
 * @public
 */
export function anteprimaPezzi(
  lib: typeof Smlib,
  pezzi: readonly PezzoFamiglia[],
  opzioni: OpzioniAnteprima,
): Readonly<{ immagine: ImmagineRaster; inquadratura: Inquadratura }> {
  const { larghezza, altezza } = opzioni;
  // The kernel paints each body in its own colour: the recipe's material colour goes on the body.
  const forme = pezzi.map((pezzo) =>
    pezzo.shape instanceof lib.Part && typeof pezzo.color === 'string' ? pezzo.shape.colored(pezzo.color) : pezzo.shape,
  );
  const resa = lib.render(forme as Smlib.Renderable[], {
    view: opzioni.vista ?? 'iso',
    size: [larghezza * 2, altezza * 2],
    background: [...VERDE],
    supersample: 1,
    edges: false,
    colors: 'native',
    ...(opzioni.inquadratura
      ? { frame: { ...opzioni.inquadratura, scale: opzioni.inquadratura.scale * 2 } }
      : { zoom: opzioni.zoom ?? 0.92 }),
  });
  const sorgente = resa.pixels;
  const larghezzaFine = larghezza * 2;
  const dati = new Uint8Array(larghezza * altezza * 4);
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      riduci(sorgente, { larghezzaFine, x, y }, { dati, indice: (y * larghezza + x) * 4 });
    }
  }
  const frame = resa.frame ?? { scale: 1, midX: 0, midY: 0 };
  return {
    immagine: { larghezza, altezza, canali: 4, dati },
    inquadratura: { scale: frame.scale / 2, midX: frame.midX, midY: frame.midY },
  };
}
