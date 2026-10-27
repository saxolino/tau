/**
 * Camera ortografica della verifica silhouette ↔ maschera (specifica D3, §3.1).
 *
 * Convenzioni verificate in `silhouette.test.ts` contro `render()` di smlibwasm 0.5:
 * - `azimuth` e `elevation` come le viste nominate di `render`: azimuth 0 guarda dal fronte (camera in −Y, verso +Y),
 *   90 dal lato destro (camera in +X), elevation 90 dall'alto. È anche la convenzione dello schema D2 (§2.4:
 *   «0 = guarda la faccia −Y del telaio locale»). La formula del §3.1 aveva il segno di Y invertito (azimuth 0 sarebbe
 *   stato il dietro): qui vale quella di `render`, e `{ direction, up }` resi coincidono pixel per pixel con
 *   `{ azimuth, elevation }`.
 * - `direction` è la direzione in cui guarda la camera (dalla camera verso il modello); `destra = direction × su`.
 * - `frame = { scale, midX, midY }`: `scale` sono i pixel per millimetro; `(midX, midY)` è il punto proiettato
 *   (millimetri lungo `destra` e lungo `su`) che cade al centro dell'immagine. Un punto P va nel pixel
 *   `u = W/2 + scale·(P·destra − midX)`, `v = H/2 − scale·(P·su − midY)` (coordinate continue: il pixel `x` copre
 *   `[x, x+1)`, il centro dell'immagine è il bordo fra le colonne `W/2 − 1` e `W/2`). `render` accende ogni pixel
 *   toccato: un cubo di 10 mm a 4 px/mm, centrato, copre le colonne da 44 a 84 (41) in un'immagine di 128.
 * - `rollo` positivo gira il pezzo in senso antiorario nell'immagine (la camera ruota in senso orario attorno a
 *   `direction`): `su = cos ρ · su0 + sin ρ · destra0`.
 */

export type Vettore3 = readonly [number, number, number];

/** Camera parametrica: angoli in gradi, `pxPerMm` in pixel della maschera per millimetro, `cx`/`cy` in mm. */
export type CameraVerifica = {
  azimuth: number;
  elevation: number;
  rollo: number;
  pxPerMm: number;
  /** Coordinata lungo `destra` (mm) del punto che cade al centro dell'immagine. */
  cx: number;
  /** Coordinata lungo `su` (mm) del punto che cade al centro dell'immagine. */
  cy: number;
};

/** Assi della camera nel mondo (unitari, ortogonali). */
export type AssiCamera = { direzione: Vettore3; su: Vettore3; destra: Vettore3 };

const radianti = (gradi: number): number => (gradi * Math.PI) / 180;

const prodottoVettoriale = (a: Vettore3, b: Vettore3): Vettore3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Gli assi della camera: direzione di vista, alto e destra dell'immagine.
 * @param camera - Angoli della camera (gli altri campi non contano).
 * @returns Assi unitari nel telaio della famiglia (Z in alto).
 */
export function assiCamera(camera: Pick<CameraVerifica, 'azimuth' | 'elevation' | 'rollo'>): AssiCamera {
  const a = radianti(camera.azimuth);
  const e = radianti(camera.elevation);
  const r = radianti(camera.rollo);
  const direzione: Vettore3 = [-Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), -Math.sin(e)];
  // Z ortogonalizzato rispetto alla direzione, in forma chiusa (vale anche a elevation ±90: allora su = avanti).
  const su0: Vettore3 = [-Math.sin(e) * Math.sin(a), Math.sin(e) * Math.cos(a), Math.cos(e)];
  const destra0 = prodottoVettoriale(direzione, su0);
  const su: Vettore3 = [
    Math.cos(r) * su0[0] + Math.sin(r) * destra0[0],
    Math.cos(r) * su0[1] + Math.sin(r) * destra0[1],
    Math.cos(r) * su0[2] + Math.sin(r) * destra0[2],
  ];
  return { direzione, su, destra: prodottoVettoriale(direzione, su) };
}

/**
 * Le opzioni di `render()` per questa camera.
 * @param camera - Camera della verifica.
 * @returns `view` e `frame` da passare a `render`.
 */
export function vistaRender(camera: CameraVerifica): {
  view: { direction: [number, number, number]; up: [number, number, number] };
  frame: { scale: number; midX: number; midY: number };
} {
  const { direzione, su } = assiCamera(camera);
  return {
    view: { direction: [...direzione], up: [...su] },
    frame: { scale: camera.pxPerMm, midX: camera.cx, midY: camera.cy },
  };
}

/**
 * Proietta punti del mondo nei pixel dell'immagine (stessa trasformazione di `render` con `frame`).
 * @param camera - Camera della verifica.
 * @param larghezza - Larghezza dell'immagine in pixel.
 * @param altezza - Altezza dell'immagine in pixel.
 * @returns Funzione che scrive in `uscita[k], uscita[k+1]` le coordinate pixel del punto `(x, y, z)`.
 */
export function proiettore(
  camera: CameraVerifica,
  larghezza: number,
  altezza: number,
): (x: number, y: number, z: number, uscita: Float64Array, k: number) => void {
  const { su, destra } = assiCamera(camera);
  const s = camera.pxPerMm;
  const u0 = larghezza / 2 - s * camera.cx;
  const v0 = altezza / 2 + s * camera.cy;
  const [rx, ry, rz] = [destra[0] * s, destra[1] * s, destra[2] * s];
  const [ux, uy, uz] = [su[0] * s, su[1] * s, su[2] * s];
  return (x, y, z, uscita, k) => {
    uscita[k] = u0 + rx * x + ry * y + rz * z;
    uscita[k + 1] = v0 - (ux * x + uy * y + uz * z);
  };
}

/**
 * Il punto (mm nel piano immagine, lungo destra e su) che cade nel pixel `(u, v)`: l'inverso della proiezione.
 * @param camera - Camera della verifica.
 * @param larghezza - Larghezza dell'immagine.
 * @param altezza - Altezza dell'immagine.
 * @param u - Colonna (pixel, anche frazionaria).
 * @param v - Riga (pixel, anche frazionaria).
 * @returns `[x, y]` in mm.
 */
export function pianoDaPixel(
  camera: CameraVerifica,
  larghezza: number,
  altezza: number,
  u: number,
  v: number,
): [number, number] {
  return [camera.cx + (u - larghezza / 2) / camera.pxPerMm, camera.cy - (v - altezza / 2) / camera.pxPerMm];
}
