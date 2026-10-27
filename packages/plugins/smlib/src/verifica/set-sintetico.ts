import type * as Smlib from '@classcad/smlibwasm';
import type { IdFamiglia } from '#famiglie/famiglia.js';
import { leggiParametro, scriviParametro } from '#famiglie/parametri.js';
import { famiglie } from '#famiglie/registro.js';
import { confronta, preparaConfronto } from '#verifica/metrica.js';
import { parametriSensibili, verificaSilhouette } from '#verifica/ottimizza.js';
import type { EsitoFase, OpzioniOttimizzatore } from '#verifica/ottimizza.js';
import type { ImmagineRaster } from '#verifica/png.js';
import { meshDaForme, silhouetteMesh, tolleranzaPerPixel } from '#verifica/silhouette.js';
import { casoSintetico, costruibile, fotoSintetica, ingressoSintetico } from '#verifica/sintetico.js';
import type { CasoSintetico } from '#verifica/sintetico.js';

/**
 * Set di prova sintetico della verifica D3 (task T-D3-07), senza costi: per ogni famiglia N pezzi con parametri veri
 * noti, la silhouette resa da una camera nota come «foto», la stima perturbata (±15 % sui parametri sensibili, ±10° di
 * azimut, ±8° di elevazione, ±5° di rollo) e l'ottimizzatore con la scala dichiarata. Misura IoU, errore in mm sulle
 * misure critiche e tempo. Nessuna immagine generata con modelli AI (quello è T-D3-08).
 */

export type VoceSet = { famiglia: IdFamiglia; variante: string; seme: number; nota?: string };

/** Il set predefinito: 5 pezzi per famiglia, varianti dentro il budget di ricostruzione, più un caso fuori budget. */
export const SET_SINTETICO: readonly VoceSet[] = [
  ...['stiletto', 'blocco', 'rocchetto', 'cono', 'kitten'].map((variante, indice) => ({
    famiglia: 'tacco' as const,
    variante,
    seme: 101 + indice,
  })),
  ...['rettangolare', 'rettangolare', 'rettangolare', 'doppia', 'doppia'].map((variante, indice) => ({
    famiglia: 'fibbia' as const,
    variante,
    seme: 201 + indice,
  })),
  ...['rettangolo', 'rettangolo', 'cerchio', 'scudo', 'ovale'].map((variante, indice) => ({
    famiglia: 'placca' as const,
    variante,
    seme: 301 + indice,
  })),
  ...[1, 2, 3, 4, 5].map((indice) => ({ famiglia: 'occhiello' as const, variante: 'standard', seme: 400 + indice })),
  ...['cupola', 'piramide', 'piatta', 'cono', 'cupola'].map((variante, indice) => ({
    famiglia: 'borchia' as const,
    variante,
    seme: 501 + indice,
  })),
  ...['griffe', 'griffe', 'chiuso', 'chiuso', 'fascia'].map((variante, indice) => ({
    famiglia: 'anello' as const,
    variante,
    seme: 601 + indice,
  })),
  { famiglia: 'fibbia', variante: 'ovale', seme: 290, nota: 'fuori budget (costruzione ≈ 870 ms)' },
];

/** Errore su un parametro sensibile. */
export type ErroreParametro = {
  chiave: string;
  unita: string;
  critico: boolean;
  vero: number;
  stima: number;
  ottimizzato: number;
};

export type RisultatoCaso = {
  id: string;
  famiglia: IdFamiglia;
  variante: string;
  nota?: string;
  vista: CasoSintetico['vista'];
  vistaStimata: CasoSintetico['vistaStimata'];
  /** Estrazioni scartate + 1 (parametri che la ricetta non costruiva). */
  tentativi: number;
  cameraFinale: { azimuth: number; elevation: number; rollo: number };
  /** IoU della silhouette vera (parametri e camera veri) con la maschera: il pavimento della discretizzazione. */
  iouVerita: number;
  /** IoU della stima dopo il solo allineamento di centro e scala (prima dell'ottimizzatore). */
  iouPrima: number;
  iouDopo: number;
  chamferDopoMm: number;
  errori: ErroreParametro[];
  tempoMs: number;
  valutazioni: number;
  ricostruzioni: number;
  interrotto: boolean;
  fasi: EsitoFase[];
};

/**
 * Esegue un caso del set.
 * @param lib - Libreria SMLib.
 * @param voce - Famiglia, variante, seme.
 * @param opzioni - Opzioni dell'ottimizzatore.
 * @returns Il risultato e le immagini differenza prima e dopo.
 */
export function eseguiCaso(
  lib: typeof Smlib,
  voce: VoceSet,
  opzioni: OpzioniOttimizzatore & { senzaScala?: boolean } = {},
): { risultato: RisultatoCaso; prima: ImmagineRaster; dopo: ImmagineRaster } {
  const famiglia = famiglie[voce.famiglia]!;
  const caso = casoSintetico(famiglia, voce.variante, voce.seme, {}, costruibile(lib, famiglia, voce.variante));
  const foto = fotoSintetica(lib, caso);
  const riferimento = preparaConfronto(foto.maschera);
  // Pavimento: la silhouette vera nella nostra discretizzazione contro la maschera nata da `render`.
  const vera = structuredClone(caso.veri);
  if (leggiParametro(vera, 'costruzione.lato') === 'coppia') {
    scriviParametro(vera, 'costruzione.lato', 'dx');
  }
  const meshVera = lib.scope(() =>
    meshDaForme(
      lib,
      famiglia.costruisci(lib, vera, { variante: voce.variante }).map((pezzo) => pezzo.shape as Smlib.Shape),
      tolleranzaPerPixel(foto.cameraVera.pxPerMm),
    ),
  );
  const iouVerita = confronta(silhouetteMesh(meshVera, foto.cameraVera), riferimento, foto.cameraVera.pxPerMm).iou;
  // Prima: la stima con la sola camera iniziale (centro e scala dai momenti), nessuna valutazione dell'ottimizzatore.
  const iniziale = verificaSilhouette(
    lib,
    ingressoSintetico(caso, foto, {
      valutazioni: { camera: 0, parametri: 0, congiunta: 0 },
      giriParametri: 0,
      ...(opzioni.senzaScala ? { senzaScala: true } : {}),
    }),
  );
  const esito = verificaSilhouette(lib, ingressoSintetico(caso, foto, opzioni));
  const errori = parametriSensibili(famiglia).map((definizione) => ({
    chiave: definizione.chiave,
    unita: definizione.unita,
    critico: definizione.critico === true,
    vero: Number(leggiParametro(caso.veri, definizione.chiave)),
    stima: Number(leggiParametro(caso.stima, definizione.chiave)),
    ottimizzato: Number(leggiParametro(esito.parametri, definizione.chiave)),
  }));
  return {
    risultato: {
      id: caso.id,
      famiglia: voce.famiglia,
      variante: voce.variante,
      ...(voce.nota ? { nota: voce.nota } : {}),
      vista: caso.vista,
      vistaStimata: caso.vistaStimata,
      tentativi: caso.tentativi,
      cameraFinale: { azimuth: esito.camera.azimuth, elevation: esito.camera.elevation, rollo: esito.camera.rollo },
      iouVerita,
      iouPrima: iniziale.iou,
      iouDopo: esito.iou,
      chamferDopoMm: esito.chamferMm,
      errori,
      tempoMs: esito.tempoMs,
      valutazioni: esito.valutazioni,
      ricostruzioni: esito.ricostruzioni,
      interrotto: esito.interrotto,
      fasi: esito.fasi,
    },
    prima: iniziale.differenza,
    dopo: esito.differenza,
  };
}

/** Le misure critiche di un caso: parametri critici in mm che la verifica ottimizza. */
export const misureCritiche = (risultato: RisultatoCaso): ErroreParametro[] =>
  risultato.errori.filter((errore) => errore.critico && errore.unita === 'mm');

const media = (valori: readonly number[]): number =>
  valori.length === 0 ? Number.NaN : valori.reduce((somma, valore) => somma + valore, 0) / valori.length;

export type RigaRiassunto = {
  famiglia: string;
  casi: number;
  iouPrimaMedia: number;
  iouMedia: number;
  iouMinima: number;
  iouVeritaMedia: number;
  erroreStimaMedio: number;
  erroreMedio: number;
  erroreMassimo: number;
  /** Errore relativo medio sulle misure critiche (%), la metrica senza scala dichiarata. */
  erroreRelativoMedio: number;
  entroUnMm: number;
  misure: number;
  tempoMedio: number;
  tempoMassimo: number;
  interrotti: number;
};

/**
 * Riassunto per famiglia.
 * @param risultati - Risultati dei casi.
 * @returns Una riga per famiglia (nell'ordine di prima comparsa) e una per il totale.
 */
export function riassunto(risultati: readonly RisultatoCaso[]): RigaRiassunto[] {
  const gruppi = new Map<string, RisultatoCaso[]>();
  for (const risultato of risultati) {
    const chiave = risultato.nota
      ? `${risultato.famiglia} ${risultato.variante} (${risultato.nota})`
      : risultato.famiglia;
    gruppi.set(chiave, [...(gruppi.get(chiave) ?? []), risultato]);
  }
  const riga = (famiglia: string, casi: readonly RisultatoCaso[]): RigaRiassunto => {
    const misure = casi.flatMap(misureCritiche);
    const errori = misure.map((misura) => Math.abs(misura.ottimizzato - misura.vero));
    return {
      famiglia,
      casi: casi.length,
      iouPrimaMedia: media(casi.map((caso) => caso.iouPrima)),
      iouMedia: media(casi.map((caso) => caso.iouDopo)),
      iouMinima: Math.min(...casi.map((caso) => caso.iouDopo)),
      iouVeritaMedia: media(casi.map((caso) => caso.iouVerita)),
      erroreStimaMedio: media(misure.map((misura) => Math.abs(misura.stima - misura.vero))),
      erroreMedio: media(errori),
      erroreMassimo: Math.max(...errori),
      erroreRelativoMedio: media(
        misure.map((misura) => (100 * Math.abs(misura.ottimizzato - misura.vero)) / misura.vero),
      ),
      entroUnMm: errori.filter((errore) => errore <= 1).length,
      misure: errori.length,
      tempoMedio: media(casi.map((caso) => caso.tempoMs)),
      tempoMassimo: Math.max(...casi.map((caso) => caso.tempoMs)),
      interrotti: casi.filter((caso) => caso.interrotto).length,
    };
  };
  const righe = [...gruppi.entries()].map(([famiglia, casi]) => riga(famiglia, casi));
  const nelBudget = risultati.filter((risultato) => !risultato.nota);
  return [...righe, riga('**totale (nel budget)**', nelBudget)];
}

/**
 * Due immagini differenza affiancate e ingrandite (prima | dopo), per il rapporto.
 * @param prima - Immagine differenza della stima.
 * @param dopo - Immagine differenza dopo l'ottimizzatore.
 * @param ingrandimento - Fattore (predefinito 2).
 * @returns Immagine RGB.
 */
export function affianca(prima: ImmagineRaster, dopo: ImmagineRaster, ingrandimento = 2): ImmagineRaster {
  const spazio = 8;
  const larghezza = (prima.larghezza + dopo.larghezza) * ingrandimento + spazio;
  const altezza = Math.max(prima.altezza, dopo.altezza) * ingrandimento;
  const dati = new Uint8Array(larghezza * altezza * 3).fill(255);
  for (const [immagine, x0] of [
    [prima, 0],
    [dopo, prima.larghezza * ingrandimento + spazio],
  ] as const) {
    for (let y = 0; y < immagine.altezza * ingrandimento; y++) {
      for (let x = 0; x < immagine.larghezza * ingrandimento; x++) {
        const sorgente = (Math.floor(y / ingrandimento) * immagine.larghezza + Math.floor(x / ingrandimento)) * 3;
        dati.set(immagine.dati.subarray(sorgente, sorgente + 3), (y * larghezza + x0 + x) * 3);
      }
    }
  }
  return { larghezza, altezza, canali: 3, dati };
}

const numero = (valore: number, decimali = 2): string =>
  Number.isFinite(valore)
    ? valore.toLocaleString('it-IT', { maximumFractionDigits: decimali, minimumFractionDigits: decimali })
    : '—';

/**
 * La tabella Markdown per famiglia.
 * @param righe - Righe del riassunto.
 * @returns Markdown.
 */
export function tabellaMarkdown(righe: readonly RigaRiassunto[]): string {
  const testa =
    '| Famiglia | Casi | IoU prima (media) | IoU dopo media / min | IoU alla verità | Errore stima mm (media) | Errore dopo mm media / max | Errore dopo % | Misure ≤ 1 mm | Tempo s medio / max |\n' +
    '|---|---|---|---|---|---|---|---|---|---|';
  const corpo = righe.map(
    (riga) =>
      `| ${riga.famiglia} | ${riga.casi} | ${numero(riga.iouPrimaMedia, 3)} | ${numero(riga.iouMedia, 3)} / ${numero(riga.iouMinima, 3)} | ${numero(riga.iouVeritaMedia, 3)} | ${numero(riga.erroreStimaMedio)} | ${numero(riga.erroreMedio)} / ${numero(riga.erroreMassimo)} | ${numero(riga.erroreRelativoMedio, 1)} | ${riga.entroUnMm}/${riga.misure} | ${numero(riga.tempoMedio / 1000, 1)} / ${numero(riga.tempoMassimo / 1000, 1)}${riga.interrotti ? ` (${riga.interrotti} al budget)` : ''} |`,
  );
  return [testa, ...corpo].join('\n');
}

/**
 * Tabella degli errori per misura critica (media e massimo per chiave), per vedere quali misure la vista non fissa.
 * @param risultati - Risultati dei casi.
 * @returns Markdown.
 */
export function tabellaPerMisura(risultati: readonly RisultatoCaso[]): string {
  const perChiave = new Map<string, { stima: number[]; dopo: number[] }>();
  for (const risultato of risultati.filter((voce) => !voce.nota)) {
    for (const misura of misureCritiche(risultato)) {
      const voce = perChiave.get(`${risultato.famiglia} · ${misura.chiave}`) ?? { stima: [], dopo: [] };
      voce.stima.push(Math.abs(misura.stima - misura.vero));
      voce.dopo.push(Math.abs(misura.ottimizzato - misura.vero));
      perChiave.set(`${risultato.famiglia} · ${misura.chiave}`, voce);
    }
  }
  const righe = [...perChiave.entries()].map(
    ([chiave, { stima, dopo }]) =>
      `| ${chiave} | ${numero(media(stima))} | ${numero(media(dopo))} | ${numero(Math.max(...dopo))} | ${dopo.filter((valore) => valore <= 1).length}/${dopo.length} |`,
  );
  return [
    '| Misura | Errore stima mm (media) | Errore dopo mm (media) | Max | ≤ 1 mm |',
    '|---|---|---|---|---|',
    ...righe,
  ].join('\n');
}
