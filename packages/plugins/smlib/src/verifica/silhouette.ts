import type * as Smlib from '@classcad/smlibwasm';
import { proiettore, vistaRender } from '#verifica/camera.js';
import type { CameraVerifica } from '#verifica/camera.js';

/**
 * Silhouette di pezzi SMLib da una camera ortografica (specifica D3, §3.1, task T-D3-01).
 *
 * Due vie con la stessa uscita (maschera binaria riga per riga dall'alto a sinistra):
 * - **A, `render()`** di smlibwasm: immagine CPU con sfondo verde puro e `supersample: 1` (niente antialias), silhouette =
 *   pixel diversi dallo sfondo. Ritessella a ogni chiamata.
 * - **B, `tessellate()` + riempimento dei triangoli in TypeScript**: la mesh si fa una volta per geometria e poi ogni
 *   camera costa solo la proiezione (nessuna chiamata al kernel). Il pixel `(x, y)` copre `[x, x+1) × [y, y+1)` ed è
 *   acceso se il suo centro cade nel pezzo: è la stessa regola di una maschera ridotta per media d'area e soglia 0,5
 *   (§3.2), quindi il confronto con la maschera non ha errore sistematico.
 * Misurato (T-D3-01): `render` accende ogni pixel che il pezzo **tocca** (copertura conservativa: un lato di 20 px
 * accende sempre 21 colonne, comunque cada), quindi la sua silhouette è la nostra dilatata di circa mezzo pixel per
 * lato; sul tacco a 256² costa 84 ms contro 54 ms di `tessellate` + 0,7 ms di riempimento per ogni camera.
 * L'ottimizzatore usa B (la fase camera non tocca il kernel); A resta il riferimento e il controllo.
 */

/** Maschera binaria: `dati[y * larghezza + x]` vale 1 dove c'è il pezzo. */
export type MascheraBinaria = { larghezza: number; altezza: number; dati: Uint8Array };

/** Mesh copiata fuori dal kernel (array JavaScript: sopravvive allo `scope` che ha liberato i corpi). */
export type MeshPiatta = { vertici: Float64Array; triangoli: Uint32Array };

/** Lato predefinito delle immagini della verifica (§3.2). */
export const LATO_VERIFICA = 256;

const SFONDO: readonly [number, number, number] = [0, 255, 0];

/**
 * Silhouette con `render()` (via A).
 * @param lib - Libreria SMLib.
 * @param forme - Pezzi da rendere.
 * @param camera - Camera della verifica.
 * @param opzioni - Dimensioni (predefinito 256²) e tolleranza di tessellazione (mm; predefinito quella di `render`).
 * @returns Maschera binaria.
 */
export function silhouetteRender(
  lib: typeof Smlib,
  forme: readonly Smlib.Shape[],
  camera: CameraVerifica,
  opzioni: { larghezza?: number; altezza?: number; tolleranza?: number } = {},
): MascheraBinaria {
  const larghezza = opzioni.larghezza ?? LATO_VERIFICA;
  const altezza = opzioni.altezza ?? LATO_VERIFICA;
  const { view, frame } = vistaRender(camera);
  const immagine = lib.render([...forme], {
    view,
    frame,
    size: [larghezza, altezza],
    background: [...SFONDO],
    supersample: 1,
    ...(opzioni.tolleranza === undefined ? {} : { tolerance: opzioni.tolleranza }),
  });
  const pixel = immagine.pixels;
  const dati = new Uint8Array(larghezza * altezza);
  for (let indice = 0; indice < dati.length; indice++) {
    const k = indice * 3;
    dati[indice] = pixel[k] === SFONDO[0] && pixel[k + 1] === SFONDO[1] && pixel[k + 2] === SFONDO[2] ? 0 : 1;
  }
  return { larghezza, altezza, dati };
}

/**
 * Tolleranza di tessellazione per una camera: un terzo di pixel, fra 0,005 e 0,5 mm.
 * @param pxPerMm - Pixel per millimetro della silhouette.
 * @returns Tolleranza in mm.
 */
export const tolleranzaPerPixel = (pxPerMm: number): number => Math.min(0.5, Math.max(0.005, 1 / (3 * pxPerMm)));

/**
 * Tessella i pezzi e copia la mesh fuori dal kernel (via B, una volta per geometria).
 * @param lib - Libreria SMLib.
 * @param forme - Pezzi.
 * @param tolleranza - Tolleranza cordale in mm.
 * @returns Vertici e triangoli in array JavaScript.
 */
export function meshDaForme(lib: typeof Smlib, forme: readonly Smlib.Shape[], tolleranza: number): MeshPiatta {
  // `tessellate` vuole una forma o una ShapeList, non un array: un pezzo alla volta, concatenati qui.
  const meshes = forme.map((forma) => lib.tessellate(forma, tolleranza));
  const vertici = new Float64Array(meshes.reduce((somma, mesh) => somma + mesh.vertices.length, 0));
  const triangoli = new Uint32Array(meshes.reduce((somma, mesh) => somma + mesh.triangles.length, 0));
  let [baseVertici, baseTriangoli] = [0, 0];
  for (const mesh of meshes) {
    vertici.set(mesh.vertices, baseVertici);
    const primo = baseVertici / 3;
    for (let indice = 0; indice < mesh.triangles.length; indice++) {
      triangoli[baseTriangoli + indice] = mesh.triangles[indice]! + primo;
    }
    baseVertici += mesh.vertices.length;
    baseTriangoli += mesh.triangles.length;
  }
  return { vertici, triangoli };
}

/**
 * Silhouette di una mesh: proiezione ortografica e riempimento dei triangoli (via B, solo JavaScript).
 * @param mesh - Mesh piatta.
 * @param camera - Camera della verifica.
 * @param opzioni - Dimensioni (predefinito 256²).
 * @returns Maschera binaria.
 */
export function silhouetteMesh(
  mesh: MeshPiatta,
  camera: CameraVerifica,
  opzioni: { larghezza?: number; altezza?: number } = {},
): MascheraBinaria {
  const larghezza = opzioni.larghezza ?? LATO_VERIFICA;
  const altezza = opzioni.altezza ?? LATO_VERIFICA;
  const dati = new Uint8Array(larghezza * altezza);
  const proietta = proiettore(camera, larghezza, altezza);
  const { vertici, triangoli } = mesh;
  const punti = new Float64Array((vertici.length / 3) * 2);
  for (let i = 0, k = 0; i < vertici.length; i += 3, k += 2) {
    proietta(vertici[i]!, vertici[i + 1]!, vertici[i + 2]!, punti, k);
  }
  for (let t = 0; t < triangoli.length; t += 3) {
    riempiTriangolo(punti, triangoli[t]! * 2, triangoli[t + 1]! * 2, triangoli[t + 2]! * 2, dati, larghezza, altezza);
  }
  return { larghezza, altezza, dati };
}

const EPS = 1e-9;

/* oxlint-disable-next-line max-params -- hot loop: plain numbers, no allocation per triangle. */
function riempiTriangolo(
  punti: Float64Array,
  a: number,
  b: number,
  c: number,
  dati: Uint8Array,
  larghezza: number,
  altezza: number,
): void {
  const x0 = punti[a]!;
  const y0 = punti[a + 1]!;
  let x1 = punti[b]!;
  let y1 = punti[b + 1]!;
  let x2 = punti[c]!;
  let y2 = punti[c + 1]!;
  let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-12) {
    return;
  }
  if (area < 0) {
    [x1, y1, x2, y2] = [x2, y2, x1, y1];
    area = -area;
  }
  // Il pixel (x, y) copre [x, x+1) × [y, y+1) e si campiona nel centro (x + ½, y + ½).
  const minX = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - 0.5 - EPS));
  const maxX = Math.min(larghezza - 1, Math.floor(Math.max(x0, x1, x2) - 0.5 + EPS));
  const minY = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 0.5 - EPS));
  const maxY = Math.min(altezza - 1, Math.floor(Math.max(y0, y1, y2) - 0.5 + EPS));
  if (minX > maxX || minY > maxY) {
    return;
  }
  // Funzioni di bordo, positive dentro (verso antiorario nel sistema u verso destra, v verso il basso).
  const a0 = y1 - y2;
  const b0 = x2 - x1;
  const c0 = x1 * y2 - x2 * y1;
  const a1 = y2 - y0;
  const b1 = x0 - x2;
  const c1 = x2 * y0 - x0 * y2;
  const a2 = y0 - y1;
  const b2 = x1 - x0;
  const c2 = x0 * y1 - x1 * y0;
  const tolleranza = -EPS * area;
  for (let y = minY; y <= maxY; y++) {
    let w0 = a0 * (minX + 0.5) + b0 * (y + 0.5) + c0;
    let w1 = a1 * (minX + 0.5) + b1 * (y + 0.5) + c1;
    let w2 = a2 * (minX + 0.5) + b2 * (y + 0.5) + c2;
    const riga = y * larghezza;
    for (let x = minX; x <= maxX; x++) {
      if (w0 >= tolleranza && w1 >= tolleranza && w2 >= tolleranza) {
        dati[riga + x] = 1;
      }
      w0 += a0;
      w1 += a1;
      w2 += a2;
    }
  }
}

/**
 * Riquadro dei pixel accesi.
 * @param maschera - Maschera binaria.
 * @returns `[x0, y0, x1, y1]` inclusi, o null se vuota.
 */
export function riquadro(maschera: MascheraBinaria): [number, number, number, number] | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < maschera.altezza; y++) {
    for (let x = 0; x < maschera.larghezza; x++) {
      if (maschera.dati[y * maschera.larghezza + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}
