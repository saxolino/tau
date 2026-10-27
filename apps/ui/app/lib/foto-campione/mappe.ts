import { assiCamera } from '@taucad/smlib/verifica';
import type { ImmagineRaster, MascheraBinaria } from '@taucad/smlib/verifica';
import type { MeshFoto } from '#lib/foto-campione/glb-mesh.js';

/**
 * The free maps of the sample photo (SinopiaCAD D6, Fable 26 ott §4c): from the model in the browser, for each view a
 * fixed orthographic camera and a fixed key light, four pictures the image model is conditioned on — a neutral shaded
 * render, a depth map (near = light, the ControlNet convention), a camera-space normal map and the edges — and the
 * silhouette the received photo is measured against (IoU ≥ 0.95). A software z-buffer in TypeScript: no WebGL, so the
 * same code runs in a worker, in the page and in the unit tests, and the same model gives the same bytes.
 *
 * Cameras use the D3 convention (`assiCamera` of `@taucad/smlib/verifica`): Z up, azimuth 0 looks at the front (camera
 * on −Y), azimuth 90 from the right, elevation from above.
 */

export const vistePhoto = ['fronte', 'tre-quarti', 'dettaglio'] as const;
/** A view of the sample photo. */
export type VistaFoto = (typeof vistePhoto)[number];

/** The maps' side: Nano Banana's 1K square output, so photo and render are compared pixel for pixel. */
export const latoMappe = 1024;

type DefinizioneVista = Readonly<{ azimuth: number; elevation: number; margine: number; zoom: number }>;

/**
 * The fixed camera of each view. «Dettaglio» is the three-quarter camera brought 1.9× closer on the model's centre; a
 * flat piece's «fronte» looks from above (see `rapportoPiatto`).
 */
export const definizioniViste: Readonly<Record<VistaFoto, DefinizioneVista>> = {
  fronte: { azimuth: 0, elevation: 6, margine: 0.12, zoom: 1 },
  'tre-quarti': { azimuth: 35, elevation: 22, margine: 0.12, zoom: 1 },
  dettaglio: { azimuth: 35, elevation: 22, margine: 0.12, zoom: 1.9 },
};

/**
 * A piece is flat when its height (Z) is at most half its larger plan side: a buckle, a plaque, a sole. Its «front» is
 * the face it shows lying down, so «fronte» looks at it from above (a flat lay), not edge-on.
 */
const rapportoPiatto = 0.5;

/** The key light, fixed in camera space (x right, y up, z towards the camera): from the upper left, in front. */
const luce = ((): readonly [number, number, number] => {
  const [x, y, z] = [-0.45, 0.62, 0.64];
  const lunghezza = Math.hypot(x, y, z);
  return [x / lunghezza, y / lunghezza, z / lunghezza];
})();

/** Grey levels of the depth map: the nearest point 255, the farthest 40, the background 0. */
const profonditaVicina = 255;
const profonditaLontana = 40;

/** The four maps and the silhouette of one view. */
export type MappeFoto = Readonly<{
  vista: VistaFoto;
  /** The camera actually used: «fronte» of a flat piece looks from above (elevation 90°). */
  camera: Readonly<{ azimuth: number; elevation: number }>;
  lato: number;
  /** Pixels per millimetre of the camera (for the reader of a measure on the picture). */
  pxPerMm: number;
  /** Neutral grey shading on white (1 channel). */
  ombreggiata: ImmagineRaster;
  /** Depth: near = 255, far = 40, background = 0 (1 channel). */
  profondita: ImmagineRaster;
  /** Camera-space normals as RGB, background the flat (128, 128, 255) (3 channels). */
  normali: ImmagineRaster;
  /** Visible B-rep edges and the outline, black on white (1 channel). */
  bordi: ImmagineRaster;
  /** Where the model covers the picture. */
  sagoma: MascheraBinaria;
}>;

const dot = (ax: number, ay: number, az: number, b: readonly [number, number, number]): number =>
  ax * b[0] + ay * b[1] + az * b[2];

/** Whether the model lies flat (Z extent ≤ half the larger of the X and Y extents). */
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
 * Render the maps of one view.
 *
 * @param mesh - The model's triangles and edges (`meshDaGlb`).
 * @param vista - The view.
 * @param lato - The side of the square pictures.
 * @returns The maps and the silhouette.
 */
export function rendiMappe(mesh: MeshFoto, vista: VistaFoto, lato = latoMappe): MappeFoto {
  const definizione = definizioniViste[vista];
  const { triangoli, normali: normaliMesh, segmenti } = mesh;
  const vertici = triangoli.length / 3;
  if (vertici < 3) {
    throw new Error('Sample photo: the model has no surface to photograph.');
  }
  const elevation = vista === 'fronte' && isPiatto(triangoli) ? 90 : definizione.elevation;
  const { destra, su, direzione } = assiCamera({ azimuth: definizione.azimuth, elevation, rollo: 0 });

  // Image-plane coordinates (mm along right and up) and depth (mm along the view direction) of every vertex.
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
    // Pixel (x, y) covers [x, x+1) × [y, y+1) and is sampled at its centre.
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
      normali.set([128, 128, 255], p * 3);
      continue;
    }
    sagoma[p] = 1;
    profonditaMappa[p] = Math.round(
      intervallo > 1e-9
        ? profonditaVicina - ((profonditaVicina - profonditaLontana) * (profondita - vicino)) / intervallo
        : profonditaVicina,
    );
    const [nx, ny, nz] = [normaleBuffer[p * 3]!, normaleBuffer[p * 3 + 1]!, normaleBuffer[p * 3 + 2]!];
    // Camera space: x right, y up, z towards the camera. Two-sided: a normal facing away is turned to the camera.
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
    // Neutral studio grey: key light plus a soft fill from the camera, kept off pure black and pure white.
    const chiave = Math.max(0, cxN * luce[0] + cyN * luce[1] + czN * luce[2]);
    const tono = 0.16 + 0.62 * chiave + 0.14 * czN;
    ombreggiata[p] = Math.round(Math.min(0.9, Math.max(0.1, tono)) * 255);
  }

  // Edges: the outline of the silhouette, then each B-rep segment where it is not hidden behind a surface.
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
  for (let s = 0; s + 5 < segmenti.length; s += 6) {
    const estremi = [0, 3].map((k) => {
      const [x, y, z] = [segmenti[s + k]!, segmenti[s + k + 1]!, segmenti[s + k + 2]!];
      return [u(dot(x, y, z, destra)), v(dot(x, y, z, su)), dot(x, y, z, direzione)] as const;
    });
    const [[x0, y0, d0], [x1, y1, d1]] = estremi as [
      readonly [number, number, number],
      readonly [number, number, number],
    ];
    const passi = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
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

  const raster = (dati: Uint8Array, canali: 1 | 3): ImmagineRaster => ({
    larghezza: lato,
    altezza: lato,
    canali,
    dati,
  });
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
