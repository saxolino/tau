import type * as Smlib from '@classcad/smlibwasm';
import type { FamigliaQualsiasi, IdFamiglia, ParametriAnnidati, ValoreParametro } from '#famiglie/famiglia.js';
import { leggiParametro, scriviParametro } from '#famiglie/parametri.js';
import { famiglie } from '#famiglie/registro.js';
import { assiCamera } from '#verifica/camera.js';
import type { CameraVerifica } from '#verifica/camera.js';
import { preparaMaschera } from '#verifica/maschera.js';
import type { MascheraPreparata } from '#verifica/maschera.js';
import { parametriSensibili } from '#verifica/ottimizza.js';
import type { IngressoVerifica, OpzioniOttimizzatore } from '#verifica/ottimizza.js';
import type { ImmagineRaster } from '#verifica/png.js';
import { silhouetteRender } from '#verifica/silhouette.js';

/**
 * Casi sintetici della verifica D3 senza costi (task T-D3-05 e T-D3-07): il pezzo si costruisce con parametri «veri»,
 * la «foto» è la sua silhouette resa da `render()` (rasterizzatore del kernel, diverso dal nostro) a 1024 px da una
 * camera nota, fuori centro; la maschera di riferimento esce da quella foto con la stessa preparazione delle maschere
 * SAM. La stima di partenza perturba i parametri sensibili e la camera; la scala è dichiarata (come con una misura
 * nota), il centro no.
 */

/** Generatore pseudo-casuale riproducibile (mulberry32). */
export function generatore(seme: number): () => number {
  let stato = seme >>> 0;
  return () => {
    stato = (stato + 0x6d_2b_79_f5) >>> 0;
    let t = stato;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type CasoSintetico = {
  id: string;
  famiglia: IdFamiglia;
  variante: string;
  /** Parametri veri (normalizzati). */
  veri: ParametriAnnidati;
  /** Camera vera della foto (angoli). */
  vista: { azimuth: number; elevation: number; rollo: number };
  /** Stima di partenza (parametri sensibili perturbati) e vista perturbata. */
  stima: ParametriAnnidati;
  vistaStimata: { azimuth: number; elevation: number; rollo: number };
};

export type FotoSintetica = {
  /** Silhouette vera a 1024 px (grigio: 255 = pezzo). */
  foto: ImmagineRaster;
  maschera: MascheraPreparata;
  /** Camera vera nei pixel della maschera (per confronto). */
  cameraVera: CameraVerifica;
  /** Pixel della foto per mm. */
  fotoPxPerMm: number;
};

/** Viste informative per famiglia: intervalli di azimuth, elevation, rollo (gradi). */
export const VISTE_SINTETICHE: Readonly<
  Record<string, { az: [number, number]; el: [number, number]; ro: [number, number] }>
> = {
  tacco: { az: [50, 75], el: [5, 20], ro: [-8, 8] },
  fibbia: { az: [-20, 20], el: [45, 75], ro: [-25, 25] },
  placca: { az: [-20, 20], el: [45, 75], ro: [-25, 25] },
  occhiello: { az: [-30, 30], el: [35, 60], ro: [-10, 10] },
  borchia: { az: [-30, 30], el: [20, 40], ro: [-10, 10] },
  anello: { az: [-25, 25], el: [10, 30], ro: [-10, 10] },
};

const tra = (casuale: () => number, [a, b]: readonly [number, number]): number => a + (b - a) * casuale();

/**
 * Un caso sintetico: parametri veri attorno ai predefiniti della variante, vista informativa, stima perturbata.
 * @param famiglia - Famiglia del registro.
 * @param variante - Variante.
 * @param seme - Seme del generatore.
 * @param perturbazione - Perturbazione relativa dei parametri sensibili (predefinito 0,15) e della vista (gradi).
 * @returns Il caso.
 */
export function casoSintetico(
  famiglia: FamigliaQualsiasi,
  variante: string,
  seme: number,
  perturbazione: {
    relativa?: number;
    azimuth?: number;
    elevation?: number;
    rollo?: number;
    /** Intervalli della vista vera al posto di quelli della famiglia. */
    vista?: { az: [number, number]; el: [number, number]; ro: [number, number] };
  } = {},
): CasoSintetico {
  const casuale = generatore(seme);
  const sensibili = parametriSensibili(famiglia);
  const veri = famiglia.normalizza(famiglia.predefiniti(variante), { variante }) as ParametriAnnidati;
  // Veri: ogni parametro sensibile entro ±20 % dell'intervallo attorno al predefinito (dentro i limiti e i vincoli).
  for (const definizione of sensibili) {
    const valore = Number(leggiParametro(veri, definizione.chiave));
    const ampiezza = 0.2 * (definizione.max! - definizione.min!);
    let nuovo = valore + (2 * casuale() - 1) * ampiezza;
    nuovo = Math.min(definizione.max!, Math.max(definizione.min!, nuovo));
    scriviParametro(veri, definizione.chiave, definizione.unita === 'n' ? Math.round(nuovo) : nuovo);
  }
  const veriNormalizzati = famiglia.normalizza(veri, { variante }) as ParametriAnnidati;
  const intervalli = perturbazione.vista ??
    VISTE_SINTETICHE[famiglia.id] ?? { az: [-30, 30], el: [20, 50], ro: [-10, 10] };
  const vista = {
    azimuth: tra(casuale, intervalli.az),
    elevation: tra(casuale, intervalli.el),
    rollo: tra(casuale, intervalli.ro),
  };
  // Stima: ogni parametro sensibile spostato fino a ±relativa del suo valore (almeno ±5 % dell'intervallo).
  const relativa = perturbazione.relativa ?? 0.15;
  const stima = structuredClone(veriNormalizzati);
  for (const definizione of sensibili) {
    const valore = Number(leggiParametro(veriNormalizzati, definizione.chiave));
    const ampiezza = Math.max(relativa * Math.abs(valore), 0.05 * (definizione.max! - definizione.min!));
    let nuovo = valore + (2 * casuale() - 1) * ampiezza;
    nuovo = Math.min(definizione.max!, Math.max(definizione.min!, nuovo));
    scriviParametro(
      stima,
      definizione.chiave,
      (definizione.unita === 'n' ? Math.round(nuovo) : nuovo) as ValoreParametro,
    );
  }
  const vistaStimata = {
    azimuth: vista.azimuth + (2 * casuale() - 1) * (perturbazione.azimuth ?? 10),
    elevation: vista.elevation + (2 * casuale() - 1) * (perturbazione.elevation ?? 8),
    rollo: vista.rollo + (2 * casuale() - 1) * (perturbazione.rollo ?? 5),
  };
  return {
    id: `${famiglia.id}-${variante}-${seme}`,
    famiglia: famiglia.id,
    variante,
    veri: veriNormalizzati,
    vista,
    stima: famiglia.normalizza(stima, { variante }) as ParametriAnnidati,
    vistaStimata,
  };
}

/**
 * Rende la «foto» del caso (silhouette di `render` a 1024 px, pezzo al 60 % del lato e fuori centro) e ne prepara la
 * maschera come una maschera SAM.
 * @param lib - Libreria SMLib.
 * @param caso - Caso sintetico.
 * @param opzioni - Lato della foto (predefinito 1024).
 * @returns Foto, maschera preparata e camera vera nei pixel della maschera.
 */
export function fotoSintetica(lib: typeof Smlib, caso: CasoSintetico, opzioni: { lato?: number } = {}): FotoSintetica {
  const famiglia = famiglie[caso.famiglia]!;
  const latoFoto = opzioni.lato ?? 1024;
  const parametri = structuredClone(caso.veri);
  if (leggiParametro(parametri, 'costruzione.lato') === 'coppia') {
    scriviParametro(parametri, 'costruzione.lato', 'dx');
  }
  return lib.scope(() => {
    const forme = famiglia
      .costruisci(lib, parametri, { variante: caso.variante })
      .map((pezzo) => pezzo.shape as Smlib.Shape);
    // Estensione proiettata dagli angoli dei riquadri: scala per un lato maggiore al 60 % della foto.
    const { destra, su } = assiCamera(caso.vista);
    let [xMin, xMax, yMin, yMax] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const forma of forme) {
      const { min, max } = forma.bbox();
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            const u = x * destra[0] + y * destra[1] + z * destra[2];
            const v = x * su[0] + y * su[1] + z * su[2];
            [xMin, xMax, yMin, yMax] = [Math.min(xMin, u), Math.max(xMax, u), Math.min(yMin, v), Math.max(yMax, v)];
          }
        }
      }
    }
    const fotoPxPerMm = (0.6 * latoFoto) / Math.max(xMax - xMin, yMax - yMin);
    // Fuori centro di un decimo del lato: la maschera deve ritrovare il pezzo.
    const camera: CameraVerifica = {
      ...caso.vista,
      pxPerMm: fotoPxPerMm,
      cx: (xMin + xMax) / 2 - (0.1 * latoFoto) / fotoPxPerMm,
      cy: (yMin + yMax) / 2 + (0.08 * latoFoto) / fotoPxPerMm,
    };
    const silhouette = silhouetteRender(lib, forme, camera, { larghezza: latoFoto, altezza: latoFoto });
    const foto: ImmagineRaster = {
      larghezza: latoFoto,
      altezza: latoFoto,
      canali: 1,
      dati: silhouette.dati.map((valore) => valore * 255),
    };
    const maschera = preparaMaschera(foto, { pxPerMm: fotoPxPerMm });
    const centro = maschera.larghezza / 2;
    const cameraVera: CameraVerifica = {
      ...caso.vista,
      pxPerMm: fotoPxPerMm * maschera.k,
      cx: camera.cx + (maschera.origine[0] + centro / maschera.k - latoFoto / 2) / fotoPxPerMm,
      cy: camera.cy - (maschera.origine[1] + centro / maschera.k - latoFoto / 2) / fotoPxPerMm,
    };
    return { foto, maschera, cameraVera, fotoPxPerMm };
  });
}

/**
 * L'ingresso della verifica per un caso sintetico: stima perturbata, vista perturbata, scala dichiarata.
 * @param caso - Caso sintetico.
 * @param foto - Foto e maschera del caso.
 * @param opzioni - Opzioni dell'ottimizzatore; confidenza della vista (predefinito 0,7).
 * @returns L'ingresso per `verificaSilhouette`.
 */
export function ingressoSintetico(
  caso: CasoSintetico,
  foto: FotoSintetica,
  opzioni: OpzioniOttimizzatore & { confidenzaVista?: number; confidenzaParametri?: number } = {},
): IngressoVerifica {
  const { confidenzaVista, confidenzaParametri, ...ottimizzatore } = opzioni;
  const famiglia = famiglie[caso.famiglia]!;
  const confidenze = Object.fromEntries(
    parametriSensibili(famiglia).map((definizione) => [definizione.chiave, confidenzaParametri ?? 0.5]),
  );
  return {
    famiglia: caso.famiglia,
    variante: caso.variante,
    stima: { parametri: caso.stima, confidenze },
    vista: { ...caso.vistaStimata, confidenza: confidenzaVista ?? 0.7 },
    scala: { pxPerMm: foto.maschera.pxPerMm, fonte: 'misura_nota' },
    maschera: foto.maschera,
    opzioni: ottimizzatore,
  };
}
