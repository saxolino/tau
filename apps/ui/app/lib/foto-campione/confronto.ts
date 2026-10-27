import { iouSagome, rendiMappe } from '#lib/foto-campione/mappe-condivise.js';
import type { MeshFoto, SagomaFoto, VistaFoto } from '#lib/foto-campione/mappe-condivise.js';

/**
 * Whether the model on screen is still the version sent to Sinopia (SinopiaCAD D6). The photo is made by Sinopia from
 * the sent version's GLB; the screen renders its own preview, tessellated differently, so their bytes never match. The
 * shapes are compared instead: the bounding box in millimetres (the maps frame the model, so a uniform scale would not
 * show in them) and, in two views at 256², the silhouette (beyond one pixel) and the depth.
 */

/** Size tolerance: 0.1 mm or 0.5 %, the larger — a chordal tessellation difference, not a design change. */
const tolleranzaMm = 0.1;
const tolleranzaRelativa = 0.005;
/**
 * Share of the silhouettes' union that one covers and the other does not even within one pixel: a sub-pixel
 * tessellation difference flips whole pixel columns (the IoU of the same box at 256² falls to 0.979 for 0.05 mm), so a
 * pixel counts as a mismatch only when the other silhouette has nothing in its 3 × 3 neighbourhood.
 */
export const sogliaScartoStessaForma = 0.003;
/**
 * Depth: share of the pixels both silhouettes cover whose depth (0–255) differs by more than `salto` — a part moved in
 * front of another changes no silhouette, but a patch of depth jumps; tessellation noise stays a few levels.
 */
export const sogliaProfonditaStessaForma = 0.003;
const salto = 16;
const latoConfronto = 256;
const visteConfronto: readonly VistaFoto[] = ['tre-quarti', 'fronte'];

/** Pixels of `a` with no pixel of `b` in their 3 × 3 neighbourhood. */
const fuoriDa = (a: SagomaFoto, b: SagomaFoto): number => {
  const { larghezza, altezza } = a;
  let conta = 0;
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      if (!a.dati[y * larghezza + x]) {
        continue;
      }
      let vicino = false;
      for (let dy = -1; dy <= 1 && !vicino; dy++) {
        for (let dx = -1; dx <= 1 && !vicino; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          vicino = nx >= 0 && ny >= 0 && nx < larghezza && ny < altezza && b.dati[ny * larghezza + nx] === 1;
        }
      }
      conta += vicino ? 0 : 1;
    }
  }
  return conta;
};

const estensioni = (mesh: MeshFoto): [number, number, number] => {
  const minimo = [Infinity, Infinity, Infinity];
  const massimo = [-Infinity, -Infinity, -Infinity];
  for (let indice = 0; indice < mesh.triangoli.length; indice++) {
    const asse = indice % 3;
    minimo[asse] = Math.min(minimo[asse]!, mesh.triangoli[indice]!);
    massimo[asse] = Math.max(massimo[asse]!, mesh.triangoli[indice]!);
  }
  return [0, 1, 2].map((asse) => massimo[asse]! - minimo[asse]!) as [number, number, number];
};

/**
 * Compare two models' shapes.
 *
 * @param a - One model (the sent version).
 * @param b - The other (the screen).
 * @returns Whether they are the same shape, and the measures that decided it.
 */
export function stessaForma(
  a: MeshFoto,
  b: MeshFoto,
): Readonly<{ stessa: boolean; iou: number; scarto: number; profondita: number; misure: boolean }> {
  const [ea, eb] = [estensioni(a), estensioni(b)];
  const misure = ea.every(
    (valore, asse) =>
      Math.abs(valore - eb[asse]!) <= Math.max(tolleranzaMm, tolleranzaRelativa * Math.max(valore, eb[asse]!)),
  );
  let [iouMinima, scartoMassimo, profonditaMassima] = [1, 0, 0];
  for (const vista of visteConfronto) {
    const [ma, mb] = [rendiMappe(a, vista, latoConfronto), rendiMappe(b, vista, latoConfronto)];
    iouMinima = Math.min(iouMinima, iouSagome(ma.sagoma, mb.sagoma));
    let unione = 0;
    for (let p = 0; p < ma.sagoma.dati.length; p++) {
      unione += ma.sagoma.dati[p]! | mb.sagoma.dati[p]!;
    }
    const scarto = unione === 0 ? 0 : (fuoriDa(ma.sagoma, mb.sagoma) + fuoriDa(mb.sagoma, ma.sagoma)) / unione;
    scartoMassimo = Math.max(scartoMassimo, scarto);
    let [diverse, conta] = [0, 0];
    for (let p = 0; p < ma.sagoma.dati.length; p++) {
      if (ma.sagoma.dati[p] && mb.sagoma.dati[p]) {
        diverse += Math.abs(ma.profondita.dati[p]! - mb.profondita.dati[p]!) > salto ? 1 : 0;
        conta++;
      }
    }
    profonditaMassima = Math.max(profonditaMassima, conta === 0 ? 1 : diverse / conta);
  }
  return {
    stessa: misure && scartoMassimo <= sogliaScartoStessaForma && profonditaMassima <= sogliaProfonditaStessaForma,
    iou: iouMinima,
    scarto: scartoMassimo,
    profondita: profonditaMassima,
    misure,
  };
}
